import { isNewerVersion, updateSteps, type InstallKind, type UpdateSteps } from "@runyard/core";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { hostSettings } from "../db/schema.ts";
import type { Fetch } from "../github/client.ts";
import { isCompiled } from "../service/apply.ts";

/** GitHub's newest published release (not drafts or prereleases). */
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/frankievalentine/runyard/releases/latest";
const SETTING = "updates.check";
const DAY_MS = 24 * 60 * 60_000;
/** After starting, before the first check, so a restart loop doesn't ask GitHub each time. */
const FIRST_CHECK_MS = 60_000;
const TIMEOUT_MS = 10_000;

export type Release = { version: string; url: string; publishedAt: string | null };

export type UpdateStatus = {
  current: string;
  /** Whether Runyard asks GitHub once a day. */
  enabled: boolean;
  install: InstallKind;
  latest: Release | null;
  /** Whether `latest` is newer than what runs. */
  available: boolean;
  checkedAt: number | null;
  /** Why the last check failed, while the one before it (if any) stays in `latest`. */
  error: string | null;
  /** How to update this host, while a newer release exists. */
  steps: UpdateSteps | null;
};

/** How this Runyard was installed, from what the process can see. The Docker image says so. */
export function installKind(env: NodeJS.ProcessEnv = process.env): InstallKind {
  if (env.RUNYARD_INSTALL === "docker") return "docker";
  if (!isCompiled()) return "source";
  return env.RUNYARD_SERVICE === "1" ? "service" : "terminal";
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Asks GitHub for Runyard's latest release once a day while admins leave it on, and works out how
 * this host updates. Only reads: updating is a command an admin runs on the host.
 */
export class UpdateChecker {
  private latest: Release | null = null;
  private checkedAt: number | null = null;
  private error: string | null = null;
  private checking: Promise<void> | undefined;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      db: Db;
      fetch: Fetch;
      current: string;
      install: InstallKind;
      platform: string;
      binary: string;
      now?: () => number;
    },
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** Checks a minute after starting, then whenever a day has passed since the last check. */
  start() {
    const first = setTimeout(() => void this.tick(), FIRST_CHECK_MS);
    const hourly = setInterval(() => void this.tick(), 60 * 60_000);
    first.unref?.();
    hourly.unref?.();
    this.timers.push(first, hourly);
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** A scheduled check: only while enabled, and once a day. */
  async tick() {
    if (!this.enabled()) return;
    if (this.checkedAt !== null && this.now() - this.checkedAt < DAY_MS) return;
    await this.check();
  }

  enabled(): boolean {
    const row = this.deps.db
      .select({ value: hostSettings.value })
      .from(hostSettings)
      .where(eq(hostSettings.key, SETTING))
      .get();
    return row?.value !== "off";
  }

  setEnabled(on: boolean) {
    const value = on ? "on" : "off";
    this.deps.db
      .insert(hostSettings)
      .values({ key: SETTING, value })
      .onConflictDoUpdate({ target: hostSettings.key, set: { value } })
      .run();
  }

  /** Asks GitHub now. Concurrent calls share one request. */
  check(): Promise<void> {
    this.checking ??= this.fetchLatest().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  status(): UpdateStatus {
    const { current, install, platform, binary } = this.deps;
    const available = this.latest !== null && isNewerVersion(current, this.latest.version);
    return {
      current,
      enabled: this.enabled(),
      install,
      latest: this.latest,
      available,
      checkedAt: this.checkedAt,
      error: this.error,
      steps:
        available && this.latest
          ? updateSteps({ kind: install, platform, binary, version: this.latest.version })
          : null,
    };
  }

  private async fetchLatest() {
    try {
      const response = await this.deps.fetch(
        new Request(LATEST_RELEASE_URL, {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": `runyard/${this.deps.current}`,
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );
      if (response.status === 404) throw new Error("GitHub lists no published Runyard release.");
      if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
      const body = (await response.json()) as {
        tag_name?: unknown;
        html_url?: unknown;
        published_at?: unknown;
      };
      if (
        typeof body.tag_name !== "string" ||
        typeof body.html_url !== "string" ||
        !body.html_url.startsWith("https://github.com/")
      ) {
        throw new Error("GitHub's answer had no release in it.");
      }
      this.latest = {
        version: body.tag_name.replace(/^v/, ""),
        url: body.html_url,
        publishedAt: typeof body.published_at === "string" ? body.published_at : null,
      };
      this.error = null;
    } catch (e) {
      this.error = `Couldn't check for updates: ${message(e)}`;
    } finally {
      this.checkedAt = this.now();
    }
  }
}
