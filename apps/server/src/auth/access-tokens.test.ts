import { describe, expect, test } from "bun:test";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import { resolveAccessToken, type AccessToken } from "./access-tokens.ts";
import { createUser } from "./users.ts";

async function admin() {
  const t = await testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: "correct horse battery",
  });
  const cookie = sessionCookie(res);
  const call = (method: string, path: string, json?: unknown) =>
    send(t.app, method, path, json, { Cookie: cookie });
  return { t, call };
}

describe("access tokens", () => {
  test("are shown once, stored by hash, listed without the secret, and revocable", async () => {
    const { t, call } = await admin();
    const created = await body<{ token: string; record: AccessToken }>(
      call("POST", "/api/tokens", { name: "Claude Code", scope: "prepare", expiresInDays: 30 }),
    );
    expect(created.token).toStartWith("ryd_");
    expect(created.record.id).not.toContain(created.token);
    const list = await body<AccessToken[]>(call("GET", "/api/tokens"));
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(created.token);
    expect(resolveAccessToken(t.deps.db, created.token)?.token.scope).toBe("prepare");
    expect((await call("DELETE", `/api/tokens/${created.record.id}`)).status).toBe(200);
    expect(resolveAccessToken(t.deps.db, created.token)).toBeUndefined();
  });

  test("expire, and never outrank their user", async () => {
    const { t, call } = await admin();
    const { token } = await body<{ token: string }>(
      call("POST", "/api/tokens", { name: "x", scope: "prepare", expiresInDays: 30 }),
    );
    expect(resolveAccessToken(t.deps.db, token, Date.now() + 31 * 86_400_000)).toBeUndefined();
    const { token: second } = await body<{ token: string }>(
      call("POST", "/api/tokens", { name: "y", scope: "prepare", expiresInDays: null }),
    );
    t.deps.db.$client.run("UPDATE users SET role = 'viewer'");
    expect(resolveAccessToken(t.deps.db, second)?.token.scope).toBe("read");
    expect(resolveAccessToken(t.deps.db, "ryd_not-a-token")).toBeUndefined();
  });

  test("viewers can only make read-only tokens, and every token needs a session to manage", async () => {
    const { t } = await admin();
    expect((await send(t.app, "GET", "/api/tokens")).status).toBe(401);
    await createUser(t.deps.db, {
      username: "vera",
      password: "viewer password 1",
      role: "viewer",
    });
    const login = await send(t.app, "POST", "/api/login", {
      username: "vera",
      password: "viewer password 1",
    });
    const viewer = { Cookie: sessionCookie(login) };
    const make = (scope: string) =>
      send(t.app, "POST", "/api/tokens", { name: "v", scope, expiresInDays: 90 }, viewer);
    expect((await make("prepare")).status).toBe(403);
    expect((await make("read")).status).toBe(201);
  });
});
