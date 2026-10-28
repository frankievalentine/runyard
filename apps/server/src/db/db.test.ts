import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "./index.ts";
import { migrations } from "./migrations/index.ts";

test("every generated migration is registered, in order", () => {
  const files = readdirSync(join(import.meta.dir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => f.replace(/\.sql$/, ""));
  expect(migrations.map((m) => m.name)).toEqual(files);
});

test("applies pending migrations once", () => {
  const sqlite = new Database(":memory:");
  const list = [
    {
      name: "0000_a",
      sql: "CREATE TABLE a (id INTEGER);\n--> statement-breakpoint\nCREATE TABLE b (id INTEGER);",
    },
  ];
  migrate(sqlite, list);
  migrate(sqlite, list);
  migrate(sqlite, [...list, { name: "0001_c", sql: "CREATE TABLE c (id INTEGER);" }]);
  const tables = sqlite
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  expect(tables.map((t) => t.name).sort()).toEqual(["_migrations", "a", "b", "c"]);
});

test("rolls back a failed migration", () => {
  const sqlite = new Database(":memory:");
  const bad = {
    name: "0000_bad",
    sql: "CREATE TABLE a (id INTEGER);\n--> statement-breakpoint\nNOT SQL;",
  };
  expect(() => migrate(sqlite, [bad])).toThrow();
  expect(sqlite.query("SELECT name FROM sqlite_master WHERE name = 'a'").all()).toEqual([]);
  expect(sqlite.query("SELECT * FROM _migrations").all()).toEqual([]);
});

test("refuses a database written by a newer version", () => {
  const sqlite = new Database(":memory:");
  migrate(sqlite, [
    { name: "0000_a", sql: "SELECT 1;" },
    { name: "0001_b", sql: "SELECT 1;" },
  ]);
  expect(() => migrate(sqlite, [{ name: "0000_a", sql: "SELECT 1;" }])).toThrow(
    "newer version of Runyard",
  );
});
