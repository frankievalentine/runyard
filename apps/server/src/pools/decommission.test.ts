import { describe, expect, test } from "bun:test";
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
});
