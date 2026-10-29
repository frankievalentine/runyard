import { Hono } from "hono";
import type { JobHistory } from "./history/recorder.ts";
import { historyRoutes } from "./routes/history.ts";
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
import { forgejoRoutes } from "./routes/forgejo.ts";
import { setupRoutes, type SetupDeps } from "./routes/setup.ts";
import { hostKeyRoutes } from "./routes/host-keys.ts";
import { machineSetupRoutes } from "./routes/machine-setup.ts";
import { testJobRoutes } from "./routes/test-jobs.ts";
import { tokenRoutes } from "./routes/tokens.ts";
import { mcpRoutes } from "./mcp/server.ts";
import { poolChecker } from "./routes/pools.ts";
import type { TestJobs } from "./pools/test-jobs.ts";
import type { MachineSetupCodes } from "./machines/setup-codes.ts";
import type { HostKeys } from "./machines/host-keys.ts";
import { boatRoutes } from "./routes/boat.ts";
import { webhookRoutes, type WebhookDeps } from "./routes/webhooks.ts";
import type { BoatMonitor } from "./boat/monitor.ts";
import { poolRoutes } from "./routes/pools.ts";
import type { ForgejoMonitor } from "./forgejo/monitor.ts";
import type { PoolEngine } from "./pools/engine.ts";
import type { Dispatcher } from "./pools/dispatcher.ts";
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
  /** Fictional data: the dashboard shows aarondfrancis/fleet's DEMO DATA banner. */
  demo?: boolean;
  engine: PoolEngine;
  forgejo: ForgejoMonitor;
  boat: BoatMonitor;
  webhooks: WebhookDeps["webhooks"];
  hostKeys: HostKeys;
  machineSetup: MachineSetupCodes;
  testJobs: TestJobs;
  dispatcher: Dispatcher;
  history: JobHistory;
} & Omit<GithubDeps, "db" | "listener"> &
  Omit<SetupDeps, "db">;

/**
 * Identifies the dashboard build being served: its file names carry content
 * hashes, so a new build has a new ID. Null in development, where Vite serves it.
 */
export function dashboardBuild(dashboard?: DashboardAssets): string | null {
  if (!dashboard) return null;
  const names = [...dashboard.keys()].sort().join("\n");
  return new Bun.CryptoHasher("sha256").update(names).digest("hex").slice(0, 12);
}

export function createApi(deps: AppDeps, build: string | null = null) {
  return new Hono<AppEnv>()
    .basePath("/api")
    .use(sameOriginWrites())
    .use(identify(deps.db, deps.listener, deps.tailnetLogin))
    .get("/health", (c) =>
      c.json({
        ok: true,
        version: pkg.version,
        build,
        demo: deps.demo ?? false,
        // This machine's tailnet name while Runyard serves there, for the sidebar.
        tailnetHost: (() => {
          const state = deps.tailnetState();
          return state.kind === "serving" ? new URL(state.url).hostname : null;
        })(),
      }),
    )
    .route("/", authRoutes(deps))
    .route("/passkeys", passkeyRoutes(deps))
    .route("/users", userRoutes(deps.db))
    .route("/", machineRoutes(deps))
    .route("/", hostKeyRoutes(deps))
    .route("/", machineSetupRoutes(deps))
    .route("/", testJobRoutes(deps))
    .route("/", tokenRoutes(deps))
    .route("/", historyRoutes(deps))
    .route("/", mcpRoutes({ ...deps, checkPool: poolChecker(deps) }))
    .route("/github", githubRoutes(deps))
    .route("/", poolRoutes(deps))
    .route("/forgejo", forgejoRoutes(deps))
    .route("/", setupRoutes(deps))
    .route("/boat", boatRoutes(deps))
    .route("/webhooks", webhookRoutes(deps));
}

/** Imported by the dashboard for the typed `hc` client. */
export type AppType = ReturnType<typeof createApi>;

/** In development the dashboard comes from Vite's dev server, so `dashboard` is omitted. */
export function createApp(deps: AppDeps, dashboard?: DashboardAssets) {
  const app = new Hono().route("/", createApi(deps, dashboardBuild(dashboard)));
  app.onError((error, c) => {
    if (error instanceof UserError) return c.json({ error: error.message }, 400);
    console.error(error);
    return c.json({ error: "Something went wrong. Check Runyard's log." }, 500);
  });
  if (dashboard) app.get("*", serveDashboard(dashboard, deps.listener));
  return app;
}
