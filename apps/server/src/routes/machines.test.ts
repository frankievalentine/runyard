import { expect, test } from "bun:test";
import { macReport } from "../machines/fake.ts";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import { createUser } from "../auth/users.ts";
import type { YardView, MachineConfig } from "@runyard/core";

const PASSWORD = "correct horse battery";

async function signedIn() {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: PASSWORD,
  });
  await createUser(t.deps.db, { username: "viewer", password: PASSWORD, role: "viewer" });
  const viewer = sessionCookie(
    await send(t.app, "POST", "/api/login", { username: "viewer", password: PASSWORD }),
  );
  return { ...t, admin: sessionCookie(res), viewer };
}

test("viewers can read the yard but not change machines", async () => {
  const { app, viewer } = await signedIn();
  expect((await send(app, "GET", "/api/yard")).status).toBe(401);
  expect((await send(app, "GET", "/api/yard", undefined, { Cookie: viewer })).status).toBe(200);
  const add = await send(
    app,
    "POST",
    "/api/machines",
    { name: "Mini", sshTarget: "ci@mini", transport: "openssh" },
    { Cookie: viewer },
  );
  expect(add.status).toBe(403);
});

test("refuses SSH targets that could be read as options", async () => {
  const { app, admin } = await signedIn();
  for (const sshTarget of ["-oProxyCommand=touch /tmp/x", "ci@mini extra", ""]) {
    const res = await send(
      app,
      "POST",
      "/api/machines",
      { name: "X", sshTarget, transport: "openssh" },
      { Cookie: admin },
    );
    expect(res.status).toBe(400);
  }
});

test("adds a machine, checks it and lists its events", async () => {
  const { app, admin, fake, monitor } = await signedIn();
  fake.machines.set("ci@mini", macReport());
  const created = await body<MachineConfig>(
    send(
      app,
      "POST",
      "/api/machines",
      { name: "Mini", sshTarget: "ci@mini", transport: "openssh" },
      { Cookie: admin },
    ),
  );
  await monitor.checkNow(created.id);
  const yard = await body<YardView>(send(app, "GET", "/api/yard", undefined, { Cookie: admin }));
  expect(yard.machines[0]).toMatchObject({ name: "Mini", connection: { state: "connected" } });
  const events = await body<{ kind: string }[]>(
    send(app, "GET", `/api/events?machine=${created.id}`, undefined, { Cookie: admin }),
  );
  expect(events.map((e) => e.kind)).toContain("monitoringStarted");
});

test("adds a discovered peer, or ignores and restores it", async () => {
  const { app, admin, fake, monitor } = await signedIn();
  fake.status = {
    BackendState: "Running",
    Peer: {
      a: {
        ID: "n1",
        HostName: "box",
        DNSName: "box.tail1.ts.net.",
        OS: "linux",
        Online: true,
        sshHostKeys: ["k"],
      },
      b: { ID: "n2", HostName: "old", OS: "windows", Online: true },
    },
  };
  await monitor.pollTailnet();
  monitor.tick();
  expect(
    (await send(app, "POST", "/api/peers/n2/ignore", undefined, { Cookie: admin })).status,
  ).toBe(200);
  const added = await body<MachineConfig>(
    send(app, "POST", "/api/peers/n1/add", undefined, { Cookie: admin }),
  );
  expect(added).toMatchObject({
    sshTarget: "box.tail1.ts.net",
    transport: "tailscale",
    expectedOs: "linux",
  });
  let yard = await body<YardView>(send(app, "GET", "/api/yard", undefined, { Cookie: admin }));
  expect(yard.discovered).toEqual([]);
  expect(yard.ignored.map((p) => p.nodeId)).toEqual(["n2"]);
  await send(app, "DELETE", "/api/peers/n2/ignore", undefined, { Cookie: admin });
  yard = await body<YardView>(send(app, "GET", "/api/yard", undefined, { Cookie: admin }));
  expect(yard.discovered.map((p) => p.nodeId)).toEqual(["n2"]);
});

test("streams the yard view as server-sent events", async () => {
  const { app, viewer } = await signedIn();
  const res = await send(app, "GET", "/api/stream", undefined, { Cookie: viewer });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toContain("event: yard");
  await reader.cancel();
});
