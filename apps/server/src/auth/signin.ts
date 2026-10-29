import type { Context } from "hono";
import type { Db } from "../db/index.ts";
import { clearSignedOutCookie, setSessionCookie, type AppEnv, type Listener } from "./identity.ts";
import { createSession, revokeSession } from "./sessions.ts";
import { adminCount, toView, type User } from "./users.ts";

export type Via = "tailscale" | "session";

/**
 * Tailscale-linked users on the tailnet need no session: signing in undoes this
 * browser's sign-out instead. Everyone else gets a fresh session.
 */
export function signIn(db: Db, listener: Listener, c: Context<AppEnv>, user: User): Via {
  const identity = c.get("identity");
  if (identity.tailscaleLogin && identity.tailscaleLogin === user.tailscaleLogin) {
    if (identity.sessionToken) revokeSession(db, identity.sessionToken);
    clearSignedOutCookie(c);
    return "tailscale";
  }
  if (identity.sessionToken) revokeSession(db, identity.sessionToken);
  setSessionCookie(c, listener, createSession(db, user.id));
  return "session";
}

/** What `/api/session` and every sign-in endpoint return. */
export function sessionView(db: Db, c: Context<AppEnv>, user: User | undefined, via: Via | null) {
  return {
    user: user ? toView(user) : null,
    via: user ? via : null,
    tailscaleLogin: c.get("identity").tailscaleLogin,
    /** Whether that login is a Runyard user, so the sign-in screen can offer it. */
    tailscaleUser: Boolean(c.get("identity").tailscaleUser),
    setupRequired: adminCount(db) === 0,
  };
}
