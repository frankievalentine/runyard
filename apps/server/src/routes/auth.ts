import { Hono } from "hono";
import { z } from "zod";
import {
  clearSessionCookie,
  requireUser,
  setSignedOutCookie,
  type AppEnv,
  type Listener,
} from "../auth/identity.ts";
import type { FailureLimiter } from "../auth/rate-limit.ts";
import { revokeOtherSessions, revokeSession } from "../auth/sessions.ts";
import type { SetupCode } from "../auth/setup.ts";
import { sessionView, signIn } from "../auth/signin.ts";
import {
  adminCount,
  createUser,
  findById,
  setPassword,
  setSetupDismissed,
  verifyLogin,
  type User,
} from "../auth/users.ts";
import type { Db } from "../db/index.ts";
import { json, password, username } from "./validate.ts";

export type AuthDeps = { db: Db; listener: Listener; setup: SetupCode; limiter: FailureLimiter };

export function authRoutes({ db, listener, setup, limiter }: AuthDeps) {
  return new Hono<AppEnv>()
    .get("/session", (c) => {
      const { user, via } = c.get("identity");
      return c.json(sessionView(db, c, user, via));
    })
    .post(
      "/setup",
      json(
        z.object({
          code: z.string(),
          username: username.optional(),
          password: password.optional(),
        }),
      ),
      async (c) => {
        if (adminCount(db) > 0) return c.json({ error: "Runyard is already set up." }, 409);
        if (limiter.blocked("setup"))
          return c.json({ error: "Too many wrong codes. Try again later." }, 429);
        const body = c.req.valid("json");
        const { tailscaleLogin } = c.get("identity");
        if (!body.username && !tailscaleLogin)
          return c.json({ error: "Choose a username and password." }, 400);
        if (body.username && !body.password) return c.json({ error: "Choose a password." }, 400);
        if (!setup.matches(body.code)) {
          limiter.fail("setup");
          return c.json({ error: "That setup code is wrong. It's printed in Runyard's log." }, 403);
        }
        // Consumed before any await, so concurrent requests can't both create an admin.
        setup.consume();
        let user: User;
        try {
          user = await createUser(db, {
            username: body.username,
            password: body.password,
            tailscaleLogin: tailscaleLogin ?? undefined,
            role: "admin",
          });
        } catch (error) {
          setup.issue();
          throw error;
        }
        return c.json(sessionView(db, c, user, signIn(db, listener, c, user)));
      },
    )
    .post("/login", json(z.object({ username: z.string(), password: z.string() })), async (c) => {
      const body = c.req.valid("json");
      const key = `login:${body.username.trim().toLowerCase()}`;
      if (limiter.blocked(key))
        return c.json({ error: "Too many failed sign-ins. Try again later." }, 429);
      const user = await verifyLogin(db, body.username.trim(), body.password);
      if (!user) {
        limiter.fail(key);
        return c.json({ error: "Wrong username or password." }, 401);
      }
      limiter.reset(key);
      return c.json(sessionView(db, c, user, signIn(db, listener, c, user)));
    })
    .post("/login/tailscale", (c) => {
      const { tailscaleUser } = c.get("identity");
      if (!tailscaleUser)
        return c.json({ error: "This device's Tailscale login isn't a Runyard user." }, 401);
      return c.json(sessionView(db, c, tailscaleUser, signIn(db, listener, c, tailscaleUser)));
    })
    .post("/logout", (c) => {
      const { sessionToken } = c.get("identity");
      if (sessionToken) revokeSession(db, sessionToken);
      clearSessionCookie(c);
      // The device's Tailscale login would sign it straight back in otherwise.
      if (listener === "tailnet") setSignedOutCookie(c);
      return c.json({ ok: true });
    })
    .patch("/me", requireUser(), json(z.object({ setupDismissed: z.boolean() })), (c) => {
      const { user, via } = c.get("identity");
      setSetupDismissed(db, user!, c.req.valid("json").setupDismissed);
      return c.json(sessionView(db, c, findById(db, user!.id), via));
    })
    .post(
      "/me/password",
      requireUser(),
      json(z.object({ current: z.string(), next: password })),
      async (c) => {
        const { user, sessionToken } = c.get("identity");
        const body = c.req.valid("json");
        if (!user?.username)
          return c.json({ error: "You sign in through Tailscale and have no password." }, 400);
        if (!(await verifyLogin(db, user.username, body.current))) {
          return c.json({ error: "Your current password is wrong." }, 403);
        }
        await setPassword(db, user, body.next);
        revokeOtherSessions(db, user.id, sessionToken ?? undefined);
        return c.json({ ok: true });
      },
    );
}
