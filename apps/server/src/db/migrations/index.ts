import init from "./0000_init.sql" with { type: "text" };
import auth from "./0001_auth.sql" with { type: "text" };

/**
 * Every migration drizzle-kit generated, oldest first. Add new files here;
 * a test fails if one is missing.
 */
export const migrations: readonly Migration[] = [
  { name: "0000_init", sql: init },
  { name: "0001_auth", sql: auth },
];

export type Migration = { name: string; sql: string };
