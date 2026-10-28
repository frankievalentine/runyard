import { expect } from "bun:test";
import type { YardView } from "@runyard/core";
import { createMachine } from "../machines/store.ts";
import { macReport } from "../machines/fake.ts";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import { FakeRunnerHost } from "./fake-host.ts";
import type { OperationView } from "./engine.ts";

/** Shared by the engine and dispatcher tests. */
const PASSWORD = "correct horse battery";
const TARGET = "ci@mini";

/** An admin, a checked macOS machine running the fake host, and an installed GitHub App. */
export async function setup(installation: {
  account: string;
  type: "User" | "Organization";
  repos: string[];
}) {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: PASSWORD,
  });
  const cookie = sessionCookie(res);
  const host = new FakeRunnerHost();
  t.fake.machines.set(TARGET, (stdin) =>
    stdin.includes("metric os")
      ? macReport().replace(
          "RFM\tdiag:complete",
          "RFM\tdiag:architecture\tarm64\nRFM\tdiag:complete",
        )
      : host.answer(stdin),
  );
  const machine = createMachine(t.deps.db, {
    name: "Mini",
    sshTarget: TARGET,
    transport: "openssh",
    expectedOs: "macos",
  });
  await t.monitor.checkMachines();
  t.fakeGithub.installations = [
    { id: 1, ...installation, selection: installation.type === "User" ? "selected" : "all" },
  ];
  const { action } = await body<{ action: string }>(
    send(t.app, "POST", "/api/github/manifest", { org: null }, { Cookie: cookie }),
  );
  await t.app.request(
    `/api/github/manifest/callback?code=good-code&state=${new URL(action).searchParams.get("state")}`,
  );
  await t.github.refreshAll();
  const forgeId = (
    await body<YardView>(send(t.app, "GET", "/api/yard", undefined, { Cookie: cookie }))
  ).github.apps[0]!.forgeId;
  const call = <T>(method: string, path: string, json?: unknown) =>
    body<T>(send(t.app, method, path, json, { Cookie: cookie }));
  const raw = (method: string, path: string, json?: unknown) =>
    send(t.app, method, path, json, { Cookie: cookie });
  return { ...t, cookie, host, machine, forgeId, call, raw };
}

export type Setup = Awaited<ReturnType<typeof setup>>;

export async function pool(
  s: Setup,
  scopes: { kind: "org" | "repo"; target: string }[],
  slots = 1,
) {
  const res = await s.raw("POST", "/api/pools", {
    name: "mac",
    labels: ["xcode"],
    machines: [{ machineId: s.machine.id, slots }],
    scopes: scopes.map((sc) => ({ forgeId: s.forgeId, ...sc })),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Runs an operation to completion (it continues in the background after execute returns). */
export async function finish(s: Setup, op: OperationView): Promise<OperationView> {
  for (let i = 0; i < 100; i++) {
    const current = s.engine.operation(op.id)!;
    if (current.status !== "running") return current;
    await Bun.sleep(5);
  }
  throw new Error("operation didn't finish");
}
