import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/index.ts";
import type { GithubMonitor } from "../github/monitor.ts";
import { listGithubApps, webhookSecretId } from "../github/store.ts";
import type { SecretStore } from "../secrets.ts";

/** GitHub caps webhook payloads at 25 MB; workflow_job deliveries are a few kilobytes. */
const MAX_BODY = 1_000_000;
const SEEN_DELIVERIES = 1_000;
/** Deliveries arriving together cause one re-read. */
const NUDGE_DELAY_MS = 1_000;

export type DeliveryRecord = { at: number; event: string };

/**
 * Receives GitHub webhooks on their own listener. A delivery must carry a valid
 * signature from the app it names; it then nudges Runyard to re-read jobs and
 * runners through the API and run a dispatch round. A `workflow_job` delivery
 * is also recorded in run history, for display only: nothing on a machine or a
 * forge is ever changed because of what a payload says.
 */
export class WebhookReceiver {
  private seen: string[] = [];
  private pending: ReturnType<typeof setTimeout> | undefined;
  private nudging: Promise<void> = Promise.resolve();
  readonly last = new Map<string, DeliveryRecord>();
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      db: Db;
      secrets: SecretStore;
      github: GithubMonitor;
      /** What a nudge does after the re-read: publish the view and run a dispatch round. */
      afterRefresh: () => Promise<void>;
      /** A signed `workflow_job` delivery's payload, for run history. */
      onJob?: (forgeId: string, payload: unknown) => void;
      now?: () => number;
      nudgeDelayMs?: number;
    },
  ) {
    this.now = deps.now ?? Date.now;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/webhooks/github") {
      return new Response("Not found", { status: 404 });
    }
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BODY) return new Response("Too large", { status: 413 });
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_BODY) return new Response("Too large", { status: 413 });

    const appId = request.headers.get("x-github-hook-installation-target-id");
    const event = request.headers.get("x-github-event") ?? "";
    const delivery = request.headers.get("x-github-delivery") ?? "";
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const app = listGithubApps(this.deps.db).find((a) => a.appId === appId);
    const secret = app ? await this.deps.secrets.get(webhookSecretId(app.id)) : null;
    if (!app || !secret || !valid(secret, body, signature)) {
      return new Response("Signature mismatch", { status: 401 });
    }
    // GitHub redelivers on request; a delivery is acted on once.
    if (delivery && this.seen.includes(delivery)) return new Response(null, { status: 202 });
    if (delivery) {
      this.seen.push(delivery);
      if (this.seen.length > SEEN_DELIVERIES) this.seen.shift();
    }
    this.last.set(app.id, { at: this.now(), event });
    if (event === "workflow_job") {
      try {
        this.deps.onJob?.(app.id, JSON.parse(new TextDecoder().decode(body)) as unknown);
      } catch {
        // A payload that isn't JSON still nudges; history just doesn't get it.
      }
      this.nudge();
    }
    return new Response(null, { status: 202 });
  }

  /** Re-reads every installation's jobs and runners soon, once for a burst of deliveries. */
  private nudge() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.nudging = this.nudging.then(async () => {
        await Promise.all([this.deps.github.pollJobs(), this.deps.github.pollRunners()]);
        await this.deps.afterRefresh();
      });
    }, this.deps.nudgeDelayMs ?? NUDGE_DELAY_MS);
  }

  /** For tests: resolves once queued nudges have run. */
  async settled() {
    while (this.pending) await Bun.sleep(5);
    await this.nudging;
  }
}

function valid(secret: string, body: Uint8Array, header: string): boolean {
  if (!header.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
