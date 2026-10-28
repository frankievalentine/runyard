import { and, eq, lt, ne, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { sessions, users } from "../db/schema.ts";
import { randomToken, sha256 } from "./tokens.ts";

/** A session ends after a week unused or a month in total, whichever comes first. */
export const IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** Activity is recorded at most this often, so reads don't each write. */
const TOUCH_MS = 60 * 1000;

/** Creates a session and returns the cookie token; only its hash is stored. */
export function createSession(db: Db, userId: string, now = Date.now()): string {
  const token = randomToken();
  db.insert(sessions)
    .values({
      id: sha256(token),
      userId,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + ABSOLUTE_MS),
    })
    .run();
  return token;
}

/** The session's user, or undefined if the token is unknown, idle too long or expired. */
export function resolveSession(db: Db, token: string, now = Date.now()) {
  const id = sha256(token);
  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return undefined;
  const { session, user } = row;
  if (session.expiresAt.getTime() <= now || session.lastSeenAt.getTime() + IDLE_MS <= now) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return undefined;
  }
  if (now - session.lastSeenAt.getTime() >= TOUCH_MS) {
    db.update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(sessions.id, id))
      .run();
  }
  return user;
}

export function revokeSession(db: Db, token: string) {
  db.delete(sessions)
    .where(eq(sessions.id, sha256(token)))
    .run();
}

/** Signs a user out everywhere except, optionally, the session making the change. */
export function revokeOtherSessions(db: Db, userId: string, keepToken?: string) {
  const keep = keepToken ? ne(sessions.id, sha256(keepToken)) : undefined;
  db.delete(sessions)
    .where(and(eq(sessions.userId, userId), keep))
    .run();
}

export function pruneSessions(db: Db, now = Date.now()) {
  db.delete(sessions)
    .where(
      or(lt(sessions.expiresAt, new Date(now)), lt(sessions.lastSeenAt, new Date(now - IDLE_MS))),
    )
    .run();
}
