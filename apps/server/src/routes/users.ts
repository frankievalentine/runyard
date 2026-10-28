import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, type AppEnv } from "../auth/identity.ts";
import { revokeOtherSessions } from "../auth/sessions.ts";
import {
  createUser,
  deleteUser,
  findById,
  listUsers,
  setPassword,
  setRole,
  toView,
} from "../auth/users.ts";
import type { Db } from "../db/index.ts";
import { roles } from "../db/schema.ts";
import { json, password, username } from "./validate.ts";

/** User management; admins only. */
export function userRoutes(db: Db) {
  return new Hono<AppEnv>()
    .use(requireAdmin())
    .get("/", (c) => c.json(listUsers(db).map(toView)))
    .post(
      "/",
      json(
        z.object({
          username: username.optional(),
          password: password.optional(),
          tailscaleLogin: z.string().trim().min(1).max(320).optional(),
          role: z.enum(roles),
        }),
      ),
      async (c) => c.json(toView(await createUser(db, c.req.valid("json"))), 201),
    )
    .patch(
      "/:id",
      json(z.object({ role: z.enum(roles).optional(), password: password.optional() })),
      async (c) => {
        const user = findById(db, c.req.param("id"));
        if (!user) return c.json({ error: "No such user." }, 404);
        const body = c.req.valid("json");
        if (body.role) setRole(db, user, body.role);
        if (body.password) {
          await setPassword(db, user, body.password);
          revokeOtherSessions(db, user.id);
        }
        return c.json(toView(findById(db, user.id)!));
      },
    )
    .delete("/:id", (c) => {
      const user = findById(db, c.req.param("id"));
      if (!user) return c.json({ error: "No such user." }, 404);
      deleteUser(db, user);
      return c.json({ ok: true });
    });
}
