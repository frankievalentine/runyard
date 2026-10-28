import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrations as allMigrations, type Migration } from "./migrations/index.ts";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof openDatabase>;

/** Opens (creating if needed) and migrates the database. Use `:memory:` in tests. */
export function openDatabase(path: string, migrations: readonly Migration[] = allMigrations) {
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(sqlite, migrations);
  return drizzle({ client: sqlite, schema, casing: "snake_case" });
}

/**
 * Applies pending migrations in order, each in its own transaction. Refuses a
 * database that has migrations this build doesn't know: it was written by a
 * newer Runyard, and running against it could lose data.
 */
export function migrate(sqlite: Database, migrations: readonly Migration[]) {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    sqlite
      .query<{ name: string }, []>("SELECT name FROM _migrations")
      .all()
      .map((r) => r.name),
  );
  const known = new Set(migrations.map((m) => m.name));
  const unknown = [...applied].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `This database was written by a newer version of Runyard (unknown migrations: ${unknown.join(", ")}). Upgrade Runyard to open it.`,
    );
  }
  const record = sqlite.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    sqlite.transaction(() => {
      for (const statement of migration.sql.split("--> statement-breakpoint")) {
        if (statement.trim()) sqlite.exec(statement);
      }
      record.run(migration.name, Date.now());
    })();
  }
}
