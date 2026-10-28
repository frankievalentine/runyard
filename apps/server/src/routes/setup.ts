import { Hono } from "hono";
import { requireAdmin, type AppEnv } from "../auth/identity.ts";
import { adminCount } from "../auth/users.ts";
import type { Db } from "../db/index.ts";
import type { SetupCheck, TailnetState } from "../setup/checks.ts";

export type SetupDeps = {
  db: Db;
  setupChecks: () => Promise<SetupCheck[]>;
  tailnetState: () => TailnetState;
};

export function setupRoutes({ db, setupChecks, tailnetState }: SetupDeps) {
  return (
    new Hono<AppEnv>()
      /** The control machine's setup checks, for the Getting started page. */
      .get("/setup/checks", requireAdmin(), async (c) => c.json(await setupChecks()))
      /** The tailnet address to bookmark, shown while claiming a fresh install only. */
      .get("/setup/address", (c) => {
        const state = tailnetState();
        const tailnetUrl = adminCount(db) === 0 && state.kind === "serving" ? state.url : null;
        return c.json({ tailnetUrl });
      })
  );
}
