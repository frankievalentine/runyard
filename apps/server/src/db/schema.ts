import { sql } from "drizzle-orm";
import { blob, check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Encrypted credentials (forge tokens, GitHub App keys). See secrets.ts. */
export const secrets = sqliteTable("secrets", {
  id: text().primaryKey(),
  iv: blob({ mode: "buffer" }).notNull(),
  ciphertext: blob({ mode: "buffer" }).notNull(),
  updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
});

export const roles = ["admin", "viewer"] as const;
export type Role = (typeof roles)[number];

/**
 * Dashboard users. A user signs in with a password (`username`), through
 * Tailscale (`tailscaleLogin`), or both. Both identifiers are stored lowercased.
 */
export const users = sqliteTable(
  "users",
  {
    id: text().primaryKey(),
    username: text().unique(),
    passwordHash: text(),
    tailscaleLogin: text().unique(),
    role: text({ enum: roles }).notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    check("users_has_identity", sql`${t.username} IS NOT NULL OR ${t.tailscaleLogin} IS NOT NULL`),
    check(
      "users_password_with_username",
      sql`(${t.username} IS NULL) = (${t.passwordHash} IS NULL)`,
    ),
    check("users_role", sql`${t.role} IN ('admin', 'viewer')`),
  ],
);

/** Password sign-in sessions. `id` is the SHA-256 of the cookie token, so the table alone can't be replayed. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer({ mode: "timestamp_ms" }).notNull(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("sessions_user_id").on(t.userId)],
);

/** WebAuthn credentials. A passkey only works on the host name (`rpId`) it was registered on. */
export const passkeys = sqliteTable(
  "passkeys",
  {
    /** The credential ID, base64url. */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: blob({ mode: "buffer" }).notNull(),
    counter: integer().notNull(),
    /** JSON array of the authenticator's transports, used as hints when signing in. */
    transports: text(),
    rpId: text().notNull(),
    name: text().notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer({ mode: "timestamp_ms" }),
  },
  (t) => [index("passkeys_user_id").on(t.userId)],
);
