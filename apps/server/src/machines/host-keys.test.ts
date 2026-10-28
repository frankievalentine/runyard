import { describe, expect, test } from "bun:test";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import { FIXTURE_FINGERPRINT, FIXTURE_KEY, OTHER_FINGERPRINT, OTHER_KEY } from "./key-fixture.ts";
import { createMachine } from "./store.ts";

const keyOnly = (line: string) => line.split(" ").slice(0, 2).join(" ");

async function admin() {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: "correct horse battery",
  });
  const cookie = sessionCookie(res);
  const call = (path: string, json: unknown = {}) =>
    send(t.app, "POST", path, json, { Cookie: cookie });
  const machine = createMachine(t.deps.db, {
    name: "Box",
    sshTarget: "ci@box",
    transport: "openssh",
    expectedOs: "linux",
  });
  return { t, call, machine, file: t.deps.ssh.knownHosts };
}

describe("trusting a host key from the dashboard", () => {
  test("reads the key without signing in, and trusts it only with its fingerprint", async () => {
    const { t, call, machine, file } = await admin();
    t.fake.hostKeys.set("box", [keyOnly(FIXTURE_KEY)]);
    const scan = await body<{ host: string; fingerprint: string; trusted: boolean }>(
      call(`/api/machines/${machine.id}/host-key/scan`),
    );
    expect(scan).toMatchObject({ host: "box", fingerprint: FIXTURE_FINGERPRINT, trusted: false });
    expect(t.fake.calls.some((c) => c[0] === "ssh" && c[1] !== "-G")).toBe(false);

    const wrong = await call(`/api/machines/${machine.id}/host-key/trust`, {
      fingerprint: OTHER_FINGERPRINT,
    });
    expect(wrong.status).toBe(409);
    expect(await Bun.file(file).exists()).toBe(false);

    const ok = await call(`/api/machines/${machine.id}/host-key/trust`, {
      fingerprint: FIXTURE_FINGERPRINT,
    });
    expect(ok.status).toBe(200);
    expect(await Bun.file(file).text()).toBe(`box ${keyOnly(FIXTURE_KEY)}\n`);
  });

  test("a changed key is never replaced without saying so", async () => {
    const { t, call, machine, file } = await admin();
    t.fake.hostKeys.set("box", [keyOnly(FIXTURE_KEY)]);
    await call(`/api/machines/${machine.id}/host-key/trust`, { fingerprint: FIXTURE_FINGERPRINT });
    t.fake.hostKeys.set("box", [keyOnly(OTHER_KEY)]);
    const scan = await body<{ changed: boolean }>(
      call(`/api/machines/${machine.id}/host-key/scan`),
    );
    expect(scan.changed).toBe(true);
    const refused = await call(`/api/machines/${machine.id}/host-key/trust`, {
      fingerprint: OTHER_FINGERPRINT,
    });
    expect(refused.status).toBe(409);
    const replaced = await call(`/api/machines/${machine.id}/host-key/trust`, {
      fingerprint: OTHER_FINGERPRINT,
      replace: true,
    });
    expect(replaced.status).toBe(200);
    expect(await Bun.file(file).text()).toBe(`box ${keyOnly(OTHER_KEY)}\n`);
  });

  test("uses the host and port ssh resolves to, and leaves Tailscale SSH alone", async () => {
    const { t, call, machine, file } = await admin();
    t.fake.resolved.set("ci@box", { hostname: "box.lan", port: 2222 });
    t.fake.hostKeys.set("box.lan", [keyOnly(FIXTURE_KEY)]);
    await call(`/api/machines/${machine.id}/host-key/trust`, { fingerprint: FIXTURE_FINGERPRINT });
    expect(await Bun.file(file).text()).toBe(`[box.lan]:2222 ${keyOnly(FIXTURE_KEY)}\n`);
    expect(t.fake.calls.find((c) => c[0] === "ssh-keyscan")).toEqual([
      "ssh-keyscan",
      "-T",
      "10",
      "-p",
      "2222",
      "--",
      "box.lan",
    ]);
    const ts = createMachine(t.deps.db, {
      name: "TS",
      sshTarget: "ci@ts",
      transport: "tailscale",
      expectedOs: "linux",
    });
    expect((await call(`/api/machines/${ts.id}/host-key/scan`)).status).toBe(400);
  });
});
