import { describe, expect, test } from "bun:test";
import type { YardView } from "@runyard/core";
import { listAssignments, listMigrations } from "../machines/assignments.ts";
import type { OperationView, Review } from "./engine.ts";
import { finish, pool, setup, type Setup } from "./test-helpers.ts";

const POOL_LABELS = ["self-hosted", "macOS", "ARM64", "xcode", "runyard", "runyard-pool-mac"];

/** A pool runner installed and online, next to a runner someone registered by hand. */
async function withHandRunner(oldLabels = ["self-hosted", "macOS", "xcode"]) {
  const s = await setup({ account: "acme", type: "Organization", repos: [] });
  const poolId = await pool(s, [{ kind: "org", target: "acme" }]);
  const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
  await finish(s, await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}));
  s.fakeGithub.runners.set("acme", [
    {
      id: 41,
      name: "mini-mac-01",
      os: "macOS",
      status: "online",
      busy: false,
      labels: POOL_LABELS,
    },
    { id: 7, name: "old-mac", os: "macOS", status: "online", busy: false, labels: oldLabels },
  ]);
  await s.github.pollRunners();
  return { s, poolId };
}

const scope = (s: Setup) => ({ forgeId: s.forgeId, kind: "org", target: "acme" });
const migrate = (s: Setup, poolId: string | null, path?: string) =>
  s.raw("PUT", "/api/runners/migration", {
    scope: scope(s),
    runnerName: "old-mac",
    poolId,
    ...(path === undefined ? {} : { path }),
  });

describe("moving a runner Runyard didn't install into a pool", () => {
  test("needs the runner's machine first, and a persistent pool on it serving its scope", async () => {
    const { s, poolId } = await withHandRunner();
    expect(await (await migrate(s, poolId)).json()).toEqual({
      error: "Choose the machine it runs on first, under Runs on.",
    });
    await s.call("PUT", "/api/runners/assignment", {
      scope: scope(s),
      runnerName: "old-mac",
      machineId: s.machine.id,
    });
    expect((await migrate(s, "nope")).status).toBe(404);
    expect((await migrate(s, poolId, "relative/dir")).status).toBe(400);
    const res = s.raw("PUT", "/api/runners/migration", {
      scope: scope(s),
      runnerName: "mini-mac-01",
      poolId,
    });
    expect(await (await res).json()).toEqual({ error: "Runyard already manages this runner." });
    expect((await migrate(s, poolId, "/Users/ci/actions-runner")).status).toBe(200);
    expect(listMigrations(s.deps.db)).toMatchObject([
      { runnerName: "old-mac", poolId, path: "/Users/ci/actions-runner" },
    ]);
  });

  test("retires it on GitHub once the pool runner stands in, leaving the machine alone", async () => {
    const { s, poolId } = await withHandRunner();
    await s.call("PUT", "/api/runners/assignment", {
      scope: scope(s),
      runnerName: "old-mac",
      machineId: s.machine.id,
    });
    await migrate(s, poolId, "/Users/ci/actions-runner");
    const view = await s.call<YardView>("GET", "/api/yard");
    expect(view.pools.migrations.map((m) => m.state)).toEqual(["ready"]);

    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items.map((i) => [i.action, i.runnerName, i.blocked])).toEqual([
      ["retire", "old-mac", false],
    ]);
    const before = s.host.received.length;
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}),
    );
    expect(op.status).toBe("succeeded");
    expect(op.steps[0]?.output).toContain("cd /Users/ci/actions-runner && ./svc.sh stop");
    expect(s.fakeGithub.deletedRunners).toEqual([{ owner: "acme", id: 7 }]);
    // Only the read-only probe ran on the machine.
    expect(s.host.received.slice(before).map((r) => r.op)).toEqual(["probe"]);
    expect(listMigrations(s.deps.db)).toEqual([]);
    expect(listAssignments(s.deps.db)).toEqual([]);
  });

  test("stays blocked while the pool lacks the runner's labels or it's busy", async () => {
    const { s, poolId } = await withHandRunner(["self-hosted", "macOS", "xcode", "gpu"]);
    await s.call("PUT", "/api/runners/assignment", {
      scope: scope(s),
      runnerName: "old-mac",
      machineId: s.machine.id,
    });
    await migrate(s, poolId);
    const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(review.items).toMatchObject([{ action: "retire", blocked: true }]);
    expect(review.items[0]?.reason).toContain("gpu");
    expect(s.fakeGithub.deletedRunners).toEqual([]);
  });

  test("unassigning the runner or cancelling drops the move", async () => {
    const { s, poolId } = await withHandRunner();
    const assign = (machineId: string | null) =>
      s.call("PUT", "/api/runners/assignment", {
        scope: scope(s),
        runnerName: "old-mac",
        machineId,
      });
    await assign(s.machine.id);
    await migrate(s, poolId);
    await assign(null);
    expect(listMigrations(s.deps.db)).toEqual([]);
    await assign(s.machine.id);
    await migrate(s, poolId);
    await migrate(s, null);
    expect(listMigrations(s.deps.db)).toEqual([]);
    expect(listAssignments(s.deps.db)).toHaveLength(1);
  });
});
