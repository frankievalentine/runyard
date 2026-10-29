import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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
    /** When this user dismissed the overview's Getting started; null while it shows. */
    setupDismissedAt: integer({ mode: "timestamp_ms" }),
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

/**
 * Personal access tokens for agents (the MCP server only). Stored by hash; the
 * token itself is shown once. `read` tokens only read; `prepare` tokens can
 * also save settings and prepare reviews, never run them. Admins only for prepare.
 */
export const accessTokens = sqliteTable(
  "access_tokens",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    scope: text({ enum: ["read", "prepare"] }).notNull(),
    /** The token's first characters, to tell tokens apart in the list. */
    prefix: text().notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    expiresAt: integer({ mode: "timestamp_ms" }),
    lastUsedAt: integer({ mode: "timestamp_ms" }),
  },
  (t) => [index("access_tokens_user_id").on(t.userId)],
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
    /** Sign in with Runyard's own key only; machines added before this keep the user's keys. */
    runyardKeyOnly: integer({ mode: "boolean" }).notNull().default(false),
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

/**
 * GitHub Apps Runyard created through the manifest flow. The private key,
 * client secret and webhook secret live in the encrypted secret store.
 */
export const githubApps = sqliteTable("github_apps", {
  id: text().primaryKey(),
  appId: text().notNull(),
  slug: text().notNull(),
  name: text().notNull(),
  clientId: text().notNull(),
  /** The account that owns the app; a private app can only be installed there. */
  owner: text().notNull(),
  ownerType: text({ enum: ["User", "Organization"] }).notNull(),
  htmlUrl: text().notNull(),
  apiBase: text().notNull(),
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
});

/** Runner capacity. Machines and scopes are separate tables so removals cascade. */
export const pools = sqliteTable("pools", {
  id: text().primaryKey(),
  name: text().notNull().unique(),
  /** JSON array of the labels the pool's runners register with. */
  labels: text().notNull(),
  /** Where Forgejo runners run jobs: `host`, or `docker` with `forgejoImage`. */
  forgejoMode: text({ enum: ["host", "docker"] })
    .notNull()
    .default("host"),
  forgejoImage: text(),
  /** `persistent` keeps registered runners; `onDemand` starts a one-job runner per queued job. */
  mode: text({ enum: ["persistent", "onDemand"] })
    .notNull()
    .default("persistent"),
  /** On demand only: no new runners start while paused. */
  paused: integer({ mode: "boolean" }).notNull().default(false),
  /** JSON array of tool profiles its machines' reviews install where missing. */
  toolProfiles: text().notNull().default("[]"),
  /** Persistent GitHub runners: `off`, `workspace`, or `docker` (workspace and unused Docker data). */
  cleanup: text({ enum: ["off", "workspace", "docker"] })
    .notNull()
    .default("off"),
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
});

export const poolMachines = sqliteTable(
  "pool_machines",
  {
    poolId: text()
      .notNull()
      .references(() => pools.id, { onDelete: "cascade" }),
    machineId: text()
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    slots: integer().notNull(),
  },
  (t) => [
    index("pool_machines_pool").on(t.poolId),
    check("pool_machines_slots", sql`${t.slots} BETWEEN 1 AND 16`),
  ],
);

export const poolScopes = sqliteTable(
  "pool_scopes",
  {
    poolId: text()
      .notNull()
      .references(() => pools.id, { onDelete: "cascade" }),
    forgeId: text().notNull(),
    kind: text({ enum: ["user", "org", "repo"] }).notNull(),
    target: text().notNull(),
  },
  (t) => [index("pool_scopes_pool").on(t.poolId)],
);

/**
 * Runners Runyard registered, so they stay linked to their machine and can
 * be found and removed when no pool wants them. Not cascaded from pools: a
 * deleted pool's runners still exist until removed.
 */
export const registrations = sqliteTable("registrations", {
  key: text().primaryKey(),
  machineId: text().notNull(),
  runnerName: text().notNull(),
  forgeId: text().notNull(),
  scopeKind: text({ enum: ["user", "org", "repo"] }).notNull(),
  scopeTarget: text().notNull(),
  path: text().notNull(),
  serviceMode: text({ enum: ["launchagent", "systemd", "windows-service"] }).notNull(),
  runnerKind: text({ enum: ["actions", "forgejo"] })
    .notNull()
    .default("actions"),
  /** The cleanup Runyard last set up in it; null for runners installed before this was recorded. */
  cleanup: text({ enum: ["off", "workspace", "docker"] }),
  /** Runyard's job hooks are set up in it, recording its jobs for run history. */
  history: integer({ mode: "boolean" }),
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
});

/** Public personal repositories an admin allowed persistent runners for, by typing the name. */
export const publicRepoOverrides = sqliteTable(
  "public_repo_overrides",
  {
    forgeId: text().notNull(),
    repo: text().notNull(),
    confirmedBy: text().notNull(),
    confirmedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("public_repo_overrides_repo").on(t.forgeId, t.repo)],
);

/** Forgejo instances Runyard connects to as a user. The access token lives in the secret store. */
export const forgejoConnections = sqliteTable("forgejo_connections", {
  id: text().primaryKey(),
  baseUrl: text().notNull(),
  login: text().notNull(),
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
});

/**
 * Runners Runyard didn't register, placed on a machine by an admin. Display
 * only: Runyard still doesn't manage them. Names are stored lowercase.
 */
export const runnerAssignments = sqliteTable(
  "runner_assignments",
  {
    forgeId: text().notNull(),
    scopeKind: text({ enum: ["user", "org", "repo"] }).notNull(),
    scopeTarget: text().notNull(),
    runnerName: text().notNull(),
    machineId: text()
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    assignedBy: text().notNull(),
    assignedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.forgeId, t.scopeKind, t.scopeTarget, t.runnerName] })],
);

/**
 * Runners Runyard didn't install, moving into a pool: retired on the forge once
 * a runner from the pool stands in for them. Keyed like the runner's assignment,
 * which it needs and goes with.
 */
export const runnerMigrations = sqliteTable(
  "runner_migrations",
  {
    forgeId: text().notNull(),
    scopeKind: text({ enum: ["user", "org", "repo"] }).notNull(),
    scopeTarget: text().notNull(),
    runnerName: text().notNull(),
    machineId: text()
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    poolId: text()
      .notNull()
      .references(() => pools.id, { onDelete: "cascade" }),
    /** Shown in the cleanup steps only; never used to run anything. */
    path: text(),
    requestedBy: text().notNull(),
    requestedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.forgeId, t.scopeKind, t.scopeTarget, t.runnerName] })],
);

/** Runner templates Runyard installed for on-demand pools, so it can remove them later. */
export const runnerTemplates = sqliteTable("runner_templates", {
  key: text().primaryKey(),
  machineId: text()
    .notNull()
    .references(() => machines.id, { onDelete: "cascade" }),
  poolId: text().notNull(),
  poolName: text().notNull(),
  forgeId: text().notNull(),
  scopeKind: text({ enum: ["user", "org", "repo"] }).notNull(),
  scopeTarget: text().notNull(),
  runnerKind: text({ enum: ["actions", "forgejo"] }).notNull(),
  path: text().notNull(),
  serviceMode: text({ enum: ["launchagent", "systemd", "windows-service"] }).notNull(),
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
});

/** One-job runners Runyard started for queued jobs, newest kept for the pool page and the journal. */
export const dispatches = sqliteTable(
  "dispatches",
  {
    id: text().primaryKey(),
    poolId: text().notNull(),
    machineId: text()
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    runnerName: text().notNull(),
    runnerKind: text({ enum: ["actions", "forgejo"] }).notNull(),
    forgeId: text().notNull(),
    scopeKind: text({ enum: ["user", "org", "repo"] }).notNull(),
    scopeTarget: text().notNull(),
    jobId: integer().notNull(),
    jobName: text(),
    jobRepo: text(),
    jobUrl: text(),
    cleared: integer({ mode: "boolean" }).notNull().default(false),
    runnerId: integer(),
    state: text({ enum: ["starting", "running", "done", "failed"] }).notNull(),
    startedAt: integer({ mode: "timestamp_ms" }).notNull(),
    endedAt: integer({ mode: "timestamp_ms" }),
    detail: text(),
  },
  (t) => [index("dispatches_job").on(t.jobId), index("dispatches_started").on(t.startedAt)],
);

/** Jobs that ran on self-hosted runners Runyard sees, from webhooks, runner hooks and reads; kept 30 days. */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text().primaryKey(),
    forgeId: text().notNull(),
    repo: text().notNull(),
    jobId: integer(),
    runId: integer().notNull(),
    runAttempt: integer().notNull(),
    name: text(),
    workflow: text(),
    runnerName: text(),
    machineId: text(),
    poolId: text(),
    startedAt: integer({ mode: "timestamp_ms" }),
    finishedAt: integer({ mode: "timestamp_ms" }),
    conclusion: text(),
    htmlUrl: text(),
    test: integer({ mode: "boolean" }).notNull().default(false),
    hook: text({ enum: ["started", "completed"] }),
    /** JSON array of where it was seen: webhook, hook, api. */
    sources: text().notNull(),
    /** Last change, for pruning and for the newest-first lists. */
    updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("jobs_job").on(t.forgeId, t.repo, t.jobId),
    index("jobs_run").on(t.forgeId, t.repo, t.runId, t.runAttempt),
    index("jobs_machine").on(t.machineId, t.startedAt),
    index("jobs_pool").on(t.poolId, t.startedAt),
    index("jobs_updated").on(t.updatedAt),
  ],
);
