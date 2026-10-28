import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, type AppEnv } from "../auth/identity.ts";
import { randomToken } from "../auth/tokens.ts";
import type { Db } from "../db/index.ts";
import { GithubError } from "../github/client.ts";
import type { GithubMonitor } from "../github/monitor.ts";
import { listGithubApps, webhookSecretId } from "../github/store.ts";
import type { SecretStore } from "../secrets.ts";
import type { WebhookReceiver } from "../webhooks/receiver.ts";
import { json } from "./validate.ts";

export type WebhookDeps = {
  db: Db;
  secrets: SecretStore;
  github: GithubMonitor;
  webhooks: {
    /** The loopback port the webhook listener serves, or null when it's off. */
    port: number | null;
    receiver: WebhookReceiver;
    /** Funnel's public URL for that port, read from Tailscale. */
    funnel: (port: number) => Promise<{ url: string | null } | Error>;
  };
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** GitHub webhooks: their status for each app, and setting an app's hook to Runyard's public URL. */
export function webhookRoutes({ db, secrets, github, webhooks }: WebhookDeps) {
  return new Hono<AppEnv>()
    .get("/status", requireAdmin(), async (c) => {
      const { port } = webhooks;
      const funnel = port === null ? null : await webhooks.funnel(port);
      const apps = await Promise.all(
        listGithubApps(db).map(async (a) => {
          const http = github.appClient(a.id);
          let hookUrl: string | null = null;
          let events: string[] | null = null;
          let error: string | null = null;
          try {
            if (!http)
              throw new Error("The app's credentials aren't usable; check it under GitHub.");
            hookUrl = ((await http.get("/app/hook/config")).body as { url?: string }).url || null;
            events = ((await http.get("/app")).body as { events?: string[] }).events ?? [];
          } catch (e) {
            error = message(e);
          }
          const web = github.webBaseFor(a.id);
          return {
            forgeId: a.id,
            name: a.name,
            hookUrl,
            subscribed: events === null ? null : events.includes("workflow_job"),
            secretSet: Boolean(await secrets.get(webhookSecretId(a.id))),
            lastDelivery: webhooks.receiver.last.get(a.id) ?? null,
            // Events are chosen in the app's settings; GitHub's API can't change them.
            settingsUrl:
              a.ownerType === "Organization"
                ? `${web}/organizations/${encodeURIComponent(a.owner)}/settings/apps/${a.slug}/permissions`
                : `${web}/settings/apps/${a.slug}/permissions`,
            error,
          };
        }),
      );
      return c.json({
        port,
        funnelUrl: funnel instanceof Error || funnel === null ? null : funnel.url,
        funnelError: funnel instanceof Error ? funnel.message : null,
        apps,
      });
    })
    .post(
      "/github/:forgeId",
      requireAdmin(),
      json(
        z.object({
          url: z
            .url("Enter Runyard's public HTTPS address.")
            .startsWith("https://", "GitHub needs an https:// address."),
        }),
      ),
      async (c) => {
        const forgeId = c.req.param("forgeId");
        const http = github.appClient(forgeId);
        if (!listGithubApps(db).some((a) => a.id === forgeId) || !http) {
          return c.json({ error: "No such GitHub App, or its credentials aren't usable." }, 404);
        }
        const hookUrl = `${c.req.valid("json").url.replace(/\/+$/, "")}/webhooks/github`;
        const secret = randomToken(32);
        try {
          await http.send("PATCH", "/app/hook/config", {
            url: hookUrl,
            content_type: "json",
            insecure_ssl: "0",
            secret,
          });
        } catch (e) {
          if (e instanceof GithubError) return c.json({ error: e.message }, 400);
          throw e;
        }
        // Stored only once GitHub has it, so deliveries never fail on a secret GitHub doesn't know.
        await secrets.set(webhookSecretId(forgeId), secret);
        return c.json({ ok: true, hookUrl });
      },
    );
}
