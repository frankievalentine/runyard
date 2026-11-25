import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, requireUser, type AppEnv } from "../auth/identity.ts";
import type { UpdateChecker } from "../updates/checker.ts";
import { json } from "./validate.ts";

export type UpdateDeps = { updates: UpdateChecker };

/** Runyard's version, the latest release and how to update this host. */
export function updateRoutes({ updates }: UpdateDeps) {
  return (
    new Hono<AppEnv>()
      .get("/updates", requireUser(), (c) => c.json(updates.status()))
      /** Checks GitHub now, whether or not the daily check is on. */
      .post("/updates/check", requireAdmin(), async (c) => {
        await updates.check();
        return c.json(updates.status());
      })
      .put("/updates/settings", requireAdmin(), json(z.object({ enabled: z.boolean() })), (c) => {
        updates.setEnabled(c.req.valid("json").enabled);
        return c.json(updates.status());
      })
  );
}
