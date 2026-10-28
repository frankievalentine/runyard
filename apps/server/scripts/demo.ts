/**
 * Runs Runyard against a fictional fleet: a fake runner answers `tailscale
 * status` and every SSH session, so nothing real is contacted. For UI work
 * and screenshots: `bun apps/server/scripts/demo.ts`, then open the URL and
 * enter the setup code it prints. Data lives in a fresh temporary directory.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Glob } from "bun";
import { createMachine, listMachines } from "../src/machines/store.ts";
import { FakeGithub } from "../src/github/fake.ts";
import { listGithubApps, saveGithubApp } from "../src/github/store.ts";
import { FakeMachines, macReport } from "../src/machines/fake.ts";
import { start } from "../src/server.ts";

const GIB = 1_073_741_824;
process.env.RUNYARD_DATA_DIR ??= await mkdtemp(join(tmpdir(), "runyard-demo-"));
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
    "RFM\tdiag:complete\t1",
  ].join("\n");

fake.machines.set("ci@studio-mini.demo.ts.net", () =>
  macReport(180).replace("RFM\tcpu\t23.50", `RFM\tcpu\t${(10 + Math.random() * 20).toFixed(2)}`),
);
fake.machines.set("linux-builder.demo.ts.net", () => linux(22));
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
// organization with a busy fleet, and a personal account's per-repo runners.
const github = new FakeGithub();
const personal = new FakeGithub();
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

const {
  db,
  monitor,
  secrets,
  github: githubMonitor,
} = await start(dashboard, {
  run: fake.run,
  programs: fake.programs,
  // Each app's API host goes to its own fake.
  fetch: (request) =>
    (new URL(request.url).host === "api.personal.github.demo" ? personal : github).fetch(request),
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
// Check right away instead of waiting for the next minute-long round.
await monitor.checkNow();
console.log("Demo fleet: every answer is fake; nothing real is contacted.");
