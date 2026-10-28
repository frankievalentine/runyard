import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, type AppEnv } from "../auth/identity.ts";
import { BoatError } from "../boat/client.ts";
import type { BoatMonitor } from "../boat/monitor.ts";
import { json } from "./validate.ts";

export type BoatDeps = { boat: BoatMonitor };

/** The optional, read-only boat connection: one API key. */
export function boatRoutes({ boat }: BoatDeps) {
  return new Hono<AppEnv>()
    .post(
      "/connection",
      requireAdmin(),
      json(
        z.object({
          token: z
            .string()
            .trim()
            .regex(/^boat_[A-Za-z0-9_-]{8,200}$/, "Paste a boat API key; it starts with boat_."),
        }),
      ),
      async (c) => {
        try {
          await boat.connect(c.req.valid("json").token);
          return c.json({ ok: true });
        } catch (error) {
          if (error instanceof BoatError) return c.json({ error: error.message }, 400);
          throw error;
        }
      },
    )
    .delete("/connection", requireAdmin(), async (c) => {
      await boat.disconnect();
      return c.json({ ok: true });
    });
}
