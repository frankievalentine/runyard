import init from "./0000_init.sql" with { type: "text" };

/**
 * Every migration drizzle-kit generated, oldest first. Add new files here;
 * a test fails if one is missing.
 */
export const migrations: readonly Migration[] = [{ name: "0000_init", sql: init }];

export type Migration = { name: string; sql: string };
