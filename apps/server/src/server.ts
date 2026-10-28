import type { DashboardAssets } from "./dashboard.ts";
import { createApp } from "./app.ts";

/**
 * Loopback by default: the dashboard is exposed through `tailscale serve` or a
 * reverse proxy, never directly, until authentication is in place.
 */
export function start(dashboard?: DashboardAssets) {
  const hostname = process.env.RUNYARD_HOST ?? "127.0.0.1";
  const port = Number(process.env.RUNYARD_PORT ?? 7420);
  const server = Bun.serve({ hostname, port, fetch: createApp(dashboard).fetch });
  console.log(`runyard listening on ${server.url.href}`);
  return server;
}
