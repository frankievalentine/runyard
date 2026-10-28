import init from "./0000_init.sql" with { type: "text" };
import auth from "./0001_auth.sql" with { type: "text" };
import passkeys from "./0002_passkeys.sql" with { type: "text" };
import machines from "./0003_machines.sql" with { type: "text" };
import githubApps from "./0004_github_apps.sql" with { type: "text" };

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
];

export type Migration = { name: string; sql: string };
