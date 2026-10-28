import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { dataDir } from "./config.ts";
import type { DashboardAssets } from "./dashboard.ts";
import { openDatabase } from "./db/index.ts";
import { loadSecretKey, SecretStore } from "./secrets.ts";

/**
 * Opens storage, then serves. Loopback by default: the dashboard is exposed
 * through `tailscale serve` or a reverse proxy, never directly, until
 * authentication is in place.
 */
export async function start(dashboard?: DashboardAssets) {
  const dir = dataDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const db = openDatabase(join(dir, "runyard.db"));
  const secrets = await SecretStore.open(db, await loadSecretKey(process.env, dir));

  const hostname = process.env.RUNYARD_HOST ?? "127.0.0.1";
  const port = Number(process.env.RUNYARD_PORT ?? 7420);
  const server = Bun.serve({ hostname, port, fetch: createApp(dashboard).fetch });
  console.log(`runyard listening on ${server.url.href} (data in ${dir})`);
  return { server, db, secrets };
}
