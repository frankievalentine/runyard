import { describe, expect, test } from "bun:test";
import { send, sessionCookie, testApp } from "../testing.ts";
import { ABSOLUTE_MS, createSession, IDLE_MS, resolveSession } from "./sessions.ts";
import { SetupCode } from "./setup.ts";
import { createUser, type UserView } from "./users.ts";

const PASSWORD = "correct horse battery";

async function setUpAdmin() {
  const t = testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "Admin",
    password: PASSWORD,
  });
  expect(res.status).toBe(200);
  return { ...t, cookie: sessionCookie(res) };
}

describe("setup", () => {
  test("a fresh install requires setup", async () => {
    const { app } = testApp();
    expect(await (await send(app, "GET", "/api/session")).json()).toEqual({
      user: null,
      via: null,
      tailscaleLogin: null,
      setupRequired: true,
    });
  });

  test("refuses a wrong code and keeps the real one valid", async () => {
    const { app, codes } = testApp();
    const wrong = await send(app, "POST", "/api/setup", {
      code: "0000-0000-0000",
      username: "a",
      password: PASSWORD,
    });
    expect(wrong.status).toBe(403);
    const right = await send(app, "POST", "/api/setup", {
      code: codes[0],
      username: "a",
      password: PASSWORD,
    });
    expect(right.status).toBe(200);
  });

  test("validates input before spending the code", async () => {
    const { app, codes } = testApp();
    const short = await send(app, "POST", "/api/setup", {
      code: codes[0],
      username: "a",
      password: "short",
    });
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "Passwords need at least 12 characters." });
    expect(
      (await send(app, "POST", "/api/setup", { code: codes[0], username: "a", password: PASSWORD }))
        .status,
    ).toBe(200);
  });

  test("creates a signed-in admin and can't run twice", async () => {
    const { app, codes, cookie } = await setUpAdmin();
    const session = await (
      await send(app, "GET", "/api/session", undefined, { Cookie: cookie })
    ).json();
    expect(session).toMatchObject({
      user: { username: "admin", role: "admin" },
      via: "session",
      setupRequired: false,
    });
    const again = await send(app, "POST", "/api/setup", {
      code: codes[0],
      username: "b",
      password: PASSWORD,
    });
    expect(again.status).toBe(409);
  });

  test("on the tailnet, links the admin to the Tailscale login without a password", async () => {
    const { app, codes } = testApp({ listener: "tailnet" });
    const ts = { "X-Test-Tailnet-Login": "Frankie@example.com" };
    const res = await send(app, "POST", "/api/setup", { code: codes[0] }, ts);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    const session = await (await send(app, "GET", "/api/session", undefined, ts)).json();
    expect(session).toMatchObject({
      user: { tailscaleLogin: "frankie@example.com", role: "admin" },
      via: "tailscale",
    });
  });

  test("never trusts a Tailscale-User-Login header, even on the tailnet", async () => {
    const { app, codes } = testApp({ listener: "tailnet" });
    const res = await send(
      app,
      "POST",
      "/api/setup",
      { code: codes[0] },
      { "Tailscale-User-Login": "forged@example.com" },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose a username and password." });
  });

  test("ignores Tailscale headers on TCP", async () => {
    const { app, codes } = testApp({ listener: "tcp" });
    const res = await send(
      app,
      "POST",
      "/api/setup",
      { code: codes[0] },
      { "Tailscale-User-Login": "x@example.com" },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Choose a username and password." });
  });
});

describe("sign-in", () => {
  test("logs in, resolves the session, and logs out", async () => {
    const { app } = await setUpAdmin();
    expect(
      (await send(app, "POST", "/api/login", { username: "admin", password: "wrong password!" }))
        .status,
    ).toBe(401);
    const login = await send(app, "POST", "/api/login", { username: "ADMIN", password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = sessionCookie(login);
    expect((await send(app, "GET", "/api/users", undefined, { Cookie: cookie })).status).toBe(200);
    await send(app, "POST", "/api/logout", undefined, { Cookie: cookie });
    expect((await send(app, "GET", "/api/users", undefined, { Cookie: cookie })).status).toBe(401);
  });

  test("sets HttpOnly, SameSite=Strict cookies, Secure only over HTTPS", async () => {
    const { app } = await setUpAdmin();
    const http = await send(app, "POST", "/api/login", { username: "admin", password: PASSWORD });
    const cookie = http.headers.getSetCookie()[0]!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Secure");
    const https = await app.request("https://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD }),
    });
    expect(https.headers.getSetCookie()[0]).toContain("Secure");
  });

  test("blocks a username after repeated failures, even with the right password", async () => {
    const { app } = await setUpAdmin();
    for (let i = 0; i < 10; i++)
      await send(app, "POST", "/api/login", { username: "admin", password: "nope nope nope" });
    const res = await send(app, "POST", "/api/login", { username: "admin", password: PASSWORD });
    expect(res.status).toBe(429);
  });

  test("an unknown Tailscale login on the tailnet is reported but not signed in", async () => {
    const { app } = testApp({ listener: "tailnet" });
    const res = await send(app, "GET", "/api/session", undefined, {
      "X-Test-Tailnet-Login": "stranger@example.com",
    });
    expect(await res.json()).toMatchObject({ user: null, tailscaleLogin: "stranger@example.com" });
  });

  test("changing your password signs out your other sessions", async () => {
    const { app, cookie } = await setUpAdmin();
    const other = sessionCookie(
      await send(app, "POST", "/api/login", { username: "admin", password: PASSWORD }),
    );
    const next = "an even better passphrase";
    const res = await send(
      app,
      "POST",
      "/api/me/password",
      { current: PASSWORD, next },
      { Cookie: cookie },
    );
    expect(res.status).toBe(200);
    expect((await send(app, "GET", "/api/users", undefined, { Cookie: cookie })).status).toBe(200);
    expect((await send(app, "GET", "/api/users", undefined, { Cookie: other })).status).toBe(401);
  });
});

describe("roles and users", () => {
  test("user management needs an admin", async () => {
    const { app, deps, cookie } = await setUpAdmin();
    expect((await send(app, "GET", "/api/users")).status).toBe(401);
    await createUser(deps.db, { username: "viewer", password: PASSWORD, role: "viewer" });
    const viewer = sessionCookie(
      await send(app, "POST", "/api/login", { username: "viewer", password: PASSWORD }),
    );
    expect((await send(app, "GET", "/api/users", undefined, { Cookie: viewer })).status).toBe(403);
    const list = (await (
      await send(app, "GET", "/api/users", undefined, { Cookie: cookie })
    ).json()) as UserView[];
    expect(list.map((u) => u.username)).toEqual(["admin", "viewer"]);
    expect(JSON.stringify(list)).not.toContain("argon2");
  });

  test("never removes or demotes the last admin", async () => {
    const { app, cookie } = await setUpAdmin();
    const [admin] = (await (
      await send(app, "GET", "/api/users", undefined, { Cookie: cookie })
    ).json()) as UserView[];
    const demote = await send(
      app,
      "PATCH",
      `/api/users/${admin.id}`,
      { role: "viewer" },
      { Cookie: cookie },
    );
    expect(demote.status).toBe(400);
    expect(await demote.json()).toEqual({ error: "Runyard needs at least one admin." });
    expect(
      (await send(app, "DELETE", `/api/users/${admin.id}`, undefined, { Cookie: cookie })).status,
    ).toBe(400);
  });

  test("an admin password reset signs the user out everywhere", async () => {
    const { app, cookie } = await setUpAdmin();
    const created = await send(
      app,
      "POST",
      "/api/users",
      { username: "ops", password: PASSWORD, role: "viewer" },
      { Cookie: cookie },
    );
    const { id } = (await created.json()) as UserView;
    const ops = sessionCookie(
      await send(app, "POST", "/api/login", { username: "ops", password: PASSWORD }),
    );
    await send(
      app,
      "PATCH",
      `/api/users/${id}`,
      { password: "a brand new passphrase" },
      { Cookie: cookie },
    );
    expect(
      (await send(app, "GET", "/api/session", undefined, { Cookie: ops })).json(),
    ).resolves.toMatchObject({
      user: null,
    });
  });
});

describe("cross-site protection", () => {
  test("refuses writes from another origin", async () => {
    const { app } = await setUpAdmin();
    const body = { username: "admin", password: PASSWORD };
    expect(
      (await send(app, "POST", "/api/login", body, { Origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(
      (await send(app, "POST", "/api/login", body, { "Sec-Fetch-Site": "cross-site" })).status,
    ).toBe(403);
    expect(
      (await send(app, "POST", "/api/login", body, { Origin: "http://localhost" })).status,
    ).toBe(200);
  });

  test("on the tailnet, accepts the machine's own origin and refuses forwarded hosts", async () => {
    const { app, codes } = testApp({ listener: "tailnet" });
    const body = { code: codes[0], username: "admin", password: PASSWORD };
    const forwarded = await send(app, "POST", "/api/setup", body, {
      Host: "localhost",
      "X-Forwarded-Host": "runyard.tail1234.ts.net",
      Origin: "https://runyard.tail1234.ts.net",
    });
    expect(forwarded.status).toBe(403);
    const direct = await send(app, "POST", "/api/setup", body, {
      Host: "runyard.tail1234.ts.net:7443",
      Origin: "https://runyard.tail1234.ts.net:7443",
    });
    expect(direct.status).toBe(200);
    expect(direct.headers.getSetCookie()[0]).toContain("Secure");
  });
});

describe("sessions", () => {
  test("expire after a week idle or a month in total", async () => {
    const { deps } = testApp();
    const user = await createUser(deps.db, { username: "a", password: PASSWORD, role: "admin" });
    const t0 = 1_000_000;
    const idle = createSession(deps.db, user.id, t0);
    expect(resolveSession(deps.db, idle, t0 + IDLE_MS - 1)?.id).toBe(user.id);
    expect(resolveSession(deps.db, idle, t0 + 2 * IDLE_MS)).toBeUndefined();
    const active = createSession(deps.db, user.id, t0);
    for (let t = t0; t < t0 + ABSOLUTE_MS; t += IDLE_MS / 2)
      expect(resolveSession(deps.db, active, t)).toBeDefined();
    expect(resolveSession(deps.db, active, t0 + ABSOLUTE_MS)).toBeUndefined();
  });
});

test("setup codes forgive case, dashes and look-alike characters", () => {
  const codes: string[] = [];
  const setup = new SetupCode((c) => codes.push(c));
  setup.issue();
  const code = codes[0]!;
  expect(setup.matches(code.toLowerCase().replace(/-/g, " "))).toBe(true);
  expect(setup.matches(code.replace(/0/g, "O").replace(/1/g, "I"))).toBe(true);
  setup.consume();
  expect(setup.matches(code)).toBe(false);
});
