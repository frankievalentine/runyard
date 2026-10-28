import { Hono } from "hono";
import pkg from "../package.json" with { type: "json" };
import {
  identify,
  sameOriginWrites,
  type AppEnv,
  type Listener,
  type TailnetLogin,
} from "./auth/identity.ts";
import type { Challenges } from "./auth/passkeys.ts";
import type { FailureLimiter } from "./auth/rate-limit.ts";
import type { SetupCode } from "./auth/setup.ts";
import { UserError } from "./auth/users.ts";
import { serveDashboard, type DashboardAssets } from "./dashboard.ts";
import type { Db } from "./db/index.ts";
import type { MachineMonitor } from "./machines/monitor.ts";
import { authRoutes } from "./routes/auth.ts";
import { githubRoutes, type GithubDeps } from "./routes/github.ts";
import { poolRoutes } from "./routes/pools.ts";
import type { PoolEngine } from "./pools/engine.ts";
import { machineRoutes } from "./routes/machines.ts";
import { passkeyRoutes } from "./routes/passkeys.ts";
import { userRoutes } from "./routes/users.ts";

export type AppDeps = {
  db: Db;
  listener: Listener;
  setup: SetupCode;
  limiter: FailureLimiter;
  challenges: Challenges;
  tailnetLogin: TailnetLogin;
  monitor: MachineMonitor;
  /** Fictional data: the dashboard shows fleet's DEMO DATA banner. */
  demo?: boolean;
  engine: PoolEngine;
} & Omit<GithubDeps, "db" | "listener">;

export function createApi(deps: AppDeps) {
  return new Hono<AppEnv>()
    .basePath("/api")
    .use(sameOriginWrites())
    .use(identify(deps.db, deps.listener, deps.tailnetLogin))
    .get("/health", (c) => c.json({ ok: true, version: pkg.version, demo: deps.demo ?? false }))
    .route("/", authRoutes(deps))
    .route("/passkeys", passkeyRoutes(deps))
    .route("/users", userRoutes(deps.db))
    .route("/", machineRoutes(deps))
    .route("/github", githubRoutes(deps))
    .route("/", poolRoutes(deps));
}

/** Imported by the dashboard for the typed `hc` client. */
export type AppType = ReturnType<typeof createApi>;

/** In development the dashboard comes from Vite's dev server, so `dashboard` is omitted. */
export function createApp(deps: AppDeps, dashboard?: DashboardAssets) {
  const app = new Hono().route("/", createApi(deps));
  app.onError((error, c) => {
    if (error instanceof UserError) return c.json({ error: error.message }, 400);
    console.error(error);
    return c.json({ error: "Something went wrong. Check Runyard's log." }, 500);
  });
  if (dashboard) app.get("*", serveDashboard(dashboard));
  return app;
}
