import { Hono } from "hono";
import pkg from "../package.json" with { type: "json" };
import { serveDashboard, type DashboardAssets } from "./dashboard.ts";

export const api = new Hono()
  .basePath("/api")
  .get("/health", (c) => c.json({ ok: true, version: pkg.version }));

/** Imported by the dashboard for the typed `hc` client. */
export type AppType = typeof api;

/** In development the dashboard comes from Vite's dev server, so `dashboard` is omitted. */
export function createApp(dashboard?: DashboardAssets) {
  const app = new Hono().route("/", api);
  if (dashboard) app.get("*", serveDashboard(dashboard));
  return app;
}
