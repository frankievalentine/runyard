import { expect, test } from "bun:test";
import type { FleetView } from "@runyard/core";
import { body, send, sessionCookie, testApp } from "../testing.ts";

async function admin() {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: "correct horse battery",
  });
  const cookie = sessionCookie(res);
  return {
    ...t,
    raw: (method: string, path: string, json?: unknown) =>
      send(t.app, method, path, json, { Cookie: cookie }),
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

test("connecting needs a key boat accepts, and only admins can connect", async () => {
  const t = await admin();
  expect(
    (await send(t.app, "POST", "/api/boat/connection", { token: t.fakeBoat.token })).status,
  ).toBe(401);
  const bad = await t.raw("POST", "/api/boat/connection", { token: "boat_wrong_key_123" });
  expect(((await bad.json()) as { error: string }).error).toContain("401");
  expect(t.boat.observation()).toBeNull();
  expect((await t.raw("POST", "/api/boat/connection", { token: t.fakeBoat.token })).status).toBe(
    200,
  );
});

test("boat VMs, their live cost and the plan's limits reach the view; Runyard only reads", async () => {
  const t = await admin();
  t.fakeBoat.limits.activeSandboxes = 2;
  t.fakeBoat.sandboxes = [
    {
      id: "bx_ci234567",
      name: "ci-acme-app-9005",
      state: "running",
      type: "default",
      vcpu: 4,
      memoryGB: 8,
      createdAt: iso(t.clock.now - 60_000),
      cost: { since: iso(0), seconds: 60, dollars: 0.0006 },
    },
    {
      id: "bx_scr34567",
      name: "scratch",
      state: "idle",
      type: "small",
      vcpu: 2,
      memoryGB: 4,
      createdAt: iso(t.clock.now - 7_200_000),
      cost: { since: iso(0), seconds: 3600, dollars: 0.018 },
    },
    {
      id: "bx_old34567",
      name: "old",
      state: "archived",
      type: "default",
      vcpu: 4,
      memoryGB: 8,
      createdAt: iso(0),
    },
  ];
  await t.raw("POST", "/api/boat/connection", { token: t.fakeBoat.token });
  const view = await body<FleetView>(t.raw("GET", "/api/fleet"));
  expect(view.boat?.running.map((v) => [v.id, v.jobId, v.dollars])).toEqual([
    ["bx_scr34567", null, 0.018],
    ["bx_ci234567", 9005, 0.0006],
  ]);
  expect(view.boat?.leftover.map((v) => v.id)).toEqual(["bx_scr34567"]);
  expect(view.boat?.limits).toMatchObject({
    activeSandboxes: 2,
    maxActiveSandboxes: 100,
    plan: "box_20",
    atStartLimit: false,
  });
  expect(t.fakeBoat.requests.every((r) => r.startsWith("GET "))).toBe(true);
});

test("disconnecting forgets the key and hides boat", async () => {
  const t = await admin();
  await t.raw("POST", "/api/boat/connection", { token: t.fakeBoat.token });
  await t.raw("DELETE", "/api/boat/connection");
  expect((await body<FleetView>(t.raw("GET", "/api/fleet"))).boat).toBeNull();
  await t.boat.refresh();
  expect(t.boat.observation()).toBeNull();
});
