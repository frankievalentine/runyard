import init from "./0000_init.sql" with { type: "text" };
import auth from "./0001_auth.sql" with { type: "text" };
import passkeys from "./0002_passkeys.sql" with { type: "text" };
import machines from "./0003_machines.sql" with { type: "text" };
import githubApps from "./0004_github_apps.sql" with { type: "text" };
import pools from "./0005_pools.sql" with { type: "text" };
import forgejo from "./0006_forgejo.sql" with { type: "text" };
import runnerAssignments from "./0007_runner_assignments.sql" with { type: "text" };
import onDemand from "./0008_on_demand.sql" with { type: "text" };
import runnerMigrations from "./0009_runner_migrations.sql" with { type: "text" };
import toolProfiles from "./0010_tool_profiles.sql" with { type: "text" };
import poolCleanup from "./0011_pool_cleanup.sql" with { type: "text" };
import accessTokens from "./0012_access_tokens.sql" with { type: "text" };
import runyardKeyOnly from "./0013_runyard_key_only.sql" with { type: "text" };
import dispatchJob from "./0014_dispatch_job.sql" with { type: "text" };
import dispatchCleared from "./0015_dispatch_cleared.sql" with { type: "text" };
import setupDismissed from "./0016_setup_dismissed.sql" with { type: "text" };

/**
 * Every migration drizzle-kit generated, oldest first. Add new files here;
 * a test fails if one is missing.
 */
export const migrations: readonly Migration[] = [
  { name: "0000_init", sql: init },
  { name: "0001_auth", sql: auth },
  { name: "0002_passkeys", sql: passkeys },
  { name: "0003_machines", sql: machines },
  { name: "0004_github_apps", sql: githubApps },
  { name: "0005_pools", sql: pools },
  { name: "0006_forgejo", sql: forgejo },
  { name: "0007_runner_assignments", sql: runnerAssignments },
  { name: "0008_on_demand", sql: onDemand },
  { name: "0009_runner_migrations", sql: runnerMigrations },
  { name: "0010_tool_profiles", sql: toolProfiles },
  { name: "0011_pool_cleanup", sql: poolCleanup },
  { name: "0012_access_tokens", sql: accessTokens },
  { name: "0013_runyard_key_only", sql: runyardKeyOnly },
  { name: "0014_dispatch_job", sql: dispatchJob },
  { name: "0015_dispatch_cleared", sql: dispatchCleared },
  { name: "0016_setup_dismissed", sql: setupDismissed },
];

export type Migration = { name: string; sql: string };
