/**
 * Runs Runyard against a fictional yard: a fake runner answers `tailscale
 * status` and every SSH session, so nothing real is contacted. For UI work
 * and screenshots: `bun apps/server/scripts/demo.ts`, then open the URL and
 * enter the setup code it prints. Data lives in a fresh temporary directory.
 */
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Glob } from "bun";
import { createMachine, listMachines } from "../src/machines/store.ts";
import { listPools, recordTemplate, savePool } from "../src/pools/store.ts";
import { listJobs, recordJob } from "../src/history/store.ts";
import { FakeBoat } from "../src/boat/fake.ts";
import { FakeForgejo } from "../src/forgejo/fake.ts";
import { listConnections, saveConnection } from "../src/forgejo/store.ts";
import { FakeGithub } from "../src/github/fake.ts";
import { listGithubApps, saveGithubApp } from "../src/github/store.ts";
import { FakeMachines, macReport } from "../src/machines/fake.ts";
import { FakeRunnerHost } from "../src/pools/fake-host.ts";
import type { FakeGithub as FakeGithubType } from "../src/github/fake.ts";
import { start } from "../src/server.ts";

const GIB = 1_073_741_824;
const demoDir = (process.env.RUNYARD_DATA_DIR ??= await mkdtemp(join(tmpdir(), "runyard-demo-")));
await mkdir(demoDir, { recursive: true, mode: 0o700 });
process.env.RUNYARD_TAILNET = "off";
process.env.RUNYARD_DEMO = "1";

const fake = new FakeMachines();
const node = (id: string, host: string, os: string, online: boolean, extra: object = {}) => ({
  ID: id,
  HostName: host,
  DNSName: `${host}.demo.ts.net.`,
  OS: os,
  TailscaleIPs: [`100.64.0.${id.length + host.length}`],
  Online: online,
  LastSeen: new Date(Date.now() - 42 * 60_000).toISOString(),
  ...extra,
});
fake.status = {
  BackendState: "Running",
  Self: { ID: "nControl", HostName: "control" },
  CurrentTailnet: { Name: "demo.example" },
  Peer: {
    a: node("nMini", "studio-mini", "macOS", true),
    b: node("nLinux", "linux-builder", "linux", true, {
      sshHostKeys: ["ssh-ed25519 AAAA"],
      Tags: ["tag:ci"],
    }),
    c: node("nWin", "win-builder", "windows", false),
    d: node("nPi", "lab-pi", "linux", true),
    e: node("nPhone", "pixel", "android", true),
  },
};

const linux = (freeGiB: number) =>
  [
    "RFM\tos\tlinux",
    "RFM\tos_version\tUbuntu 24.04.1 LTS",
    "RFM\tcores\t16",
    `RFM\tcpu\t${(40 + Math.random() * 30).toFixed(2)}`,
    "RFM\tload\t5.10 4.22 3.90",
    "RFM\tmemory_total\t67108864000",
    "RFM\tmemory_available\t21474836480",
    "RFM\tuptime\t1209600",
    "RFM\tboot_id\tL1",
    `RFM\tdisk\t/\t${500 * GIB}\t${freeGiB * GIB}`,
    "RFM_END",
    "RFM\tdiag:identity\tci",
    "RFM\tdiag:architecture\tx86_64",
    "RFM\tdiag:tailscale_install\tcli-daemon",
    "RFM\tdiag:tailscale_backend\tRunning",
    "RFM\tdiag:tailscale_ssh\ttrue",
    "RFM\tdiag:tailscale_startup\tenabled",
    "RFM\tdiag:target_sleep\tmasked",
    "RFM\tdiag:idle_action\tignore",
    ...readiness({
      tools: ["git", "curl", "tar", "unzip", "jq", "cc", "make", "python3"],
      docker: "27.3.1",
    }),
    "RFM\tdiag:complete\t1",
  ].join("\n");

/**
 * A demo machine's readiness facts, as machine-readiness.sh reports them:
 * which tools it has, Docker, Xcode and a GPU, and its clock (now).
 */
function readiness(has: { tools: string[]; docker?: string; xcode?: string; gpu?: string }) {
  const fact = (k: string, v: string) => `RFM\tdiag:${k}\t${v}`;
  return [
    ...has.tools.map((t) => fact(`tool_${t}`, `/usr/bin/${t}`)),
    ...(has.tools.includes("git") ? [fact("tool_git_version", "git version 2.47.1")] : []),
    ...(has.docker ? [fact("docker_cli", "present"), fact("docker_server", has.docker)] : []),
    ...(has.xcode
      ? [
          fact("xcode_clt", "/Applications/Xcode.app/Contents/Developer"),
          fact("xcode_version", has.xcode),
        ]
      : []),
    ...(has.gpu ? [fact("nvidia_gpu", has.gpu)] : []),
    fact("epoch", String(Math.floor(Date.now() / 1000))),
    fact("reach_0", "github.com 200"),
    fact("readiness_complete", "1"),
  ];
}

/**
 * Each demo machine answers health checks and runs runner scripts on a fake
 * host. A runner that installs shows up in the fake GitHub, and one that's
 * removed disappears, so pools can be reviewed and applied end to end.
 */
let nextRunnerId = 100;
/** Each machine's fake host, so the demo can seed templates and end one-job runners. */
const hosts = new Map<string, FakeRunnerHost>();
function runnerHost(
  health: () => string,
  githubFor: (owner: string) => FakeGithubType,
  os: string,
  target: string,
) {
  const host = new FakeRunnerHost();
  hosts.set(target, host);
  return (stdin: string) => {
    if (stdin.includes("metric os")) return health();
    const result = host.answer(stdin);
    const last = host.received.at(-1);
    if (last?.op === "jit-start" && typeof result === "string") playOneJob(host, last.env.RF_NAME!);
    const url = last?.env.RF_URL;
    if (last && typeof result === "string" && url) {
      const owner = new URL(url).pathname.slice(1);
      const gh = githubFor(owner);
      const labels = ["self-hosted", os, ...(last.env.RF_LABELS ?? "").split(",").filter(Boolean)];
      gh.runners.set(owner, [
        ...(gh.runners.get(owner) ?? []),
        { id: nextRunnerId++, name: last.env.RF_NAME!, os, status: "online", busy: false, labels },
      ]);
    } else if (last?.op === "remove" && typeof result === "string") {
      for (const gh of [github, personal]) {
        for (const [owner, list] of gh.runners)
          gh.runners.set(
            owner,
            list.filter((r) => r.name !== last.env.RF_NAME),
          );
      }
    }
    return result;
  };
}
/**
 * A one-job runner's life on the fake: it comes online and takes the queued
 * gpu job, then finishes after about a minute and a half and deregisters.
 */
function playOneJob(host: FakeRunnerHost, name: string) {
  const owner = "acme-demo";
  setTimeout(() => {
    const runner = github.runners.get(owner)?.find((r) => r.name === name);
    if (!runner) return;
    runner.status = "online";
    runner.busy = true;
    const queued = (github.runs.get("acme-demo/infra") ?? []).find((r) => r.status === "queued");
    if (!queued) return;
    queued.status = "in_progress";
    for (const job of queued.jobs) {
      Object.assign(job, {
        status: "in_progress",
        runner_id: runner.id,
        runner_name: name,
        started_at: new Date().toISOString(),
      });
    }
  }, 8_000).unref();
  setTimeout(() => {
    host.jobs.set(name, "exited");
    github.runners.set(
      owner,
      (github.runners.get(owner) ?? []).filter((r) => r.name !== name),
    );
    github.runs.set(
      "acme-demo/infra",
      (github.runs.get("acme-demo/infra") ?? []).filter(
        (r) => !r.jobs.some((j) => j.runner_name === name),
      ),
    );
  }, 95_000).unref();
}
const githubFor = (owner: string) => (owner.startsWith("frankie-demo") ? personal : github);
fake.machines.set(
  "ci@studio-mini.demo.ts.net",
  runnerHost(
    () =>
      macReport(180)
        .replace("RFM\tcpu\t23.50", `RFM\tcpu\t${(10 + Math.random() * 20).toFixed(2)}`)
        .replace(
          "RFM\tdiag:complete",
          [
            "RFM\tdiag:architecture\tarm64",
            "RFM\tdiag:auto_login_user\tci",
            ...readiness({
              tools: [
                "git",
                "curl",
                "tar",
                "unzip",
                "zip",
                "xz",
                "zstd",
                "jq",
                "gpg",
                "cc",
                "make",
                "python3",
              ],
              xcode: "Xcode 16.2",
            }),
            "RFM\tdiag:complete",
          ].join("\n"),
        ),
    githubFor,
    "macOS",
    "ci@studio-mini.demo.ts.net",
  ),
);
fake.machines.set(
  "linux-builder.demo.ts.net",
  runnerHost(() => linux(22), githubFor, "Linux", "linux-builder.demo.ts.net"),
);
fake.machines.set("admin@lab-server.internal", {
  code: 255,
  stdout: "",
  stderr: "admin@lab-server.internal: Permission denied (publickey,password).",
});

// Serves the built dashboard when there is one (`vp run -r build`); otherwise use `vp run dev`.
const dist = resolve(import.meta.dir, "../../dashboard/dist");
const files = (await Bun.file(join(dist, "index.html")).exists())
  ? [...new Glob("**/*").scanSync({ cwd: dist, onlyFiles: true })]
  : [];
const dashboard = files.length ? new Map(files.map((f) => [`/${f}`, join(dist, f)])) : undefined;

// A fictional GitHub with one app per account, as private apps require: an
// organization with a busy yard, and a personal account's per-repo runners.
// The fakes' app keys persist beside the demo's data, so a restart's first
// refresh already signs with the key Runyard has stored.
const keysFile = join(demoDir, "demo-github-keys.json");
const savedKeys = (await Bun.file(keysFile).exists())
  ? ((await Bun.file(keysFile).json()) as { github: string; personal: string })
  : null;
const github = new FakeGithub(savedKeys?.github);
const personal = new FakeGithub(savedKeys?.personal);
if (!savedKeys) {
  await Bun.write(
    keysFile,
    JSON.stringify({ github: github.privateKey, personal: personal.privateKey }),
  );
  await chmod(keysFile, 0o600);
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
github.installations = [
  {
    id: 1,
    account: "acme-demo",
    type: "Organization",
    repos: ["acme-demo/app", "acme-demo/web", "acme-demo/infra"],
    selection: "all",
  },
];
personal.installations = [
  {
    id: 2,
    account: "frankie-demo",
    type: "User",
    repos: ["frankie-demo/site", "frankie-demo/cli"],
    selection: "selected",
  },
];
const mac = ["self-hosted", "macOS", "ARM64", "xcode"];
const lin = ["self-hosted", "Linux", "X64", "docker"];
github.runners.set("acme-demo", [
  { id: 11, name: "mini-01", os: "macOS", status: "online", busy: true, labels: mac },
  { id: 12, name: "mini-02", os: "macOS", status: "online", busy: false, labels: mac },
  { id: 13, name: "linux-01", os: "Linux", status: "online", busy: true, labels: lin },
  { id: 14, name: "linux-02", os: "Linux", status: "online", busy: false, labels: lin },
  {
    id: 15,
    name: "win-01",
    os: "Windows",
    status: "offline",
    busy: false,
    labels: ["self-hosted", "Windows", "X64"],
  },
]);
personal.runners.set("frankie-demo/site", [
  { id: 21, name: "home-box", os: "Linux", status: "online", busy: false, labels: lin },
]);
personal.runners.set("frankie-demo/cli", [
  { id: 22, name: "home-box", os: "Linux", status: "online", busy: false, labels: lin },
]);
github.runs.set("acme-demo/app", [
  {
    id: 900,
    status: "in_progress",
    jobs: [
      {
        id: 9001,
        name: "build-ios",
        status: "in_progress",
        labels: ["self-hosted", "xcode"],
        runner_id: 11,
        runner_name: "mini-01",
        created_at: ago(9),
        started_at: ago(7),
      },
      {
        id: 9002,
        name: "test-ios",
        status: "queued",
        labels: ["self-hosted", "xcode"],
        created_at: ago(3),
      },
    ],
  },
  {
    id: 901,
    status: "queued",
    jobs: [
      {
        id: 9003,
        name: "release-windows",
        status: "queued",
        labels: ["self-hosted", "Windows"],
        created_at: ago(12),
      },
    ],
  },
]);
github.runs.set("acme-demo/web", [
  // boat runs these on a VM per job; its runner isn't in the runner list.
  {
    id: 903,
    status: "in_progress",
    jobs: [
      {
        id: 9005,
        name: "lint",
        status: "in_progress",
        labels: ["boat"],
        runner_id: 7001,
        runner_name: "boat-ci-web-9005",
        created_at: ago(4),
        started_at: ago(3),
      },
      {
        id: 9006,
        name: "integration",
        status: "queued",
        labels: ["boat-large"],
        created_at: ago(1),
      },
    ],
  },
  {
    id: 902,
    status: "in_progress",
    jobs: [
      {
        id: 9004,
        name: "e2e",
        status: "in_progress",
        labels: ["self-hosted", "docker"],
        runner_id: 13,
        runner_name: "linux-01",
        created_at: ago(2),
        started_at: ago(1),
      },
    ],
  },
]);

// A fictional Forgejo: the user's own runner and an organization's, one job waiting.
const forgejo = new FakeForgejo();
forgejo.login = "frankie-demo";
forgejo.orgs = ["yard-club"];
forgejo.repos = [
  { id: 31, full_name: "frankie-demo/dotfiles", private: true, owner: { login: "frankie-demo" } },
  { id: 32, full_name: "yard-club/garden", private: true, owner: { login: "yard-club" } },
];
forgejo.runners.set("user", [
  {
    id: 41,
    uuid: "demo-41",
    name: "pi-01",
    status: "idle",
    labels: ["docker", "arm64"],
    version: "13.2.0",
    ephemeral: false,
  },
]);
forgejo.runners.set("org:yard-club", [
  {
    id: 42,
    uuid: "demo-42",
    name: "rack-01",
    status: "active",
    labels: ["docker"],
    version: "13.2.0",
    ephemeral: false,
  },
  {
    id: 43,
    uuid: "demo-43",
    name: "rack-02",
    status: "offline",
    labels: ["docker"],
    version: "13.2.0",
    ephemeral: false,
  },
]);
forgejo.jobs.set("org:yard-club", [
  { id: 51, run_id: 5, repo_id: 32, name: "lint", status: "waiting", runs_on: ["docker"] },
]);

// A fictional boat account: the VM running the lint job, and one left running for hours.
const boat = new FakeBoat();
boat.limits.activeSandboxes = 2;
boat.limits.starts.minute.used = 1;
const isoAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
boat.sandboxes = [
  {
    id: "bx_c1web905",
    name: "ci-acme-demo-web-9005",
    state: "running",
    type: "default",
    vcpu: 4,
    memoryGB: 8,
    createdAt: isoAgo(3),
    cost: { since: isoAgo(3), seconds: 180, dollars: 0.0018 },
  },
  {
    id: "bx_scratch7",
    name: "scratch",
    state: "idle",
    type: "large",
    vcpu: 8,
    memoryGB: 16,
    createdAt: isoAgo(26 * 60),
    cost: { since: isoAgo(26 * 60), seconds: 187_200, dollars: 1.87 },
  },
];

const {
  db,
  monitor,
  secrets,
  github: githubMonitor,
  forgejo: forgejoMonitor,
  boat: boatMonitor,
} = await start(dashboard, {
  run: fake.run,
  programs: fake.programs,
  // Each app's API host goes to its own fake.
  fetch: (request) => {
    const host = new URL(request.url).host;
    if (host === "forgejo.demo" || host === "code.forgejo.org") return forgejo.fetch(request);
    if (host === "boat.dev") return boat.fetch(request);
    return (host === "api.personal.github.demo" ? personal : github).fetch(request);
  },
  githubApiBase: "https://api.github.demo",
  githubWebBase: "https://github.demo",
});
// The fakes sign with new keys each run, so stored apps always get the current ones.
const demoApps = [
  {
    fake: github,
    slug: "runyard-acme",
    name: "Runyard (acme-demo)",
    owner: { login: "acme-demo", type: "Organization" },
    apiBase: "https://api.github.demo",
  },
  {
    fake: personal,
    slug: "runyard-frankie",
    name: "Runyard (frankie-demo)",
    owner: { login: "frankie-demo", type: "User" },
    apiBase: "https://api.personal.github.demo",
  },
];
const stored = listGithubApps(db);
for (const app of demoApps) {
  const existing = stored.find((a) => a.slug === app.slug);
  if (existing) {
    await secrets.set(`github.${existing.id}.pem`, app.fake.privateKey);
    continue;
  }
  await saveGithubApp(
    db,
    secrets,
    {
      id: Number(app.fake.appId),
      slug: app.slug,
      name: app.name,
      client_id: "Iv1.demo",
      client_secret: "demo",
      webhook_secret: null,
      pem: app.fake.privateKey,
      html_url: `https://github.com/apps/${app.slug}`,
      owner: app.owner,
    },
    app.apiBase,
  );
}
await githubMonitor.refreshAll();
if (listConnections(db).length === 0) {
  await saveConnection(db, secrets, "https://forgejo.demo", forgejo.login, forgejo.token);
}
await forgejoMonitor.refreshAll();
await boatMonitor.connect(boat.token);
if (listMachines(db).length === 0) {
  createMachine(db, {
    name: "Studio mini",
    sshTarget: "ci@studio-mini.demo.ts.net",
    transport: "openssh",
    tailscaleNodeId: "nMini",
    expectedOs: "macos",
  });
  createMachine(db, {
    name: "Linux builder",
    sshTarget: "linux-builder.demo.ts.net",
    transport: "tailscale",
    tailscaleNodeId: "nLinux",
    expectedOs: "linux",
    description: "Primary Linux CI host",
  });
  createMachine(db, {
    name: "Windows builder",
    sshTarget: "ci@win-builder.demo.ts.net",
    transport: "openssh",
    tailscaleNodeId: "nWin",
    expectedOs: "windows",
  });
  createMachine(db, {
    name: "Lab server",
    sshTarget: "admin@lab-server.internal",
    transport: "openssh",
  });
}
// An on-demand pool on Linux builder, its runner software already installed,
// and a gpu job queued every two minutes for it to pick up.
const linuxBuilder = listMachines(db).find((m) => m.sshTarget === "linux-builder.demo.ts.net");
const acme = listGithubApps(db).find((a) => a.slug === "runyard-acme");
if (linuxBuilder && acme && !listPools(db).some((p) => p.name === "gpu")) {
  const scope = { forgeId: acme.id, kind: "org" as const, target: "acme-demo" };
  const poolId = savePool(db, {
    name: "gpu",
    labels: ["gpu"],
    machines: [{ machineId: linuxBuilder.id, slots: 2 }],
    scopes: [scope],
    forgejoMode: { kind: "host" },
    mode: "onDemand",
    toolProfiles: [],
    cleanup: "off",
  });
  recordTemplate(db, {
    key: `${poolId}:${linuxBuilder.id}:actions`,
    machineId: linuxBuilder.id,
    poolId,
    poolName: "gpu",
    scope,
    runnerKind: "actions",
    path: "~/runyard-runners/gpu/template-actions",
    serviceMode: "systemd",
  });
}
hosts
  .get("linux-builder.demo.ts.net")
  ?.templates.set("~/runyard-runners/gpu/template-actions", "2.329.0");
// Seconds since the epoch: job IDs never repeat, across restarts too, as on GitHub.
let gpuJob = Math.floor(Date.now() / 1000);
const queueGpuJob = () => {
  const runs = github.runs.get("acme-demo/infra") ?? [];
  if (runs.some((r) => r.status === "queued")) return;
  gpuJob += 1;
  github.runs.set("acme-demo/infra", [
    ...runs,
    {
      id: gpuJob * 10,
      status: "queued",
      jobs: [
        {
          id: gpuJob,
          name: "train-model",
          status: "queued",
          labels: ["self-hosted", "Linux", "gpu"],
          created_at: new Date().toISOString(),
        },
      ],
    },
  ]);
};
queueGpuJob();
setInterval(queueGpuJob, 120_000).unref();

// Run history: a week of finished jobs on the first machines' runners, seeded once.
if (acme && listJobs(db, { since: 0, limit: 1 }).length === 0) {
  const machines = listMachines(db);
  const now = Date.now();
  const names = ["build", "test", "lint", "e2e", "deploy-preview"];
  for (let i = 0; i < 40; i++) {
    const machine = machines[i % Math.min(2, machines.length)];
    if (!machine) break;
    const startedAt = now - (i * 4 + 1) * 60 * 60_000 - (i % 5) * 7 * 60_000;
    const failed = i % 9 === 4;
    const lost = i === 2;
    recordJob(db, {
      forgeId: acme.id,
      repo: i % 3 ? "acme-demo/web" : "acme-demo/app",
      jobId: 70_000 + i,
      runId: 9_000 + i,
      runAttempt: 1,
      name: names[i % names.length]!,
      workflow: i === 6 ? "Runyard runner check" : "CI",
      test: i === 6,
      runnerName: i % 2 ? "linux-01" : "mini-01",
      machineId: machine.id,
      startedAt,
      finishedAt: startedAt + (90 + (i % 7) * 45) * 1000,
      conclusion: i === 11 ? "cancelled" : failed || lost ? "failure" : "success",
      htmlUrl: `https://github.demo/acme-demo/web/actions/runs/${9_000 + i}`,
      ...(lost ? { hook: "started" as const } : {}),
      source: lost ? "hook" : "webhook",
    });
  }
}

// Check right away instead of waiting for the next minute-long round.
await monitor.checkNow();
console.log("Demo yard: every answer is fake; nothing real is contacted.");
