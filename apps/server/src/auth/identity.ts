import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/index.ts";
import { ABSOLUTE_MS, resolveSession } from "./sessions.ts";
import { findByTailscaleLogin, type User } from "./users.ts";

/**
 * Which listener a request arrived on: loopback TCP (password sign-in, local
 * use, reverse proxies) or HTTPS on the tailnet, where every connection's
 * address is authenticated by WireGuard and resolved with `tailscale whois`.
 */
export type Listener = "tcp" | "tailnet";

/** The Tailscale login behind a request's connection, or null. Only called on the tailnet listener. */
export type TailnetLogin = (c: Context) => Promise<string | null>;

export type Identity = {
  user: User | undefined;
  via: "tailscale" | "session" | null;
  /** The Tailscale login of the connecting device, even when it matches no user. */
  tailscaleLogin: string | null;
  sessionToken: string | null;
};

export type AppEnv = { Variables: { identity: Identity } };

export const SESSION_COOKIE = "runyard_session";

/**
 * Resolves who is asking. On the tailnet the connecting device's owner comes
 * from Tailscale itself; no request header is trusted for identity anywhere.
 * A Tailscale identity takes precedence over a session cookie.
 */
export function identify(
  db: Db,
  listener: Listener,
  tailnetLogin: TailnetLogin,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const tailscaleLogin = listener === "tailnet" ? await tailnetLogin(c) : null;
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
export function sameOriginWrites(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const site = c.req.header("Sec-Fetch-Site");
      if (site && site !== "same-origin" && site !== "none")
        return c.json({ error: "Cross-site request refused." }, 403);
      const origin = c.req.header("Origin");
      if (origin) {
        if (!URL.canParse(origin) || new URL(origin).host !== c.req.header("Host")) {
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
 * The dashboard's origin and WebAuthn relying-party ID as the browser sees
 * them. `RUNYARD_ORIGIN` pins them (needed behind a TLS-terminating proxy on
 * TCP, whose forwarded headers can't be trusted); otherwise they come from the
 * request itself.
 */
export function requestOrigin(
  c: Context,
  listener: Listener,
  configured = process.env.RUNYARD_ORIGIN,
) {
  let origin: string;
  if (configured) origin = new URL(configured).origin;
  else if (listener === "tailnet") origin = `https://${c.req.header("Host")}`;
  else {
    const url = new URL(c.req.url);
    origin = `${url.protocol}//${c.req.header("Host") ?? url.host}`;
  }
  return { origin, rpId: new URL(origin).hostname };
}

/**
 * `Secure` only over HTTPS, so sign-in still works over plain HTTP on an
 * already-encrypted network such as WireGuard. The tailnet listener is always HTTPS.
 */
function isHttps(c: Context, listener: Listener) {
  if (listener === "tailnet") return true;
  return new URL(c.req.url).protocol === "https:";
}
