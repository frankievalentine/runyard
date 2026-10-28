import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import { FIXTURE_KEY, OTHER_KEY } from "./key-fixture.ts";
import { createMachine, getMachine } from "./store.ts";

const ORIGIN = "https://runyard.example";
const keyOnly = (line: string) => line.split(" ").slice(0, 2).join(" ");

async function setup() {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: "correct horse battery",
  });
  const cookie = sessionCookie(res);
  await Bun.write(`${t.deps.ssh.identity}.pub`, `${FIXTURE_KEY}\n`);
  const machine = createMachine(t.deps.db, {
    name: "Box",
    sshTarget: "box",
    transport: "openssh",
    expectedOs: null,
  });
  const command = () =>
    send(t.app, "POST", `/api/machines/${machine.id}/setup-command`, {}, { Cookie: cookie });
  const report = (json: unknown) => send(t.app, "POST", "/api/machine-setup/report", json);
  return { t, machine, command, report };
}

describe("the one-line setup command", () => {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.RUNYARD_ORIGIN;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.RUNYARD_ORIGIN;
    else process.env.RUNYARD_ORIGIN = saved;
  });

  test("is offered over HTTPS only", async () => {
    delete process.env.RUNYARD_ORIGIN;
    const { command, t } = await setup();
    expect((await command()).status).toBe(400);
    expect(await (await t.app.request("/api/machine-setup/script.sh")).text()).toContain(
      "HTTPS only",
    );
  });

  test("serves a script with Runyard's address and key that sh can parse", async () => {
    process.env.RUNYARD_ORIGIN = ORIGIN;
    const { command, t } = await setup();
    const { posix, windows } = await body<{ posix: string; windows: string }>(command());
    expect(posix).toMatch(
      new RegExp(`^curl -fsSL ${ORIGIN}/api/machine-setup/script\\.sh \\| sh -s -- [A-Z2-9]{20}$`),
    );
    expect(windows).toContain(`irm ${ORIGIN}/api/machine-setup/script.ps1`);
    for (const path of ["script.sh", "script.ps1"]) {
      const text = await (await t.app.request(`${ORIGIN}/api/machine-setup/${path}`)).text();
      expect(text).toContain(`'${ORIGIN}/api/machine-setup/report'`);
      expect(text).toContain(`'${FIXTURE_KEY.replace("fixture", "runyard@fixture")}'`);
      expect(text).not.toContain("__RUNYARD_");
    }
    const sh = await (await t.app.request(`${ORIGIN}/api/machine-setup/script.sh`)).text();
    const parse = Bun.spawnSync(["sh", "-n"], { stdin: new TextEncoder().encode(sh) });
    expect(parse.exitCode).toBe(0);
  });

  test("a report with the code sets the user and OS and trusts exactly the reported host keys, once", async () => {
    process.env.RUNYARD_ORIGIN = ORIGIN;
    const { command, report, machine, t } = await setup();
    const code = (await body<{ posix: string }>(command())).posix.split(" ").at(-1)!;
    const sent = { code, user: "ci", os: "linux", hostKeys: [keyOnly(OTHER_KEY)] };
    expect((await report({ ...sent, code: "WRONG" })).status).toBe(403);
    expect((await report(sent)).status).toBe(200);
    expect(getMachine(t.deps.db, machine.id)).toMatchObject({
      sshTarget: "ci@box",
      expectedOs: "linux",
    });
    expect(await Bun.file(t.deps.ssh.knownHosts).text()).toBe(`box ${keyOnly(OTHER_KEY)}\n`);
    expect((await report(sent)).status).toBe(403);
  });

  test("a code stops working after 15 minutes, and a new one replaces it", async () => {
    process.env.RUNYARD_ORIGIN = ORIGIN;
    const { command, report, t } = await setup();
    const codeOf = async () => (await body<{ posix: string }>(command())).posix.split(" ").at(-1)!;
    const first = await codeOf();
    const second = await codeOf();
    const sent = (code: string) => ({ code, user: "ci", os: "linux", hostKeys: [] });
    expect((await report(sent(first))).status).toBe(403);
    t.clock.now += 16 * 60_000;
    expect((await report(sent(second))).status).toBe(403);
  });
});
