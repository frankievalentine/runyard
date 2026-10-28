import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { accessTokens, users } from "../db/schema.ts";
import { randomToken, sha256 } from "./tokens.ts";

export type TokenScope = "read" | "prepare";

export type AccessToken = {
  id: string;
  name: string;
  scope: TokenScope;
  prefix: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
};

const PREFIX = "ryd_";
/** Use is recorded at most this often, so calls don't each write. */
const TOUCH_MS = 60_000;

const view = (r: typeof accessTokens.$inferSelect): AccessToken => ({
  id: r.id,
  name: r.name,
  scope: r.scope,
  prefix: r.prefix,
  createdAt: r.createdAt.getTime(),
  expiresAt: r.expiresAt?.getTime() ?? null,
  lastUsedAt: r.lastUsedAt?.getTime() ?? null,
});

/** Creates a token and returns it once; only its hash is stored. */
export function createAccessToken(
  db: Db,
  userId: string,
  input: { name: string; scope: TokenScope; expiresInDays: number | null },
  now = Date.now(),
): { token: string; record: AccessToken } {
  const token = `${PREFIX}${randomToken(32)}`;
  const row = {
    id: sha256(token),
    userId,
    name: input.name,
    scope: input.scope,
    prefix: token.slice(0, PREFIX.length + 6),
    createdAt: new Date(now),
    expiresAt: input.expiresInDays ? new Date(now + input.expiresInDays * 86_400_000) : null,
    lastUsedAt: null,
  };
  db.insert(accessTokens).values(row).run();
  return { token, record: view(row) };
}

export function listAccessTokens(db: Db, userId: string): AccessToken[] {
  return db
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
    .all()
    .map(view)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Revokes one of the user's own tokens; false if there was none. */
export function revokeAccessToken(db: Db, userId: string, id: string): boolean {
  const mine = and(eq(accessTokens.id, id), eq(accessTokens.userId, userId));
  if (!db.select({ id: accessTokens.id }).from(accessTokens).where(mine).get()) return false;
  db.delete(accessTokens).where(mine).run();
  return true;
}

/** The token's user and record, or undefined when it's unknown or expired (and then deleted). */
export function resolveAccessToken(db: Db, token: string, now = Date.now()) {
  if (!token.startsWith(PREFIX)) return undefined;
  const id = sha256(token);
  const row = db
    .select({ token: accessTokens, user: users })
    .from(accessTokens)
    .innerJoin(users, eq(users.id, accessTokens.userId))
    .where(eq(accessTokens.id, id))
    .get();
  if (!row) return undefined;
  if (row.token.expiresAt && row.token.expiresAt.getTime() <= now) {
    db.delete(accessTokens).where(eq(accessTokens.id, id)).run();
    return undefined;
  }
  if (!row.token.lastUsedAt || now - row.token.lastUsedAt.getTime() >= TOUCH_MS)
    db.update(accessTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(accessTokens.id, id))
      .run();
  // A prepare token is only as strong as its user: a demoted admin's tokens only read.
  const scope: TokenScope =
    row.token.scope === "prepare" && row.user.role === "admin" ? "prepare" : "read";
  return { user: row.user, token: { ...view(row.token), scope } };
}
