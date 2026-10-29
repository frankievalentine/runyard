import { Hono } from "hono";
import { z } from "zod";
import {
  createAccessToken,
  listAccessTokens,
  revokeAccessToken,
  setAccessTokenScope,
} from "../auth/access-tokens.ts";
import { requireUser, type AppEnv } from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import { json } from "./validate.ts";

/** The signed-in user's own access tokens, for agents using the MCP server. */
export function tokenRoutes({ db }: { db: Db }) {
  return new Hono<AppEnv>()
    .get("/tokens", requireUser(), (c) => c.json(listAccessTokens(db, c.get("identity").user!.id)))
    .post(
      "/tokens",
      requireUser(),
      json(
        z.object({
          name: z.string().trim().min(1, "Name the token, such as the agent that uses it.").max(60),
          scope: z.enum(["read", "prepare"]),
          expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
        }),
      ),
      (c) => {
        const user = c.get("identity").user!;
        const input = c.req.valid("json");
        if (input.scope === "prepare" && user.role !== "admin")
          return c.json({ error: "Only admins can create tokens that prepare changes." }, 403);
        return c.json(createAccessToken(db, user.id, input), 201);
      },
    )
    .patch(
      "/tokens/:id",
      requireUser(),
      json(z.object({ scope: z.enum(["read", "prepare"]) })),
      (c) => {
        const user = c.get("identity").user!;
        const { scope } = c.req.valid("json");
        if (scope === "prepare" && user.role !== "admin")
          return c.json({ error: "Only admins can let a token prepare changes." }, 403);
        return setAccessTokenScope(db, user.id, c.req.param("id"), scope)
          ? c.json({ ok: true })
          : c.json({ error: "No such token." }, 404);
      },
    )
    .delete("/tokens/:id", requireUser(), (c) =>
      revokeAccessToken(db, c.get("identity").user!.id, c.req.param("id"))
        ? c.json({ ok: true })
        : c.json({ error: "No such token." }, 404),
    );
}
