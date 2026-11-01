import { describe, expect, test } from "bun:test";
import { getMachine } from "../machines/store.ts";
import { FIXTURE_KEY } from "../machines/key-fixture.ts";
import type { OperationView, Review } from "./engine.ts";
import { listPools, listRegistrations } from "./store.ts";
import { finish, pool, setup } from "./test-helpers.ts";

describe("taking a machine out of service", () => {
  test("removal waits until its runners are gone, and Decommission gets them removed", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    await pool(s, [{ kind: "org", target: "acme" }]);
    const install = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    await finish(s, await s.call<OperationView>("POST", `/api/reviews/${install.id}/execute`, {}));
    s.fakeGithub.runners.set("acme", [
      { id: 41, name: "mini-mac-01", os: "macOS", status: "online", busy: false, labels: [] },
    ]);
    await s.github.pollRunners();

    const refused = await s.raw("DELETE", `/api/machines/${s.machine.id}`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "inUse",
      error: expect.stringContaining("mini-mac-01"),
    });
    const app = await s.raw("DELETE", `/api/github/apps/${s.forgeId}`);
    expect(app.status).toBe(409);

    expect(await s.call("POST", `/api/machines/${s.machine.id}/decommission`)).toEqual({
      pools: ["mac"],
    });
    expect(listPools(s.deps.db)[0]?.machines).toEqual([]);
    const removal = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
    expect(removal.items.map((i) => i.action)).toEqual(["remove"]);
    const op = await finish(
      s,
      await s.call<OperationView>("POST", `/api/reviews/${removal.id}/execute`, {}),
    );
    expect(op.status).toBe("succeeded");
    expect(listRegistrations(s.deps.db)).toEqual([]);

    expect((await s.raw("DELETE", `/api/machines/${s.machine.id}`)).status).toBe(200);
    expect((await s.raw("DELETE", `/api/github/apps/${s.forgeId}`)).status).toBe(200);
  });

  test("removal can clean up the machine over SSH: runner folder, then Runyard's key", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    await Bun.write(`${s.deps.ssh.identity}.pub`, `${FIXTURE_KEY}\n`);
    const res = await s.raw("DELETE", `/api/machines/${s.machine.id}?cleanUp=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      cleanedUp: expect.stringContaining("Runyard no longer has access here"),
    });
    const teardown = s.host.received.find((r) => r.op === "teardown");
    expect(teardown?.env.RUNYARD_KEY).toStartWith(FIXTURE_KEY.split(" ").slice(0, 2).join(" "));
    expect(getMachine(s.deps.db, s.machine.id)).toBeUndefined();
  });

  test("a failed cleanup leaves the machine, and removing without it still works", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: [] });
    await Bun.write(`${s.deps.ssh.identity}.pub`, `${FIXTURE_KEY}\n`);
    // A runner Runyard doesn't know about: the teardown refuses.
    s.host.dirs.set("~/runyard-runners/other/runner-1", {
      configured: true,
      service: "active",
      name: "other",
    });
    const refused = await s.raw("DELETE", `/api/machines/${s.machine.id}?cleanUp=1`);
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({
      code: "cleanUp",
      error: expect.stringContaining("A runner is still configured"),
    });
    expect(getMachine(s.deps.db, s.machine.id)).toBeDefined();
    expect((await s.raw("DELETE", `/api/machines/${s.machine.id}`)).status).toBe(200);
  });
});
