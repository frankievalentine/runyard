import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { githubApps } from "../db/schema.ts";
import type { SecretStore } from "../secrets.ts";

export type GithubAppConfig = typeof githubApps.$inferSelect;

/** What GitHub returns when a manifest is converted into an app. */
export type ManifestConversion = {
  id: number;
  slug: string;
  name: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string | null;
  pem: string;
  html_url: string;
  owner: { login: string; type: string };
};

const secretIds = (id: string) => ({
  pem: `github.${id}.pem`,
  clientSecret: `github.${id}.client_secret`,
  webhookSecret: `github.${id}.webhook_secret`,
});

export function listGithubApps(db: Db): GithubAppConfig[] {
  return db.select().from(githubApps).orderBy(githubApps.createdAt).all();
}

export async function saveGithubApp(
  db: Db,
  secrets: SecretStore,
  app: ManifestConversion,
  apiBase: string,
) {
  const id = `gh_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const ids = secretIds(id);
  // Secrets first: an app row without its key would be unusable.
  await secrets.set(ids.pem, app.pem);
  await secrets.set(ids.clientSecret, app.client_secret);
  if (app.webhook_secret) await secrets.set(ids.webhookSecret, app.webhook_secret);
  const row: GithubAppConfig = {
    id,
    appId: String(app.id),
    slug: app.slug,
    name: app.name,
    clientId: app.client_id,
    owner: app.owner.login,
    ownerType: app.owner.type === "Organization" ? "Organization" : "User",
    htmlUrl: app.html_url,
    apiBase,
    createdAt: new Date(),
  };
  db.insert(githubApps).values(row).run();
  return row;
}

export async function githubAppKey(secrets: SecretStore, id: string): Promise<string | undefined> {
  return secrets.get(secretIds(id).pem);
}

/** Forgets the app here. It stays on GitHub until deleted there. */
export function deleteGithubApp(db: Db, secrets: SecretStore, id: string) {
  const ids = secretIds(id);
  for (const secret of [ids.pem, ids.clientSecret, ids.webhookSecret]) secrets.delete(secret);
  db.delete(githubApps).where(eq(githubApps.id, id)).run();
}
