import { describe, expect, test } from "bun:test";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { body, send, sessionCookie, testApp } from "../testing.ts";
import type { UserView } from "./users.ts";
import { Challenges, type PasskeyView } from "./passkeys.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

const PASSWORD = "correct horse battery";
const ORIGIN = "http://localhost";

type Options<T> = { challengeId: string; options: T };

async function signedInAdmin() {
  const t = testApp();
  const res = await send(t.app, "POST", "/api/setup", {
    code: t.codes[0],
    username: "admin",
    password: PASSWORD,
  });
  return { ...t, cookie: sessionCookie(res) };
}

async function registerPasskey(
  app: ReturnType<typeof testApp>["app"],
  cookie: string,
  authenticator: SoftAuthenticator,
) {
  const { challengeId, options } = await body<Options<PublicKeyCredentialCreationOptionsJSON>>(
    send(app, "POST", "/api/passkeys/register/options", undefined, { Cookie: cookie }),
  );
  const response = await authenticator.register(options, ORIGIN);
  return send(
    app,
    "POST",
    "/api/passkeys/register/verify",
    { challengeId, name: "Laptop", response },
    { Cookie: cookie },
  );
}

async function passkeyLogin(
  app: ReturnType<typeof testApp>["app"],
  authenticator: SoftAuthenticator,
  origin = ORIGIN,
) {
  const { challengeId, options } = await body<Options<PublicKeyCredentialRequestOptionsJSON>>(
    send(app, "POST", "/api/passkeys/login/options"),
  );
  const response = await authenticator.authenticate(options, origin);
  return send(app, "POST", "/api/passkeys/login/verify", { challengeId, response });
}

describe("passkeys", () => {
  test("register, then sign in without a password", async () => {
    const { app, cookie } = await signedInAdmin();
    const authenticator = new SoftAuthenticator();
    const registered = await registerPasskey(app, cookie, authenticator);
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({
      name: "Laptop",
      rpId: "localhost",
      lastUsedAt: null,
    });

    const login = await passkeyLogin(app, authenticator);
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ user: { username: "admin" }, via: "session" });
    const fresh = sessionCookie(login);
    const list = await body<PasskeyView[]>(
      send(app, "GET", "/api/passkeys", undefined, { Cookie: fresh }),
    );
    expect(list[0]?.lastUsedAt).toBeNumber();
  });

  test("registration needs a signed-in user", async () => {
    const { app } = await signedInAdmin();
    expect((await send(app, "POST", "/api/passkeys/register/options")).status).toBe(401);
  });

  test("refuses an assertion signed for another origin", async () => {
    const { app, cookie } = await signedInAdmin();
    const authenticator = new SoftAuthenticator();
    await registerPasskey(app, cookie, authenticator);
    const res = await passkeyLogin(app, authenticator, "https://evil.example");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That passkey isn't registered for this Runyard." });
  });

  test("refuses an unknown credential", async () => {
    const { app, cookie } = await signedInAdmin();
    await registerPasskey(app, cookie, new SoftAuthenticator());
    const stranger = new SoftAuthenticator();
    await stranger.register(
      {
        challenge: "x",
        rp: { id: "localhost", name: "x" },
        user: { id: "dQ", name: "x", displayName: "x" },
        pubKeyCredParams: [],
      },
      ORIGIN,
    );
    expect((await passkeyLogin(app, stranger)).status).toBe(400);
  });

  test("a challenge can't be replayed", async () => {
    const { app, cookie } = await signedInAdmin();
    const authenticator = new SoftAuthenticator();
    await registerPasskey(app, cookie, authenticator);
    const { challengeId, options } = await body<Options<PublicKeyCredentialRequestOptionsJSON>>(
      send(app, "POST", "/api/passkeys/login/options"),
    );
    const response = await authenticator.authenticate(options, ORIGIN);
    expect(
      (await send(app, "POST", "/api/passkeys/login/verify", { challengeId, response })).status,
    ).toBe(200);
    const replay = await send(app, "POST", "/api/passkeys/login/verify", { challengeId, response });
    expect(await replay.json()).toEqual({ error: "That passkey request expired. Try again." });
  });

  test("only the owner can delete a passkey", async () => {
    const { app, cookie } = await signedInAdmin();
    const { id } = await body<PasskeyView>(registerPasskey(app, cookie, new SoftAuthenticator()));
    await send(
      app,
      "POST",
      "/api/users",
      { username: "ops", password: PASSWORD, role: "viewer" },
      { Cookie: cookie },
    );
    const ops = sessionCookie(
      await send(app, "POST", "/api/login", { username: "ops", password: PASSWORD }),
    );
    expect(
      (await send(app, "DELETE", `/api/passkeys/${id}`, undefined, { Cookie: ops })).status,
    ).toBe(404);
    expect(
      (await send(app, "DELETE", `/api/passkeys/${id}`, undefined, { Cookie: cookie })).status,
    ).toBe(200);
  });

  test("removing a user removes their passkeys", async () => {
    const { app, cookie, deps } = await signedInAdmin();
    const created = await send(
      app,
      "POST",
      "/api/users",
      { username: "ops", password: PASSWORD, role: "viewer" },
      { Cookie: cookie },
    );
    const { id: opsId } = await body<UserView>(created);
    const ops = sessionCookie(
      await send(app, "POST", "/api/login", { username: "ops", password: PASSWORD }),
    );
    await registerPasskey(app, ops, new SoftAuthenticator());
    expect(deps.db.query.passkeys.findMany().sync()).toHaveLength(1);
    await send(app, "DELETE", `/api/users/${opsId}`, undefined, { Cookie: cookie });
    expect(deps.db.query.passkeys.findMany().sync()).toEqual([]);
  });
});

test("challenges expire and are bound to their purpose", () => {
  const challenges = new Challenges();
  const relying = { origin: ORIGIN, rpId: "localhost" };
  const a = challenges.put({ challenge: "a", purpose: "login", relying }, 0);
  expect(() => challenges.take(a, "register", 1)).toThrow("expired");
  const b = challenges.put({ challenge: "b", purpose: "login", relying }, 0);
  expect(() => challenges.take(b, "login", 5 * 60 * 1000)).toThrow("expired");
});
