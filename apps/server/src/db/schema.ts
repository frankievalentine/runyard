import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Encrypted credentials (forge tokens, GitHub App keys). See secrets.ts. */
export const secrets = sqliteTable("secrets", {
  id: text().primaryKey(),
  iv: blob({ mode: "buffer" }).notNull(),
  ciphertext: blob({ mode: "buffer" }).notNull(),
  updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
});
