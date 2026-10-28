import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { forgejoConnections } from "../db/schema.ts";
import type { SecretStore } from "../secrets.ts";

export type ForgejoConnection = typeof forgejoConnections.$inferSelect;

const tokenId = (id: string) => `forgejo.${id}.token`;

export function listConnections(db: Db): ForgejoConnection[] {
  return db.select().from(forgejoConnections).orderBy(forgejoConnections.createdAt).all();
}

export async function saveConnection(
  db: Db,
  secrets: SecretStore,
  baseUrl: string,
  login: string,
  token: string,
) {
  const id = `fj_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  // The token first: a connection without it would be unusable.
  await secrets.set(tokenId(id), token);
  const row = { id, baseUrl, login, createdAt: new Date() };
  db.insert(forgejoConnections).values(row).run();
  return row;
}

export async function connectionToken(secrets: SecretStore, id: string) {
  return secrets.get(tokenId(id));
}

export function deleteConnection(db: Db, secrets: SecretStore, id: string) {
  secrets.delete(tokenId(id));
  db.delete(forgejoConnections).where(eq(forgejoConnections.id, id)).run();
}
