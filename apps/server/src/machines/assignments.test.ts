import { expect, test } from "bun:test";
import type { YardView } from "@runyard/core";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import { createMachine } from "./store.ts";

test("an admin places a runner on a machine, takes it off, and deleting the machine forgets it", async () => {
  const t = await testApp();
  const cookie = sessionCookie(
    await send(t.app, "POST", "/api/setup", {
      code: t.codes[0],
      username: "admin",
      password: "correct horse battery",
    }),
  );
  const raw = (method: string, path: string, json?: unknown) =>
    send(t.app, method, path, json, { Cookie: cookie });
  t.fakeForgejo.runners.set("user", [
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
  expect(
    (
      await raw("POST", "/api/forgejo/connections", {
        url: "https://forgejo.test",
        token: t.fakeForgejo.token,
      })
    ).status,
  ).toBe(201);
  const forgeId = (await body<YardView>(raw("GET", "/api/yard"))).forgejo.connections[0]!.forgeId;
  const machine = createMachine(t.deps.db, {
    name: "Laptop",
    sshTarget: "me@laptop",
    transport: "openssh",
  });
  const assign = (machineId: string | null) =>
    raw("PUT", "/api/runners/assignment", {
      scope: { forgeId, kind: "user", target: "frankie" },
      runnerName: "laptop",
      machineId,
    });

  expect((await send(t.app, "PUT", "/api/runners/assignment", {})).status).toBe(401);
  expect((await assign("m_missing")).status).toBe(404);
  expect((await assign(machine.id)).status).toBe(200);
  let view = await body<YardView>(raw("GET", "/api/yard"));
  expect(view.runners[0]).toMatchObject({ name: "laptop", machineId: machine.id });
  expect(view.assignedRunners).toEqual([view.runners[0]!.key]);

  await assign(null);
  view = await body<YardView>(raw("GET", "/api/yard"));
  expect(view.runners[0]?.machineId).toBeNull();

  await assign(machine.id);
  await raw("DELETE", `/api/machines/${machine.id}`);
  view = await body<YardView>(raw("GET", "/api/yard"));
  expect(view.runners[0]?.machineId).toBeNull();
  expect(view.assignedRunners).toEqual([]);
});
