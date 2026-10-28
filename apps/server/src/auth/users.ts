import { count, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { users, type Role } from "../db/schema.ts";

export type User = typeof users.$inferSelect;

/** What the API returns about a user; never the password hash. */
export type UserView = {
  id: string;
  username: string | null;
  tailscaleLogin: string | null;
  role: Role;
  createdAt: number;
};

export const PASSWORD_MIN = 12;

export function toView(user: User): UserView {
  const { id, username, tailscaleLogin, role, createdAt } = user;
  return { id, username, tailscaleLogin, role, createdAt: createdAt.getTime() };
}

export class UserError extends Error {}

export function findById(db: Db, id: string) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function findByUsername(db: Db, username: string) {
  return db.select().from(users).where(eq(users.username, username.toLowerCase())).get();
}

export function findByTailscaleLogin(db: Db, login: string) {
  return db.select().from(users).where(eq(users.tailscaleLogin, login.toLowerCase())).get();
}

export function listUsers(db: Db) {
  return db.select().from(users).orderBy(users.createdAt).all();
}

export function adminCount(db: Db): number {
  return db.select({ n: count() }).from(users).where(eq(users.role, "admin")).get()?.n ?? 0;
}

export async function createUser(
  db: Db,
  input: { username?: string; password?: string; tailscaleLogin?: string; role: Role },
): Promise<User> {
  const username = input.username?.trim().toLowerCase() || null;
  const tailscaleLogin = input.tailscaleLogin?.trim().toLowerCase() || null;
  if (!username && !tailscaleLogin)
    throw new UserError("A user needs a username or a Tailscale login.");
  if (username && !input.password) throw new UserError("A user with a username needs a password.");
  if (!username && input.password) throw new UserError("A password needs a username.");
  if (username && findByUsername(db, username))
    throw new UserError(`The username ${username} is taken.`);
  if (tailscaleLogin && findByTailscaleLogin(db, tailscaleLogin)) {
    throw new UserError(`${tailscaleLogin} already belongs to a user.`);
  }
  const user: User = {
    id: crypto.randomUUID(),
    username,
    passwordHash: input.password ? await hashPassword(input.password) : null,
    tailscaleLogin,
    role: input.role,
    createdAt: new Date(),
  };
  db.insert(users).values(user).run();
  return user;
}

/** Changes a role, refusing to demote the last admin. */
export function setRole(db: Db, user: User, role: Role) {
  if (user.role === "admin" && role !== "admin" && adminCount(db) === 1) {
    throw new UserError("Runyard needs at least one admin.");
  }
  db.update(users).set({ role }).where(eq(users.id, user.id)).run();
}

export async function setPassword(db: Db, user: User, password: string) {
  if (!user.username)
    throw new UserError("This user signs in through Tailscale and has no password.");
  db.update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, user.id))
    .run();
}

/** Deletes a user and, through the foreign key, their sessions. Refuses the last admin. */
export function deleteUser(db: Db, user: User) {
  if (user.role === "admin" && adminCount(db) === 1)
    throw new UserError("Runyard needs at least one admin.");
  db.delete(users).where(eq(users.id, user.id)).run();
}

function hashPassword(password: string): Promise<string> {
  if (password.length < PASSWORD_MIN) {
    throw new UserError(`Passwords need at least ${PASSWORD_MIN} characters.`);
  }
  return Bun.password.hash(password, "argon2id");
}

/** Spent on unknown usernames so a failed login takes as long as a wrong password. */
const dummyHash = Bun.password.hash(crypto.randomUUID(), "argon2id");

/** The user if the password matches, else undefined, in comparable time either way. */
export async function verifyLogin(
  db: Db,
  username: string,
  password: string,
): Promise<User | undefined> {
  const user = findByUsername(db, username);
  if (!user?.passwordHash) {
    await Bun.password.verify(password, await dummyHash);
    return undefined;
  }
  return (await Bun.password.verify(password, user.passwordHash)) ? user : undefined;
}
