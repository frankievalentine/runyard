import type { BoatObservation } from "@runyard/core";
import type { Fetch } from "../github/client.ts";
import type { SecretStore } from "../secrets.ts";
import { BoatApi } from "./client.ts";

const TOKEN = "boat.token";
const POLL_MS = 20_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Polls boat's VMs and limits while an API key is saved. Read-only. */
export class BoatMonitor {
  private obs: BoatObservation | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshing: Promise<void> | undefined;
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      secrets: SecretStore;
      fetch: Fetch;
      now?: () => number;
      onChange?: () => void;
    },
  ) {
    this.now = deps.now ?? Date.now;
  }

  async start() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Null while no key is saved. */
  observation(): BoatObservation | null {
    return this.obs;
  }

  async connect(token: string) {
    const api = new BoatApi(this.deps.fetch, token);
    // Both reads must work before the key is kept.
    await Promise.all([api.limits(), api.runningSandboxes()]);
    await this.deps.secrets.set(TOKEN, token);
    await this.refresh();
  }

  async disconnect() {
    this.deps.secrets.delete(TOKEN);
    this.obs = null;
    this.deps.onChange?.();
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.read().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async read() {
    const token = await this.deps.secrets.get(TOKEN);
    if (!token) {
      this.obs = null;
      return;
    }
    const api = new BoatApi(this.deps.fetch, token);
    const prev = this.obs ?? { sandboxes: null, limits: null, error: null };
    const [sandboxes, limits] = await Promise.allSettled([api.runningSandboxes(), api.limits()]);
    const at = this.now();
    const errors = [sandboxes, limits].flatMap((r) =>
      r.status === "rejected" ? [message(r.reason)] : [],
    );
    // A failed read keeps the last good one, which goes stale.
    this.obs = {
      sandboxes: sandboxes.status === "fulfilled" ? { at, value: sandboxes.value } : prev.sandboxes,
      limits: limits.status === "fulfilled" ? { at, value: limits.value } : prev.limits,
      error: errors[0] ?? null,
    };
    this.deps.onChange?.();
  }
}
