import { Hono } from "hono";
import { z } from "zod";
import {
  requestOrigin,
  requireAdmin,
  requireUser,
  type AppEnv,
  type Listener,
} from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import type { Fetch } from "../github/client.ts";
import {
  buildManifest,
  convertManifest,
  manifestUrl,
  type ManifestStates,
} from "../github/manifest.ts";
import type { GithubMonitor } from "../github/monitor.ts";
import { deleteGithubApp, listGithubApps, saveGithubApp } from "../github/store.ts";
import type { SecretStore } from "../secrets.ts";
import { json } from "./validate.ts";

export type GithubDeps = {
  db: Db;
  secrets: SecretStore;
  listener: Listener;
  github: GithubMonitor;
  states: ManifestStates;
  fetch: Fetch;
  /** github.com and its API; GitHub Enterprise Server would differ. */
  webBase?: string;
  apiBase?: string;
  /** Demo data: never send anyone to the real GitHub to create an app. */
  demo?: boolean;
};

/** GitHub App setup through the manifest flow, and app management. */
export function githubRoutes(deps: GithubDeps) {
  const webBase = deps.webBase ?? "https://github.com";
  const apiBase = deps.apiBase ?? "https://api.github.com";
  return new Hono<AppEnv>()
    .post(
      "/manifest",
      requireAdmin(),
      json(
        z.object({
          org: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, "That isn't a GitHub organization name.")
            .nullable(),
        }),
      ),
      (c) => {
        if (deps.demo)
          return c.json({ error: "Creating a GitHub App isn't available with demo data." }, 409);
        const { org } = c.req.valid("json");
        const { origin } = requestOrigin(c, deps.listener);
        const state = deps.states.issue();
        // App names are unique across GitHub; GitHub's page lets the admin change it.
        const name = `Runyard ${randomSuffix()}`;
        return c.json({
          action: manifestUrl(webBase, org, state),
          manifest: JSON.stringify(buildManifest(name, origin)),
        });
      },
    )
    .get("/manifest/callback", async (c) => {
      const { code, state } = c.req.query();
      if (!code || !state || !deps.states.consume(state)) {
        return c.redirect("/settings/github?error=expired", 302);
      }
      try {
        const conversion = await convertManifest(deps.fetch, apiBase, code);
        const app = await saveGithubApp(deps.db, deps.secrets, conversion, apiBase);
        void deps.github.refreshAll();
        return c.redirect(`/settings/github?created=${encodeURIComponent(app.id)}`, 302);
      } catch (error) {
        console.error(error);
        return c.redirect("/settings/github?error=conversion", 302);
      }
    })
    .post("/refresh", requireUser(), async (c) => {
      await deps.github.refreshAll();
      return c.json({ ok: true });
    })
    .delete("/apps/:id", requireAdmin(), (c) => {
      const id = c.req.param("id");
      if (!listGithubApps(deps.db).some((a) => a.id === id))
        return c.json({ error: "No such GitHub App." }, 404);
      deleteGithubApp(deps.db, deps.secrets, id);
      void deps.github.refreshAll();
      return c.json({ ok: true });
    });
}

function randomSuffix() {
  return crypto.randomUUID().slice(0, 6);
}
