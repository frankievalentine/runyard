import {
  eligibleRunners,
  type Activity,
  type QueuedJobView,
  type RunnerView,
} from "../github/derive.ts";
import { GITHUB_STALE_AFTER_MS, JOBS_STALE_AFTER_MS } from "../github/model.ts";
import { scopeKey } from "../scope.ts";
import type { ForgejoConnectionObservation, ForgejoRunner } from "./model.ts";

export type ForgejoConnectionView = {
  forgeId: string;
  baseUrl: string;
  login: string;
  version: string | null;
  error: string | null;
  scopes: {
    kind: "user" | "org";
    target: string;
    runnersAt: number | null;
    runnersError: string | null;
    jobsError: string | null;
    publicRepos: string[] | null;
  }[];
};

export type ForgejoView = {
  connections: ForgejoConnectionView[];
  runners: RunnerView[];
  queue: { jobs: QueuedJobView[]; complete: boolean; at: number | null };
};

/** Forgejo runners as RunnerViews, and waiting jobs with label-compatible runners. No I/O. */
export function deriveForgejo(
  connections: ForgejoConnectionObservation[],
  now: number,
  links: ReadonlyMap<string, string> = new Map(),
): ForgejoView {
  const runners: RunnerView[] = [];
  const waiting: QueuedJobView[] = [];
  let complete = true;
  let at: number | null = null;
  for (const conn of connections) {
    for (const s of conn.scopes) {
      if (s.runners) {
        const stale = now - s.runners.at > GITHUB_STALE_AFTER_MS;
        for (const r of s.runners.value) {
          runners.push({
            key: `${scopeKey(s.scope)}:${r.id}`,
            id: r.id,
            name: r.name,
            forge: "forgejo",
            forgeId: conn.forgeId,
            scope: s.scope,
            scopeLabel: s.scope.target,
            status: r.status === "offline" ? "offline" : "online",
            labels: r.labels,
            os: "",
            version: r.version,
            ephemeral: r.ephemeral,
            activity: stale ? "unknown" : activity(r),
            asOf: s.runners.at,
            stale,
            job: null,
            machineId: links.get(`${scopeKey(s.scope)}:${r.name.toLowerCase()}`) ?? null,
          });
        }
      }
      const jobs = s.jobs && !s.jobsError && now - s.jobs.at <= JOBS_STALE_AFTER_MS ? s.jobs : null;
      if (!jobs) complete = false;
      else at = at === null ? jobs.at : Math.min(at, jobs.at);
      for (const j of jobs?.value ?? []) {
        if (j.status !== "waiting") continue;
        const job = {
          id: j.id,
          forge: "forgejo" as const,
          repo: j.repo,
          name: j.name,
          workflowName: null,
          labels: j.runsOn,
          createdAt: jobs!.at,
          startedAt: null,
          htmlUrl: null,
          headBranch: null,
        };
        waiting.push({ ...job, eligible: [] });
      }
    }
  }
  // Each Forgejo scope's runners serve its account's repositories.
  for (const job of waiting) {
    job.eligible = eligibleRunners(
      {
        id: job.id,
        runId: 0,
        repo: job.repo,
        name: job.name,
        workflowName: null,
        status: "queued",
        labels: job.labels,
        runnerId: null,
        runnerName: null,
        createdAt: 0,
        startedAt: null,
        htmlUrl: null,
        headBranch: null,
      },
      runners,
    );
  }
  runners.sort((a, b) => a.name.localeCompare(b.name) || a.scopeLabel.localeCompare(b.scopeLabel));
  return {
    connections: connections.map((c) => ({
      forgeId: c.forgeId,
      baseUrl: c.baseUrl,
      login: c.login,
      version: c.version,
      error: c.error,
      scopes: c.scopes.map((s) => ({
        kind: s.scope.kind === "org" ? "org" : "user",
        target: s.scope.target,
        runnersAt: s.runners?.at ?? null,
        runnersError: s.runnersError?.value ?? null,
        jobsError: s.jobsError?.value ?? null,
        publicRepos: s.publicRepos,
      })),
    })),
    runners,
    queue: { jobs: waiting, complete, at },
  };
}

function activity(r: ForgejoRunner): Activity {
  if (r.status === "offline") return "offline";
  return r.status === "active" ? "busy" : "idle";
}
