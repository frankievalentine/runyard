import type { GhRunner, GithubAppObservation, InstallationObservation, Scope } from "@runyard/core";
import type { Db } from "../db/index.ts";
import type { SecretStore } from "../secrets.ts";
import {
  installationRepos,
  listInstallations,
  MAX_REPOS,
  orgRunners,
  repoRunners,
  scanJobs,
} from "./api.ts";
import { GithubAppAuth } from "./app-auth.ts";
import { GithubHttp, type Fetch } from "./client.ts";
import { githubAppKey, listGithubApps, type GithubAppConfig } from "./store.ts";

/** aarondfrancis/fleet's cadence: runners every 20 seconds, jobs every 45; installations change rarely. */
export const RUNNERS_INTERVAL_MS = 20_000;
export const JOBS_INTERVAL_MS = 45_000;
export const INSTALLATIONS_INTERVAL_MS = 5 * 60_000;
/** Jobs are scanned in this many most recently pushed repositories per installation. */
export const JOB_REPOS = 30;

type InstallationState = {
  forgeId: string;
  http: GithubHttp;
  observation: InstallationObservation;
};
type AppState = {
  config: GithubAppConfig;
  auth: GithubAppAuth | null;
  http: GithubHttp | null;
  installations: Map<number, InstallationState>;
  error: string | null;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Reads every GitHub App's installations, runners and in-flight jobs. Calls
 * `onChange` after each poll so the yard view republishes.
 */
export class GithubMonitor {
  private apps = new Map<string, AppState>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      db: Db;
      secrets: SecretStore;
      fetch: Fetch;
      now?: () => number;
      onChange?: () => void;
    },
  ) {
    this.now = deps.now ?? Date.now;
  }

  async start() {
    await this.refreshAll();
    this.timers.push(
      setInterval(() => void this.refreshAll(), INSTALLATIONS_INTERVAL_MS),
      setInterval(() => void this.pollRunners(), RUNNERS_INTERVAL_MS),
      setInterval(() => void this.pollJobs(), JOBS_INTERVAL_MS),
    );
    for (const timer of this.timers) timer.unref();
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
  }

  observations(): GithubAppObservation[] {
    return [...this.apps.values()].map((app) => {
      const installations = [...app.installations.values()];
      return {
        forgeId: app.config.id,
        name: app.config.name,
        slug: app.config.slug,
        owner: app.config.owner,
        htmlUrl: app.config.htmlUrl,
        installations: installations.map((i) => i.observation),
        error: app.error,
        rateLimit:
          installations.map((i) => i.http.rateLimit).find((r) => r) ?? app.http?.rateLimit ?? null,
      };
    });
  }

  private refreshing: Promise<void> | undefined;
  private queued: Promise<void> | undefined;

  /**
   * Re-reads apps from storage, then every installation and its repositories,
   * then runners and jobs. Refreshes never overlap, so one app never gets two
   * clients (and two token caches). A call during a refresh gets one follow-up
   * refresh, shared with other such calls: the one in flight may have read
   * storage before the caller's change.
   */
  refreshAll(): Promise<void> {
    if (this.refreshing) {
      this.queued ??= this.refreshing.then(() => {
        this.queued = undefined;
        return this.refreshAll();
      });
      return this.queued;
    }
    this.refreshing = this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refresh() {
    await this.loadApps();
    await Promise.all([...this.apps.values()].map((app) => this.refreshInstallations(app)));
    await Promise.all([this.pollRunners(false), this.pollJobs(false)]);
    this.deps.onChange?.();
  }

  async pollRunners(notify = true) {
    await Promise.all(this.installations().map((i) => this.readRunners(i)));
    if (notify) this.deps.onChange?.();
  }

  async pollJobs(notify = true) {
    await Promise.all(this.installations().map((i) => this.readJobs(i)));
    if (notify) this.deps.onChange?.();
  }

  /**
   * The installation client that can act on a scope: the app's installation on
   * the organization, or on the account owning the repository.
   */
  /** The app-level client (authenticated as the app itself), for its own settings. */
  appClient(forgeId: string): GithubHttp | null {
    return this.apps.get(forgeId)?.http ?? null;
  }

  clientFor(scope: Scope): GithubHttp | null {
    const app = this.apps.get(scope.forgeId);
    const owner = (
      scope.kind === "repo" ? scope.target.split("/")[0]! : scope.target
    ).toLowerCase();
    for (const inst of app?.installations.values() ?? []) {
      if (inst.observation.account.toLowerCase() === owner) return inst.http;
    }
    return null;
  }

  /** Every app's web and API hosts, which machines' runners need to reach. */
  hosts(): string[] {
    return [...this.apps.values()].flatMap((app) => [
      new URL(app.config.htmlUrl ?? "https://github.com").host,
      new URL(app.config.apiBase).host,
    ]);
  }

  /** GitHub's web address for the app's account; runners register against it. */
  webBaseFor(forgeId: string): string {
    const html = this.apps.get(forgeId)?.config.htmlUrl;
    return html ? new URL(html).origin : "https://github.com";
  }

  private installations(): InstallationState[] {
    return [...this.apps.values()].flatMap((app) => [...app.installations.values()]);
  }

  private async loadApps() {
    const configs = listGithubApps(this.deps.db);
    for (const id of this.apps.keys()) if (!configs.some((c) => c.id === id)) this.apps.delete(id);
    for (const config of configs) {
      if (this.apps.has(config.id)) continue;
      const state: AppState = {
        config,
        auth: null,
        http: null,
        installations: new Map(),
        error: null,
      };
      try {
        const key = await githubAppKey(this.deps.secrets, config.id);
        if (!key) throw new Error("The app's private key is missing from Runyard's secret store.");
        const auth = new GithubAppAuth({
          appId: config.appId,
          privateKey: key,
          apiBase: config.apiBase,
          fetch: this.deps.fetch,
          now: this.now,
        });
        state.auth = auth;
        state.http = new GithubHttp(this.deps.fetch, config.apiBase, async () => auth.jwt());
      } catch (error) {
        state.error = message(error);
      }
      this.apps.set(config.id, state);
    }
  }

  private async refreshInstallations(app: AppState) {
    if (!app.http || !app.auth) return;
    const auth = app.auth;
    try {
      const found = await listInstallations(app.http);
      app.error = null;
      for (const id of app.installations.keys())
        if (!found.some((i) => i.id === id)) app.installations.delete(id);
      for (const inst of found) {
        const existing = app.installations.get(inst.id);
        const state: InstallationState = existing ?? {
          forgeId: app.config.id,
          http: new GithubHttp(this.deps.fetch, app.config.apiBase, () =>
            auth.installationToken(inst.id),
          ),
          observation: {
            ...inst,
            repos: [],
            runners: null,
            runnersError: null,
            jobs: null,
            jobsError: null,
          },
        };
        Object.assign(state.observation, inst);
        try {
          state.observation.repos = await installationRepos(state.http);
        } catch (error) {
          state.observation.runnersError = { at: this.now(), value: message(error) };
        }
        app.installations.set(inst.id, state);
      }
    } catch (error) {
      app.error = message(error);
    }
  }

  /** An organization's runners, or each selected repository's for a personal account. */
  private async readRunners({ forgeId, http, observation: o }: InstallationState) {
    try {
      const scoped: { scope: Scope; runner: GhRunner }[] = [];
      if (o.accountType === "Organization") {
        for (const runner of await orgRunners(http, o.account)) {
          scoped.push({ scope: { forgeId, kind: "org", target: o.account }, runner });
        }
      } else {
        for (const repo of o.repos.slice(0, MAX_REPOS)) {
          for (const runner of await repoRunners(http, repo)) {
            scoped.push({ scope: { forgeId, kind: "repo", target: repo }, runner });
          }
        }
      }
      o.runners = { at: this.now(), value: scoped };
      o.runnersError = null;
    } catch (error) {
      o.runnersError = { at: this.now(), value: message(error) };
    }
  }

  private async readJobs({ http, observation: o }: InstallationState) {
    try {
      const repos = o.repos.slice(0, JOB_REPOS);
      const scan = await scanJobs(http, repos);
      o.jobs = {
        at: this.now(),
        value: {
          ...scan,
          reposScanned: repos,
          truncated: scan.truncated || o.repos.length > JOB_REPOS,
        },
      };
      o.jobsError = null;
    } catch (error) {
      o.jobsError = { at: this.now(), value: message(error) };
    }
  }
}
