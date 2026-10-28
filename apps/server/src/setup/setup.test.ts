import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../command.ts";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import { setupChecks, type SetupCheck } from "./checks.ts";

const missingSsh: CommandRunner = async () => ({ code: 127, stdout: "", stderr: "not found" });
const okSsh: CommandRunner = async () => ({ code: 0, stdout: "", stderr: "OpenSSH_9.9p2\n" });
const byId = (checks: SetupCheck[]) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe("setup checks", () => {
  test("report a missing ssh, no key, a generated secret key and the tailnet problem", async () => {
    const home = await mkdtemp(join(tmpdir(), "runyard-home-"));
    const checks = byId(
      await setupChecks({
        run: missingSsh,
        programs: { ssh: "/usr/bin/ssh", tailscale: "tailscale" },
        tailnet: () => ({
          kind: "problem",
          message: "This tailnet can't issue HTTPS certificates.",
        }),
        dataDir: home,
        env: {},
        home,
        platform: "linux",
      }),
    );
    expect(checks.ssh).toMatchObject({
      state: "bad",
      fix: expect.stringContaining("apt install openssh-client"),
    });
    expect(checks.sshKey?.state).toBe("warn");
    expect(checks.tailnet).toMatchObject({
      state: "warn",
      detail: "This tailnet can't issue HTTPS certificates.",
    });
    expect(checks.secretKey).toMatchObject({
      state: "warn",
      detail: expect.stringContaining("secret.key"),
    });
    expect(checks.disk?.state).toBe("ok");
  });

  test("pass with ssh, a key, a key from the environment and the tailnet serving", async () => {
    const home = await mkdtemp(join(tmpdir(), "runyard-home-"));
    await mkdir(join(home, ".ssh"));
    await writeFile(join(home, ".ssh", "id_ed25519"), "key");
    const checks = await setupChecks({
      run: okSsh,
      programs: { ssh: "/usr/bin/ssh", tailscale: "tailscale" },
      tailnet: () => ({ kind: "serving", url: "https://box.tail1.ts.net:7443/" }),
      dataDir: home,
      env: { RUNYARD_SECRET_KEY: "x" },
      home,
    });
    expect(checks.map((c) => c.state)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(byId(checks).sshKey?.detail).toBe("~/.ssh/id_ed25519");
  });
});

describe("setup routes", () => {
  test("checks are for admins only", async () => {
    const t = await testApp();
    expect((await send(t.app, "GET", "/api/setup/checks")).status).toBe(401);
    const cookie = sessionCookie(
      await send(t.app, "POST", "/api/setup", {
        code: t.codes[0],
        username: "admin",
        password: "correct horse battery",
      }),
    );
    const checks = await body<SetupCheck[]>(
      send(t.app, "GET", "/api/setup/checks", undefined, { Cookie: cookie }),
    );
    expect(checks.find((c) => c.id === "ssh")).toMatchObject({
      state: "ok",
      detail: "OpenSSH_9.9p2, LibreSSL 3.3.6",
    });
    expect(checks.find((c) => c.id === "tailnet")?.state).toBe("off");
  });

  test("the tailnet address shows only until the install is claimed", async () => {
    const t = await testApp();
    t.tailnet.state = { kind: "serving", url: "https://box.tail1.ts.net:7443/" };
    expect(await body(send(t.app, "GET", "/api/setup/address"))).toEqual({
      tailnetUrl: "https://box.tail1.ts.net:7443/",
    });
    await send(t.app, "POST", "/api/setup", {
      code: t.codes[0],
      username: "admin",
      password: "correct horse battery",
    });
    expect(await body(send(t.app, "GET", "/api/setup/address"))).toEqual({ tailnetUrl: null });
  });
});
