import { Hono } from "hono";
import pkg from "../package.json" with { type: "json" };

export const app = new Hono()
  .basePath("/api")
  .get("/health", (c) => c.json({ ok: true, version: pkg.version }));

/** Imported by the dashboard for the typed `hc` client. */
export type AppType = typeof app;
