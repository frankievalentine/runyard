import type { ForgejoConnectionObservation, ForgejoScopeObservation, Scope } from "@runyard/core";
import type { Db } from "../db/index.ts";
import type { Fetch } from "../github/client.ts";
import type { SecretStore } from "../secrets.ts";
import { ForgejoApi, supportedVersion, type ForgejoRepo } from "./client.ts";
import { connectionToken, listConnections, type ForgejoConnection } from "./store.ts";

/** The same cadence as GitHub: runners every 20 seconds, jobs every 45, accounts and repositories every 5 minutes. */
const RUNNERS_MS = 20_000;
const JOBS_MS = 45_000;
const ACCOUNTS_MS = 5 * 60_000;

type ScopeState = { observation: ForgejoScopeObservation; repos: ForgejoRepo[] };
type ConnState = {
  config: ForgejoConnection;
  api: ForgejoApi | null;
  version: string | null;
  error: string | null;
  scopes: Map<string, ScopeState>;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Reads each Forgejo connection's runners and jobs: the user's own account and
 * every organization it belongs to. Organization runners need the user to
 * own the organization; a refusal shows on that scope.
 */
export class ForgejoMonitor {
  private conns = new Map<string, ConnState>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private refreshing: Promise<void> | undefined;
  private queued: Promise<void> | undefined;
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
      setInterval(() => void this.refreshAll(), ACCOUNTS_MS),
      setInterval(() => void this.pollRunners(), RUNNERS_MS),
      setInterval(() => void this.pollJobs(), JOBS_MS),
    );
    for (const t of this.timers) t.unref();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }

  /** How this monitor reaches Forgejo; routes use it too, so tests reach the same fake. */
  get fetch(): Fetch {
    return this.deps.fetch;
  }

  observations(): ForgejoConnectionObservation[] {
    return [...this.conns.values()].map((c) => ({
      forgeId: c.config.id,
      baseUrl: c.config.baseUrl,
      login: c.config.login,
      version: c.version,
      error: c.error,
      scopes: [...c.scopes.values()].map((s) => s.observation),
    }));
  }

  /** The client that can act on a scope, if the connection is usable. */
  apiFor(scope: Scope): ForgejoApi | null {
    return this.conns.get(scope.forgeId)?.api ?? null;
  }

  /** Public repositories a runner at this scope would serve, as last read. */
  publicReposFor(scope: Scope): string[] | null {
    const state = this.conns
      .get(scope.forgeId)
      ?.scopes.get(`${scope.kind}:${scope.target.toLowerCase()}`);
    return state?.observation.publicRepos ?? null;
  }

  /** Never overlapping; a call during a refresh gets one shared follow-up, as in GithubMonitor. */
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
    const configs = listConnections(this.deps.db);
    for (const id of this.conns.keys())
      if (!configs.some((c) => c.id === id)) this.conns.delete(id);
    for (const config of configs) {
      const state = this.conns.get(config.id) ?? {
        config,
        api: null,
        version: null,
        error: null,
        scopes: new Map(),
      };
      this.conns.set(config.id, state);
      await this.refreshConnection(state);
    }
    await Promise.all([this.pollRunners(false), this.pollJobs(false)]);
    this.deps.onChange?.();
  }

  private async refreshConnection(state: ConnState) {
    try {
      const token = await connectionToken(this.deps.secrets, state.config.id);
      if (!token) throw new Error("The access token is missing from Runyard's secret store.");
      const api = new ForgejoApi(this.deps.fetch, state.config.baseUrl, token);
      state.version = await api.version();
      if (!supportedVersion(state.version)) {
        throw new Error(
          `Forgejo ${state.version} is too old: runner management needs Forgejo 15 or later.`,
        );
      }
      state.api = api;
      state.error = null;
      const wanted: Scope[] = [
        { forgeId: state.config.id, kind: "user", target: state.config.login },
        ...(await api.orgs()).map((org) => ({
          forgeId: state.config.id,
          kind: "org" as const,
          target: org,
        })),
      ];
      const keys = new Set(wanted.map((s) => `${s.kind}:${s.target.toLowerCase()}`));
      for (const key of state.scopes.keys()) if (!keys.has(key)) state.scopes.delete(key);
      for (const scope of wanted) {
        const key = `${scope.kind}:${scope.target.toLowerCase()}`;
        const existing = state.scopes.get(key) ?? {
          repos: [],
          observation: {
            scope,
            runners: null,
            runnersError: null,
            jobs: null,
            jobsError: null,
            publicRepos: null,
          },
        };
        try {
          existing.repos = await api.repos(scope, state.config.login);
          existing.observation.publicRepos = existing.repos
            .filter((r) => !r.private)
            .map((r) => r.fullName);
        } catch (error) {
          existing.observation.runnersError = { at: this.now(), value: message(error) };
        }
        state.scopes.set(key, existing);
      }
    } catch (error) {
      state.api = null;
      state.error = message(error);
    }
  }

  async pollRunners(notify = true) {
    await Promise.all(
      this.usable().map(async ([api, s]) => {
        try {
          s.observation.runners = { at: this.now(), value: await api.runners(s.observation.scope) };
          s.observation.runnersError = null;
        } catch (error) {
          s.observation.runnersError = { at: this.now(), value: message(error) };
        }
      }),
    );
    if (notify) this.deps.onChange?.();
  }

  async pollJobs(notify = true) {
    await Promise.all(
      this.usable().map(async ([api, s]) => {
        try {
          const names = new Map(s.repos.map((r) => [r.id, r.fullName]));
          s.observation.jobs = {
            at: this.now(),
            value: await api.jobs(s.observation.scope, names),
          };
          s.observation.jobsError = null;
        } catch (error) {
          s.observation.jobsError = { at: this.now(), value: message(error) };
        }
      }),
    );
    if (notify) this.deps.onChange?.();
  }

  private usable(): [ForgejoApi, ScopeState][] {
    return [...this.conns.values()].flatMap((c) =>
      c.api ? [...c.scopes.values()].map((s) => [c.api!, s] as [ForgejoApi, ScopeState]) : [],
    );
  }
}
