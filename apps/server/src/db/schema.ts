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

export const transports = ["openssh", "tailscale"] as const;
export const osFamilies = ["macos", "linux", "windows", "other"] as const;

/** Machines added to Runyard. Only these get SSH health checks. */
export const machines = sqliteTable(
  "machines",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    description: text().notNull().default(""),
    sshTarget: text().notNull(),
    transport: text({ enum: transports }).notNull(),
    /** The OS the machine must report; null accepts any. */
    expectedOs: text({ enum: osFamilies }),
    /** Set when added from the tailnet; links the machine to its peer. */
    tailscaleNodeId: text().unique(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [check("machines_transport", sql`${t.transport} IN ('openssh', 'tailscale')`)],
);

/** Tailnet peers hidden from Other machines. */
export const ignoredPeers = sqliteTable("ignored_peers", {
  nodeId: text().primaryKey(),
  name: text().notNull(),
  ignoredAt: integer({ mode: "timestamp_ms" }).notNull(),
});

/**
 * Monitoring baselines (core's MachineState as JSON), so a restart neither
 * repeats nor misses transitions. `target` resets them when the SSH target changes.
 */
export const machineStates = sqliteTable("machine_states", {
  machineId: text()
    .primaryKey()
    .references(() => machines.id, { onDelete: "cascade" }),
  target: text().notNull(),
  state: text().notNull(),
  updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
});

/** Observed machine events, kept for 30 days and at most 5,000 rows. */
export const machineEvents = sqliteTable(
  "machine_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    machineId: text()
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    machineName: text().notNull(),
    kind: text().notNull(),
    detail: text().notNull(),
    at: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("machine_events_machine").on(t.machineId, t.id),
    index("machine_events_at").on(t.at),
  ],
);
