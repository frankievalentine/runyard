import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, requireUser, type AppEnv } from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import {
  ForgejoApi,
  ForgejoError,
  MIN_FORGEJO_MAJOR,
  supportedVersion,
} from "../forgejo/client.ts";
import type { ForgejoMonitor } from "../forgejo/monitor.ts";
import { deleteConnection, listConnections, saveConnection } from "../forgejo/store.ts";
import type { SecretStore } from "../secrets.ts";
import { json } from "./validate.ts";

export type ForgejoDeps = { db: Db; secrets: SecretStore; forgejo: ForgejoMonitor };

/** Forgejo connections: an instance and an access token for one user. */
export function forgejoRoutes({ db, secrets, forgejo }: ForgejoDeps) {
  return new Hono<AppEnv>()
    .post(
      "/connections",
      requireAdmin(),
      json(
        z.object({
          url: z.url("Enter the Forgejo address, such as https://codeberg.org.").max(300),
          token: z.string().trim().min(10, "Paste the access token.").max(500),
        }),
      ),
      async (c) => {
        const { url, token } = c.req.valid("json");
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
          return c.json({ error: "Use an http or https address." }, 400);
        const baseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, "");
        const api = new ForgejoApi(forgejo.fetch, baseUrl, token);
        try {
          const version = await api.version();
          if (!supportedVersion(version)) {
            return c.json(
              {
                error: `Forgejo ${version} is too old: runner management needs Forgejo ${MIN_FORGEJO_MAJOR} or later.`,
              },
              400,
            );
          }
          const login = await api.login();
          if (
            listConnections(db).some(
              (x) => x.baseUrl === baseUrl && x.login.toLowerCase() === login.toLowerCase(),
            )
          ) {
            return c.json({ error: `${login} on ${baseUrl} is already connected.` }, 409);
          }
          const conn = await saveConnection(db, secrets, baseUrl, login, token);
          await forgejo.refreshAll();
          return c.json({ id: conn.id, baseUrl, login, version }, 201);
        } catch (error) {
          if (error instanceof ForgejoError) return c.json({ error: error.message }, 400);
          throw error;
        }
      },
    )
    .delete("/connections/:id", requireAdmin(), async (c) => {
      const id = c.req.param("id");
      if (!listConnections(db).some((x) => x.id === id))
        return c.json({ error: "No such connection." }, 404);
      deleteConnection(db, secrets, id);
      await forgejo.refreshAll();
      return c.json({ ok: true });
    })
    .post("/refresh", requireUser(), async (c) => {
      await forgejo.refreshAll();
      return c.json({ ok: true });
    });
}
