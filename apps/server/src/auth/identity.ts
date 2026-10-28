import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/index.ts";
import { ABSOLUTE_MS, resolveSession } from "./sessions.ts";
import { findByTailscaleLogin, type User } from "./users.ts";

/** Which listener a request arrived on. Only the private Unix socket is reached through `tailscale serve`. */
export type Listener = "tcp" | "socket";

export type Identity = {
  user: User | undefined;
  via: "tailscale" | "session" | null;
  /** The Tailscale login `tailscale serve` vouched for, even when it matches no user. */
  tailscaleLogin: string | null;
  sessionToken: string | null;
};

export type AppEnv = { Variables: { identity: Identity } };

export const SESSION_COOKIE = "runyard_session";

/**
 * Resolves who is asking. Tailscale identity headers are trusted only on the
 * socket, which only this user and root can connect to; on TCP anyone could
 * send them, so they're ignored there. A Tailscale identity takes precedence
 * over a session cookie.
 */
export function identify(db: Db, listener: Listener): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const tailscaleLogin =
      listener === "socket" ? c.req.header("Tailscale-User-Login")?.toLowerCase() || null : null;
    const tailscaleUser = tailscaleLogin ? findByTailscaleLogin(db, tailscaleLogin) : undefined;
    const sessionToken = getCookie(c, SESSION_COOKIE) ?? null;
    if (tailscaleUser) {
      c.set("identity", { user: tailscaleUser, via: "tailscale", tailscaleLogin, sessionToken });
    } else {
      const user = sessionToken ? resolveSession(db, sessionToken) : undefined;
      c.set("identity", { user, via: user ? "session" : null, tailscaleLogin, sessionToken });
    }
    await next();
  };
}

/** Rejects cross-site writes: browsers send `Origin` and `Sec-Fetch-Site` on every POST, PATCH and DELETE. */
export function sameOriginWrites(listener: Listener): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const site = c.req.header("Sec-Fetch-Site");
      if (site && site !== "same-origin" && site !== "none")
        return c.json({ error: "Cross-site request refused." }, 403);
      const origin = c.req.header("Origin");
      if (origin) {
        const hosts = [c.req.header("Host")];
        // Behind `tailscale serve` the public host may arrive as X-Forwarded-Host.
        if (listener === "socket") hosts.push(c.req.header("X-Forwarded-Host"));
        if (!URL.canParse(origin) || !hosts.includes(new URL(origin).host)) {
          return c.json({ error: "Cross-origin request refused." }, 403);
        }
      }
    }
    await next();
  };
}

export function requireUser(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get("identity").user) return c.json({ error: "Sign in to continue." }, 401);
    await next();
  };
}

export function requireAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { user } = c.get("identity");
    if (!user) return c.json({ error: "Sign in to continue." }, 401);
    if (user.role !== "admin") return c.json({ error: "Only admins can do that." }, 403);
    await next();
  };
}

export function setSessionCookie(c: Context, listener: Listener, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    secure: isHttps(c, listener),
    maxAge: ABSOLUTE_MS / 1000,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * `Secure` only over HTTPS, so sign-in still works over plain HTTP on an
 * already-encrypted network such as WireGuard. The socket's proxy is trusted
 * to report the scheme.
 */
function isHttps(c: Context, listener: Listener) {
  if (listener === "socket") return c.req.header("X-Forwarded-Proto") === "https";
  return new URL(c.req.url).protocol === "https:";
}
