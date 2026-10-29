import { describe, expect, test } from "bun:test";
import { pendingChanges, type YardView } from "@runyard/core";
import type { OperationView, Review } from "./engine.ts";
import { finish, setup, type Setup } from "./test-helpers.ts";

const LABELS = [
  "self-hosted",
  "macOS",
  "ARM64",
  "xcode",
  "runyard",
  "runyard-pool-mac",
  "runyard-runner-mini-mac-01",
];

async function poolWith(s: Setup, cleanup: string, id?: string) {
  const body = {
    name: "mac",
    labels: ["xcode"],
    machines: [{ machineId: s.machine.id, slots: 1 }],
    scopes: [{ forgeId: s.forgeId, kind: "org", target: "acme" }],
    cleanup,
  };
  const res = id
    ? await s.raw("PUT", `/api/pools/${id}`, body)
    : await s.raw("POST", "/api/pools", body);
  expect(res.status).toBeLessThan(300);
  return id ?? ((await res.json()) as { id: string }).id;
}
const review = (s: Setup) => s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
const run = async (s: Setup, r: Review) =>
  finish(s, await s.call<OperationView>("POST", `/api/reviews/${r.id}/execute`, {}));
const online = async (s: Setup, busy = false) => {
  s.fakeGithub.runners.set("acme", [
    { id: 41, name: "mini-mac-01", os: "macOS", status: "online", busy, labels: LABELS },
  ]);
  await s.github.pollRunners();
};

describe("cleanup after each job", () => {
  test("a new runner gets the hook right after its install", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    await poolWith(s, "workspace");
    const r = await review(s);
    expect(r.items.map((i) => [i.action, i.cleanup ?? null])).toEqual([
      ["install", null],
      ["configureCleanup", "workspace"],
    ]);
    expect((await run(s, r)).status).toBe("succeeded");
    // So readiness shows what the run changed without waiting for the minute check.
    expect(s.rechecked).toEqual([s.machine.id]);
    const ops = s.host.received.filter((x) => x.op !== "probe");
    expect(ops.map((x) => x.op)).toEqual(["install", "cleanup-configure"]);
    expect(ops[1]?.env).toMatchObject({
      RF_ROOT: "~/runyard-runners/mac/01",
      RF_CLEANUP: "workspace",
    });
    await online(s);
    expect((await review(s)).items).toEqual([]);
  });

  test("changing it reconfigures an idle runner, and waits while one is busy", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    const id = await poolWith(s, "workspace");
    await run(s, await review(s));
    await online(s);
    await poolWith(s, "docker", id);
    expect((await review(s)).items.map((i) => [i.action, i.blocked, i.cleanup])).toEqual([
      ["configureCleanup", false, "docker"],
    ]);
    await online(s, true);
    expect((await review(s)).items.map((i) => [i.action, i.blocked])).toEqual([
      ["configureCleanup", true],
    ]);
    await online(s);
    await poolWith(s, "off", id);
    const off = await review(s);
    expect(off.items.map((i) => [i.action, i.cleanup])).toEqual([["configureCleanup", "off"]]);
    await run(s, off);
    expect((await review(s)).items).toEqual([]);
  });

  test("the machine shows a cleanup edit as waiting until it's run", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    const id = await poolWith(s, "workspace");
    await run(s, await review(s));
    await online(s);
    const waiting = async () =>
      pendingChanges(await s.call<YardView>("GET", "/api/yard"), s.machine.id);
    expect(await waiting()).toEqual([]);
    await poolWith(s, "docker", id);
    expect(await waiting()).toEqual(["Set cleanup on mini-mac-01"]);
    await run(s, await review(s));
    expect(await waiting()).toEqual([]);
  });
});
