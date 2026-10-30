import { describe, expect, test } from "bun:test";
import type { JobRecord, YardView } from "@runyard/core";
import { registrations } from "../db/schema.ts";

import { macReport } from "../machines/fake.ts";
import { createMachine } from "../machines/store.ts";
import type { OperationView, Review } from "../pools/engine.ts";
import { FakeRunnerHost } from "../pools/fake-host.ts";
import { listRegistrations } from "../pools/store.ts";
import { saveConnection } from "./store.ts";
import { body, send, sessionCookie, testApp } from "../testing.ts";

const PASSWORD = "correct horse battery";

/** A machine checked once, with a readiness report: Node.js found unless `node` is false. */
async function setup(os: "linux" | "macos" = "linux", { node = true } = {}) {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: PASSWORD,
  });
  const cookie = sessionCookie(res);
  const call = <T>(method: string, path: string, json?: unknown) =>
    body<T>(send(t.app, method, path, json, { Cookie: cookie }));
  const raw = (method: string, path: string, json?: unknown) =>
    send(t.app, method, path, json, { Cookie: cookie });
  const host = new FakeRunnerHost();
  const report = macReport()
    .replace("RFM\tos\tmacos", `RFM\tos\t${os}`)
    .replace(
      "RFM\tdiag:complete",
      [
        `RFM\tdiag:architecture\t${os === "linux" ? "x86_64" : "arm64"}`,
        ...(node
          ? ["RFM\tdiag:tool_node\t/usr/bin/node", "RFM\tdiag:tool_node_version\tv20.19.2"]
          : []),
        `RFM\tdiag:epoch\t${Math.floor(Date.now() / 1000)}`,
        "RFM\tdiag:readiness_complete\t1",
        "RFM\tdiag:complete",
      ].join("\n"),
    );
  t.fake.machines.set("ci@box", (stdin) =>
    stdin.includes("metric os") ? report : host.answer(stdin),
  );
  const machine = createMachine(t.deps.db, {
    name: "Box",
    sshTarget: "ci@box",
    transport: "openssh",
    expectedOs: os,
  });
  await t.monitor.checkMachines();
  t.fakeForgejo.repos = [
    { id: 1, full_name: "frankie/app", private: true, owner: { login: "frankie" } },
  ];
  return { ...t, cookie, call, raw, host, machine, report };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function connect(s: Setup) {
  const res = await s.raw("POST", "/api/forgejo/connections", {
    url: "https://forgejo.test/",
    token: s.fakeForgejo.token,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function pool(s: Setup, forgeId: string, forgejoMode: unknown = { kind: "host" }) {
  const res = await s.raw("POST", "/api/pools", {
    name: "ci",
    labels: ["docker"],
    machines: [{ machineId: s.machine.id, slots: 1 }],
    scopes: [{ forgeId, kind: "user", target: "frankie" }],
    forgejoMode,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function run(s: Setup): Promise<OperationView> {
  const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
  let op = await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {});
  for (let i = 0; i < 100 && op.status === "running"; i++) {
    await Bun.sleep(5);
    op = s.engine.operation(op.id)!;
  }
  return op;
}

describe("Forgejo connections", () => {
  test("refuse Forgejo older than 15 and a token Forgejo rejects", async () => {
    const s = await setup();
    s.fakeForgejo.version = "11.0.1+gitea-1.22.0";
    const old = await s.raw("POST", "/api/forgejo/connections", {
      url: "https://forgejo.test",
      token: s.fakeForgejo.token,
    });
    expect(((await old.json()) as { error: string }).error).toContain("needs Forgejo 15");
    s.fakeForgejo.version = "16.0.0";
    const bad = await s.raw("POST", "/api/forgejo/connections", {
      url: "https://forgejo.test",
      token: "wrong-token-123",
    });
    expect(((await bad.json()) as { error: string }).error).toContain("401");
  });

  test("watch the user and their organizations, and list runners alongside GitHub's", async () => {
    const s = await setup();
    s.fakeForgejo.orgs = ["acme"];
    s.fakeForgejo.runners.set("user", [
      {
        id: 9,
        uuid: "u",
        name: "laptop",
        status: "idle",
        labels: ["docker"],
        version: "13.2.0",
        ephemeral: false,
      },
    ]);
    await connect(s);
    const view = await s.call<YardView>("GET", "/api/yard");
    expect(view.forgejo.connections[0]?.scopes.map((x) => [x.kind, x.target])).toEqual([
      ["user", "frankie"],
      ["org", "acme"],
    ]);
    expect(view.runners.map((r) => [r.name, r.forge, r.activity])).toEqual([
      ["laptop", "forgejo", "idle"],
    ]);
  });
});

describe("Forgejo runners", () => {
  test("register on Forgejo, then install with the credentials only on stdin", async () => {
    const s = await setup();
    const forgeId = await connect(s);
    await pool(s, forgeId);
    const op = await run(s);
    expect(op.status).toBe("succeeded");
    const issued = s.fakeForgejo.issued[0]!;
    expect(issued).toMatchObject({ scope: "user", name: "box-ci-01" });
    const install = s.host.received.find((r) => r.op === "install")!;
    expect(install.env).toMatchObject({
      RF_ROOT: "~/runyard-runners/ci/forgejo-frankie/01",
      RF_NAME: "box-ci-01",
      RF_URL: "https://forgejo.test",
      RF_TOKEN: issued.token,
      RF_LABELS: "docker:host,runyard:host,runyard-pool-ci:host",
      RF_MODE: "host",
      RF_BINARY_URL:
        "https://code.forgejo.org/forgejo/runner/releases/download/v13.2.0/forgejo-runner-13.2.0-linux-amd64",
      RF_CHECKSUM: "cd".repeat(32),
    });
    expect(s.fake.calls.every((argv) => !argv.join(" ").includes(issued.token))).toBe(true);
    expect(listRegistrations(s.deps.db)).toMatchObject([
      { runnerName: "box-ci-01", runnerKind: "forgejo" },
    ]);
  });

  test("Docker mode labels run jobs in the pool's image", async () => {
    const s = await setup();
    await pool(s, await connect(s), { kind: "docker", image: "node:22-bookworm" });
    await run(s);
    expect(s.host.received.find((r) => r.op === "install")?.env).toMatchObject({
      RF_LABELS:
        "docker:docker://node:22-bookworm,runyard:docker://node:22-bookworm,runyard-pool-ci:docker://node:22-bookworm",
      RF_MODE: "docker",
    });
  });

  test("a pool's runners' needs install with no tool profile: Node.js on the machine, Docker in containers", async () => {
    const s = await setup("linux", { node: false });
    const forgeId = await connect(s);
    const poolId = await pool(s, forgeId);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items[0]).toMatchObject({
      action: "installTools",
      blocked: false,
      tools: ["node"],
      reason: "Install Node.js with the package manager.",
    });
    const op = await run(s);
    expect(op.status).toBe("succeeded");
    expect(s.host.received.find((r) => r.op === "tools-install")?.env.RF_TOOLS).toBe("node");
    // The run is in the machine's history, with who ran it.
    const events = await s.call<{ kind: string; detail: string }[]>(
      "GET",
      `/api/events?machine=${s.machine.id}`,
    );
    expect(events.find((e) => e.kind === "changesRun")?.detail).toBe(
      "Installed Node.js; installed box-ci-01 (by admin).",
    );

    const res = await s.raw("PUT", `/api/pools/${poolId}`, {
      name: "ci",
      labels: ["docker"],
      machines: [{ machineId: s.machine.id, slots: 1 }],
      scopes: [{ forgeId, kind: "user", target: "frankie" }],

      forgejoMode: { kind: "docker", image: "node:22-bookworm" },
    });
    expect(res.status).toBe(200);

    const docker = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(docker.items.find((i) => i.action === "installTools")?.tools).toEqual(["docker"]);
  });

  test("an account with public repositories needs its name typed", async () => {
    const s = await setup();
    s.fakeForgejo.repos.push({
      id: 2,
      full_name: "frankie/site",
      private: false,
      owner: { login: "frankie" },
    });
    const forgeId = await connect(s);
    await pool(s, forgeId);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.blocked])).toEqual([["publicRepo", true]]);
    expect(review.items[0]?.reason).toContain("frankie/site");
    await s.call("POST", "/api/public-repos", { forgeId, repo: "frankie", confirm: "frankie" });
    const allowed = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(allowed.items.map((i) => i.action)).toEqual(["install"]);
  });

  test("a failed install deletes the runner it registered", async () => {
    const s = await setup();
    await pool(s, await connect(s));
    s.host.failNext = "Docker mode needs Docker installed";
    const op = await run(s);
    expect(op.status).toBe("failed");
    const events = await s.call<{ kind: string; detail: string }[]>(
      "GET",
      `/api/events?machine=${s.machine.id}`,
    );
    expect(events.find((e) => e.kind === "changesFailed")?.detail).toBe(
      "Couldn't install box-ci-01: Docker mode needs Docker installed (by admin).",
    );
    expect(s.fakeForgejo.deleted.map((d) => d.id)).toEqual([1]);

    expect(s.fakeForgejo.runners.get("user")).toEqual([]);
    expect(listRegistrations(s.deps.db)).toEqual([]);
  });

  test("removal stops the service, then deletes the runner on Forgejo", async () => {
    const s = await setup();
    const forgeId = await connect(s);
    const id = await pool(s, forgeId);
    await run(s);
    s.fakeForgejo.runners.get("user")![0]!.status = "idle";
    s.fakeForgejo.runners.get("user")![0]!.labels = ["docker", "runyard", "runyard-pool-ci"];
    await s.call("DELETE", `/api/pools/${id}`);
    const op = await run(s);
    expect(op.steps.map((st) => [st.action, st.status])).toEqual([["remove", "succeeded"]]);
    expect(s.host.received.at(-1)?.op).toBe("remove");
    expect(s.fakeForgejo.deleted.map((d) => d.id)).toEqual([1]);
    expect(listRegistrations(s.deps.db)).toEqual([]);
  });

  test("forgejo-runner only runs on Linux", async () => {
    const s = await setup("macos");
    await pool(s, await connect(s));
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.blocked])).toEqual([["unsupportedPlatform", true]]);
  });
});

test("a refresh asked for during another sees changes saved in between", async () => {
  const t = await testApp();
  await saveConnection(
    t.deps.db,
    t.deps.secrets,
    "https://forgejo.test",
    "frankie",
    t.fakeForgejo.token,
  );
  // Held until released, so the first refresh is mid-fetch when the second is asked for.
  let release!: () => void;
  t.fakeForgejo.gate = new Promise<void>((resolve) => (release = resolve));
  const first = t.forgejo.refreshAll();
  await saveConnection(
    t.deps.db,
    t.deps.secrets,
    "https://forgejo.test",
    "other",
    t.fakeForgejo.token,
  );
  const second = t.forgejo.refreshAll();
  release();
  await Promise.all([first, second]);
  expect(t.forgejo.observations().map((c) => c.login)).toEqual(["frankie", "other"]);
});

describe("Forgejo run history", () => {
  type Jobs = { jobs: JobRecord[] };

  test("a new runner records its jobs from the start; an older one gets a Record jobs step", async () => {
    const s = await setup();
    await pool(s, await connect(s));
    expect((await run(s)).status).toBe("succeeded");
    expect(listRegistrations(s.deps.db)[0]?.history).toBe(true);
    const clean = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(clean.items.map((i) => i.action)).not.toContain("recordJobs");

    // As if installed before run history: its service doesn't write the log Runyard reads.
    s.deps.db.update(registrations).set({ history: false }).run();
    for (const dir of s.host.dirs.values()) dir.history = false;
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.blocked])).toContainEqual(["recordJobs", false]);

    expect((await run(s)).status).toBe("succeeded");
    expect(s.host.received.find((r) => r.op === "record-jobs")?.env.RF_NAME).toBe("box-ci-01");
    expect(listRegistrations(s.deps.db)[0]?.history).toBe(true);
  });

  test("a task a runner logged becomes a job, and Forgejo's task list gives its result", async () => {
    const s = await setup();
    await pool(s, await connect(s));
    await run(s);
    // A real time: the jobs list covers the last 7 days by the wall clock.
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    s.fake.machines.set("ci@box", (stdin) =>
      stdin.includes("metric os")
        ? `${s.report}\nRFF\t${now}\tbox-ci-01\t7\tfrankie/app`
        : s.host.answer(stdin),
    );
    await s.monitor.checkMachines();
    let { jobs } = await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}`);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      jobId: 7,
      repo: "frankie/app",
      runnerName: "box-ci-01",
      machineId: s.machine.id,
      conclusion: null,
      hook: null,
    });
    // The live view says run history changed, so pages listing jobs read them again.
    expect(s.monitor.view.jobsAt).toBe(s.clock.now);

    const task = (status: string) => [
      {
        id: 7,
        name: "check",
        status,
        run_number: 3,
        workflow_id: "check.yml",
        url: "https://forgejo.test/frankie/app/actions/runs/3",
        run_started_at: now,
        updated_at: now,
      },
    ];
    // Still running: no result yet, and the next read (10 seconds later) asks again at once.
    s.fakeForgejo.tasks.set("frankie/app", task("running"));
    await s.history.fillForgejoResults();
    ({ jobs } = await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}`));
    expect(jobs[0]).toMatchObject({ name: "check", conclusion: null, finishedAt: null });

    s.fakeForgejo.tasks.set("frankie/app", task("success"));
    await s.history.fillForgejoResults();
    ({ jobs } = await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}`));
    expect(jobs[0]).toMatchObject({
      jobId: 7,
      runId: 3,

      name: "check",
      workflow: "check.yml",
      conclusion: "success",
      htmlUrl: "https://forgejo.test/frankie/app/actions/runs/3",
    });
    // Reading the machine's log again doesn't undo what Forgejo said.
    await s.monitor.checkMachines();
    ({ jobs } = await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}`));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ runId: 3, conclusion: "success" });

    // Forgejo 16 and later serve the log: the run by number (here not its ID), then its job.
    s.fakeForgejo.runs.set("frankie/app", [{ id: 41, number: 3, jobs: [{ id: 9, task_id: 7 }] }]);
    s.fakeForgejo.logs.set(9, "Run make\nok\n");
    expect(await s.call<{ log: string }>("GET", `/api/jobs/${jobs[0]!.id}/log`)).toEqual({
      log: "Run make\nok\n",
    });
  });

  test("Forgejo 15 has no job logs; its jobs link to the run", async () => {
    const s = await setup();
    s.fakeForgejo.version = "15.0.3+gitea-1.22.0";
    await pool(s, await connect(s));
    await run(s);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    s.fake.machines.set("ci@box", (stdin) =>
      stdin.includes("metric os")
        ? `${s.report}\nRFF\t${now}\tbox-ci-01\t7\tfrankie/app`
        : s.host.answer(stdin),
    );
    await s.monitor.checkMachines();
    const { jobs } = await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}`);
    const log = await s.raw("GET", `/api/jobs/${jobs[0]!.id}/log`);
    expect(log.status).toBe(404);
    expect(((await log.json()) as { error: string }).error).toContain("Open the job on Forgejo");
  });
});

describe("Forgejo repository scopes", () => {
  async function repoPool(s: Setup, forgeId: string, repos: string[]) {
    return s.raw("POST", "/api/pools", {
      name: "ci",
      labels: ["docker"],
      machines: [{ machineId: s.machine.id, slots: 1 }],
      scopes: repos.map((target) => ({ forgeId, kind: "repo", target })),
      forgejoMode: { kind: "host" },
    });
  }

  test("an account's repositories are offered, and a runner registers on just one", async () => {
    const s = await setup();
    s.fakeForgejo.repos.push({
      id: 2,
      full_name: "frankie/site",
      private: false,
      owner: { login: "frankie" },
    });
    const forgeId = await connect(s);
    const account = s.monitor.view.forgejo.connections[0]!.scopes.find((x) => x.kind === "user");
    expect(account?.repos).toEqual(["frankie/app", "frankie/site"]);

    expect((await repoPool(s, forgeId, ["frankie/app"])).status).toBe(201);
    // The public frankie/site doesn't hold up a runner for the private frankie/app.
    expect((await run(s)).status).toBe("succeeded");
    expect(s.fakeForgejo.issued[0]).toMatchObject({ scope: "repo:frankie/app", name: "box-ci-01" });
    expect(s.host.received.find((r) => r.op === "install")?.env.RF_ROOT).toBe(
      "~/runyard-runners/ci/forgejo-frankie-app/01",
    );
    // Watched as soon as the pool is saved: its runner shows under the repository.
    await s.forgejo.refreshAll();
    expect(
      s.monitor.view.forgejo.connections[0]!.scopes.some(
        (x) => x.kind === "repo" && x.target === "frankie/app",
      ),
    ).toBe(true);
  });

  test("a public repository needs its own name typed", async () => {
    const s = await setup();
    s.fakeForgejo.repos[0]!.private = false;
    const forgeId = await connect(s);
    await repoPool(s, forgeId, ["frankie/app"]);
    await s.forgejo.refreshAll();
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.blocked])).toEqual([["publicRepo", true]]);
    expect(review.items[0]?.reason).toBe(
      "frankie/app is public; a runner here would run its pull requests' workflows. Allow it in the pool's settings once you've locked it down.",
    );
  });

  test("a pool takes an account or its repositories, not both", async () => {
    const s = await setup();
    const forgeId = await connect(s);
    const res = await s.raw("POST", "/api/pools", {
      name: "ci",
      labels: ["docker"],
      machines: [{ machineId: s.machine.id, slots: 1 }],
      scopes: [
        { forgeId, kind: "user", target: "frankie" },
        { forgeId, kind: "repo", target: "frankie/app" },
      ],
      forgejoMode: { kind: "host" },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not both");
  });
});
