import { describe, expect, test } from "bun:test";
import type { FleetView } from "@runyard/core";
import { macReport } from "../machines/fake.ts";
import { createMachine } from "../machines/store.ts";
import type { OperationView, Review } from "../pools/engine.ts";
import { FakeRunnerHost } from "../pools/fake-host.ts";
import { listRegistrations } from "../pools/store.ts";
import { saveConnection } from "./store.ts";
import { body, send, sessionCookie, testApp } from "../testing.ts";

const PASSWORD = "correct horse battery";

async function setup(os: "linux" | "macos" = "linux") {
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
      `RFM\tdiag:architecture\t${os === "linux" ? "x86_64" : "arm64"}\nRFM\tdiag:complete`,
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
  return { ...t, cookie, call, raw, host, machine };
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
    const view = await s.call<FleetView>("GET", "/api/fleet");
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
