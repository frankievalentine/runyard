import { scopeKey } from "../scope.ts";
import type { ForgeKind, Scope } from "../model.ts";
import {
  GITHUB_STALE_AFTER_MS,
  JOBS_STALE_AFTER_MS,
  type GhJob,
  type GhRunner,
  type GithubAppObservation,
  type RateLimit,
} from "./model.ts";

export type Activity = "busy" | "idle" | "offline" | "unknown";

export type JobView = {
  id: number;
  forge: ForgeKind;
  repo: string;
  name: string;
  workflowName: string | null;
  labels: string[];
  createdAt: number;
  startedAt: number | null;
  htmlUrl: string | null;
  headBranch: string | null;
};

export type RunnerView = {
  /** Stable across refreshes: the scope key and GitHub's runner ID. */
  key: string;
  id: number;
  name: string;
  forge: ForgeKind;
  forgeId: string;
  scope: Scope;
  /** The organization, or `owner/name` for a repository runner. */
  scopeLabel: string;
  status: GhRunner["status"];
  labels: string[];
  os: string;
  version: string | null;
  ephemeral: boolean;
  /** What it's doing now. Unknown when GitHub's data is stale. */
  activity: Activity;
  asOf: number;
  stale: boolean;
  /** The job it's running, when a fresh job scan names it. */
  job: JobView | null;
  /** Linked by runner management; null until then. */
  machineId: string | null;
};

export type QueuedJobView = JobView & {
  /** Online runners whose scope covers the repository and whose labels include every requested label. */
  eligible: string[];
};

export type InstallationView = {
  id: number;
  account: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  repoCount: number;
  /** The repositories it can read, most recently pushed first (at most 200 listed). */
  repos: string[];
  runnersAt: number | null;
  runnersError: string | null;
  jobsAt: number | null;
  jobsError: string | null;
  jobsTruncated: boolean;
};

export type GithubAppView = {
  forgeId: string;
  name: string;
  slug: string;
  owner: string;
  htmlUrl: string;
  installUrl: string;
  error: string | null;
  rateLimit: RateLimit | null;
  installations: InstallationView[];
};

export type GithubView = {
  apps: GithubAppView[];
  runners: RunnerView[];
  queue: { jobs: QueuedJobView[]; complete: boolean; at: number | null };
  summary: { runners: number; busy: number; idle: number; offline: number; unknown: number };
};

export const emptyGithubView: GithubView = {
  apps: [],
  runners: [],
  queue: { jobs: [], complete: true, at: null },
  summary: { runners: 0, busy: 0, idle: 0, offline: 0, unknown: 0 },
};

/**
 * Runners, their jobs and the self-hosted queue across every app and
 * installation. No I/O. `links` maps `scopeKey:name` (lowercase name) to the
 * machine Runyard registered that runner on.
 */
export function deriveGithub(
  apps: GithubAppObservation[],
  now: number,
  links: ReadonlyMap<string, string> = new Map(),
): GithubView {
  const runners: RunnerView[] = [];
  const queued: { job: GhJob }[] = [];
  let complete = true;
  let queueAt: number | null = null;

  for (const app of apps) {
    for (const inst of app.installations) {
      const jobs =
        inst.jobs && now - inst.jobs.at <= JOBS_STALE_AFTER_MS && !inst.jobsError
          ? inst.jobs
          : null;
      if (!jobs || jobs.value.truncated) complete = false;
      if (jobs) queueAt = queueAt === null ? jobs.at : Math.min(queueAt, jobs.at);
      const running = new Map<string, GhJob>();
      for (const job of jobs?.value.jobs ?? []) {
        if (job.status === "in_progress" && job.runnerId !== null)
          running.set(`${job.repo}:${job.runnerId}`, job);
        else if (job.status === "queued" && isSelfHosted(job)) queued.push({ job });
      }
      if (!inst.runners) continue;
      const stale = now - inst.runners.at > GITHUB_STALE_AFTER_MS;
      for (const { scope, runner } of inst.runners.value) {
        const job = jobs ? findJob(running, scope, runner.id, inst.repos) : undefined;
        const activity: Activity = stale
          ? "unknown"
          : runner.status === "offline"
            ? "offline"
            : runner.busy
              ? "busy"
              : "idle";
        runners.push({
          key: `${scopeKey(scope)}:${runner.id}`,
          id: runner.id,
          name: runner.name,
          forge: "github",
          forgeId: app.forgeId,
          scope,
          scopeLabel: scope.target,
          status: runner.status,
          labels: runner.labels,
          os: runner.os,
          version: runner.version,
          ephemeral: runner.ephemeral,
          activity,
          asOf: inst.runners.at,
          stale,
          job: activity === "busy" && job ? jobView(job) : null,
          machineId: links.get(`${scopeKey(scope)}:${runner.name.toLowerCase()}`) ?? null,
        });
      }
    }
  }
  runners.sort((a, b) => a.name.localeCompare(b.name) || a.scopeLabel.localeCompare(b.scopeLabel));

  const summary = { runners: runners.length, busy: 0, idle: 0, offline: 0, unknown: 0 };
  for (const r of runners) summary[r.activity]++;

  return {
    apps: apps.map((app) => ({
      forgeId: app.forgeId,
      name: app.name,
      slug: app.slug,
      owner: app.owner,
      htmlUrl: app.htmlUrl,
      installUrl: `https://github.com/apps/${app.slug}/installations/new`,
      error: app.error,
      rateLimit: app.rateLimit,
      installations: app.installations.map((i) => ({
        id: i.id,
        account: i.account,
        accountType: i.accountType,
        repositorySelection: i.repositorySelection,
        repoCount: i.repos.length,
        repos: i.repos.slice(0, 200),
        runnersAt: i.runners?.at ?? null,
        runnersError: i.runnersError?.value ?? null,
        jobsAt: i.jobs?.at ?? null,
        jobsError: i.jobsError?.value ?? null,
        jobsTruncated: i.jobs?.value.truncated ?? false,
      })),
    })),
    runners,
    queue: {
      jobs: queued
        .map(({ job }) => ({ ...jobView(job), eligible: eligibleRunners(job, runners) }))
        .sort((a, b) => a.createdAt - b.createdAt),
      complete,
      at: queueAt,
    },
    summary,
  };
}

/** Jobs that ask for a self-hosted runner; GitHub-hosted jobs aren't this fleet's. */
export function isSelfHosted(job: GhJob): boolean {
  return job.labels.some((l) => l.toLowerCase() === "self-hosted");
}

/** A runner's current job: GitHub's runner_id in a repository its scope covers. */
function findJob(running: Map<string, GhJob>, scope: Scope, runnerId: number, repos: string[]) {
  const candidates =
    scope.kind === "repo"
      ? [scope.target]
      : repos.filter((r) => owner(r) === scope.target.toLowerCase());
  for (const repo of candidates) {
    const job = running.get(`${repo}:${runnerId}`);
    if (job) return job;
  }
  return undefined;
}

/**
 * Label-compatible, online runners in scope. Not a promise of scheduling:
 * runner group access can also affect eligibility.
 */
export function eligibleRunners(job: GhJob, runners: RunnerView[]): string[] {
  const wanted = job.labels.map((l) => l.toLowerCase());
  return (
    runners
      .filter((r) => r.activity !== "offline" && r.activity !== "unknown")
      // A repository runner serves its repository; an organization or user runner, the account's repositories.
      .filter((r) =>
        r.scope.kind === "repo"
          ? r.scope.target.toLowerCase() === job.repo.toLowerCase()
          : r.scope.target.toLowerCase() === owner(job.repo),
      )
      .filter((r) => {
        const have = new Set(r.labels.map((l) => l.toLowerCase()));
        return wanted.every((l) => have.has(l));
      })
      .map((r) => r.key)
  );
}

function owner(repo: string) {
  return repo.slice(0, repo.indexOf("/")).toLowerCase();
}

function jobView(job: GhJob): JobView {
  return {
    id: job.id,
    forge: "github",
    repo: job.repo,
    name: job.name,
    workflowName: job.workflowName,
    labels: job.labels,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    htmlUrl: job.htmlUrl,
    headBranch: job.headBranch,
  };
}
