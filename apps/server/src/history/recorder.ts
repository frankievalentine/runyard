import {
  forgejoConclusion,
  type ForgejoTaskLine,
  type GithubAppObservation,
  type HookLine,
  type JobConclusion,
  type JobObservation,
  type JobRecord,
  type YardView,
} from "@runyard/core";
import type { Db } from "../db/index.ts";
import { ForgejoError, servesJobLogs, type ForgejoApi } from "../forgejo/client.ts";
import type { GithubMonitor } from "../github/monitor.ts";
import { GithubError } from "../github/client.ts";
import { jobsWithoutResult, pruneJobs, recordJob } from "./store.ts";

/** The workflow Runyard's Test this runner card adds (its `name:`). */
export const TEST_WORKFLOW = "Runyard runner check";
/** Result reads per round, so a backlog can't spend the request budget. */
const RESULTS_PER_ROUND = 20;
/** A job without a result is read again at most this often. */
const RESULT_RETRY_MS = 2 * 60_000;
/** A Forgejo job this recent is read on every call until it has a result. */
const FORGEJO_FAST_MS = 60 * 60_000;

/** After a restart, hook lines are read again from this far back; re-reading only merges. */
const HOOK_REREAD_MS = 24 * 60 * 60_000;
/** The end of a job's log kept when it's shown. */
const LOG_BYTES = 2_000_000;

type RawJob = {
  id: number;
  run_id: number;
  run_attempt?: number;
  name?: string;
  workflow_name?: string | null;
  runner_name?: string | null;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
  labels?: string[];
};

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

/**
 * Run history's sources, merged into the jobs table: signed webhook
 * deliveries, the lines Runyard's runner hooks write on each machine, the
 * in-progress jobs the regular scan already reads, and one GitHub read per
 * finished job for its result.
 */
export class JobHistory {
  private tried = new Map<string, number>();
  /** When a job's record last changed. */
  changedAt = 0;
  private readingForgejo = false;

  private hookSince = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    private readonly deps: {
      db: Db;
      github: GithubMonitor;
      /** Called when a job's record changed, so the view can say so. */
      onChange?: () => void;
      /** Forgejo connections' APIs, for their tasks' results. */

      forgejo?: {
        apiFor: (scope: { forgeId: string; kind: "repo"; target: string }) => ForgejoApi | null;
      };
      view: () => YardView;
      now?: () => number;
    },
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** A signed `workflow_job` delivery from a GitHub App. */
  fromWebhook(forgeId: string, payload: unknown) {
    const p = payload as { workflow_job?: RawJob; repository?: { full_name?: string } };
    const job = p.workflow_job;
    const repo = p.repository?.full_name;
    if (!job || !repo || !job.runner_name) return;
    if (!(job.labels ?? []).some((l) => l.toLowerCase() === "self-hosted")) return;
    this.record({ ...this.fromRaw(job, repo, forgeId), source: "webhook" });
  }

  /** In-progress jobs from the regular job scan, which name their runner. */
  fromScan(apps: GithubAppObservation[]) {
    for (const app of apps)
      for (const inst of app.installations)
        for (const j of inst.jobs?.value.jobs ?? []) {
          if (j.status !== "in_progress" || !j.runnerName) continue;
          if (!j.labels.some((l) => l.toLowerCase() === "self-hosted")) continue;
          this.record({
            forgeId: app.forgeId,
            repo: j.repo,
            jobId: j.id,
            runId: j.runId,
            runAttempt: j.runAttempt ?? 1,
            name: j.name,
            workflow: j.workflowName,
            runnerName: j.runnerName,
            startedAt: j.startedAt,
            htmlUrl: j.htmlUrl,
            source: "api",
          });
        }
  }

  /** Where the next read of a machine's job log starts, in seconds. */
  hookSinceSeconds(machineId: string): number {
    const since = this.hookSince.get(machineId) ?? this.now() - HOOK_REREAD_MS;
    return Math.floor(since / 1000);
  }

  /** Lines from a machine's job log, as its runners' hooks wrote them. */
  fromHooks(machineId: string, lines: HookLine[]) {
    for (const line of lines) {
      const forgeId = this.forgeFor(line.runnerName, line.repo);
      if (!forgeId) continue;
      this.record({
        forgeId,
        repo: line.repo,
        runId: line.runId,
        runAttempt: line.runAttempt,
        runnerName: line.runnerName,
        workflow: line.workflow,
        machineId,
        hook: line.event,
        ...(line.event === "started" ? { startedAt: line.at } : { finishedAt: line.at }),
        source: "hook",
      });
      this.hookSince.set(machineId, Math.max(this.hookSince.get(machineId) ?? 0, line.at));
    }
  }

  /**
   * Tasks Forgejo runners took, from their logs. A log names the task and
   * repository but not the run, which the result read fills in; there's no
   * end line, so a task isn't counted lost.
   */
  fromForgejo(machineId: string, lines: ForgejoTaskLine[]) {
    const since = this.hookSince.get(machineId) ?? this.now() - HOOK_REREAD_MS;
    for (const line of lines) {
      if (line.at < since - 1000) continue;
      const forgeId = this.forgeFor(line.runnerName, line.repo);
      if (!forgeId) continue;
      this.record({
        forgeId,
        repo: line.repo,
        jobId: line.taskId,
        runId: 0,
        runAttempt: 1,
        runnerName: line.runnerName,
        machineId,
        startedAt: line.at,
        source: "hook",
      });
      this.hookSince.set(machineId, Math.max(this.hookSince.get(machineId) ?? 0, line.at));
    }
  }

  /** One round: reads results for finished jobs, a few at a time. */
  async fillResults(apps: GithubAppObservation[]) {
    const now = this.now();
    const inProgress = new Set(
      apps.flatMap((a) =>
        a.installations.flatMap((i) =>
          (i.jobs?.value.jobs ?? []).filter((j) => j.status === "in_progress").map((j) => j.id),
        ),
      ),
    );
    const due = jobsWithoutResult(this.deps.db, 200).filter((j) => {
      if (this.isForgejo(j.forgeId)) return false;
      if (j.jobId !== null && inProgress.has(j.jobId)) return false;
      return now - (this.tried.get(j.id) ?? 0) > RESULT_RETRY_MS;
    });
    for (const j of due.slice(0, RESULTS_PER_ROUND)) {
      this.tried.set(j.id, now);
      try {
        await this.readResult(j);
      } catch {
        // Tried again next round; GitHub may be busy or the run gone.
      }
    }
    await this.fillForgejoResults();
    for (const [id, at] of this.tried) if (now - at > 60 * 60_000) this.tried.delete(id);
  }

  /**
   * Results for Forgejo jobs, a repository at a time: one read of its tasks
   * covers all its jobs, so a job started in the last hour is read again every
   * call (every 10 seconds) until it finishes, and an older one every 2 minutes.
   */
  async fillForgejoResults() {
    // The 10-second timer and the minute round both call this; one read at a time.
    if (this.readingForgejo) return;
    this.readingForgejo = true;
    try {
      await this.readForgejoRound();
    } finally {
      this.readingForgejo = false;
    }
  }

  private async readForgejoRound() {
    const now = this.now();
    const byRepo = new Map<string, JobRecord[]>();
    for (const j of jobsWithoutResult(this.deps.db, 200)) {
      if (!this.isForgejo(j.forgeId)) continue;
      const recent = now - (j.startedAt ?? 0) < FORGEJO_FAST_MS;
      if (!recent && now - (this.tried.get(j.id) ?? 0) <= RESULT_RETRY_MS) continue;
      const key = `${j.forgeId}\t${j.repo}`;
      byRepo.set(key, [...(byRepo.get(key) ?? []), j]);
    }
    for (const jobs of [...byRepo.values()].slice(0, RESULTS_PER_ROUND)) {
      for (const j of jobs) this.tried.set(j.id, now);
      try {
        await this.readForgejoResults(jobs);
      } catch {
        // Tried again next call.
      }
    }
  }

  prune() {
    pruneJobs(this.deps.db, this.now());
  }

  /** A job's log from GitHub, fetched when asked for and not kept. */
  async log(job: JobRecord): Promise<string> {
    if (this.isForgejo(job.forgeId)) {
      const conn = this.deps.view().forgejo.connections.find((c) => c.forgeId === job.forgeId);
      if (!servesJobLogs(conn?.version ?? null))
        throw new ForgejoError(
          "Forgejo doesn't serve job logs before version 16. Open the job on Forgejo.",
          404,
        );
      const api = this.deps.forgejo?.apiFor({
        forgeId: job.forgeId,
        kind: "repo",
        target: job.repo,
      });
      if (!api) throw new ForgejoError("The Forgejo connection isn't usable right now.");
      if (job.jobId === null || job.runId === 0)
        throw new ForgejoError("Forgejo hasn't reported this job's run yet.", 404);
      const text = await api.taskLog(job.repo, job.runId, job.jobId);
      return text.length > LOG_BYTES ? text.slice(-LOG_BYTES) : text;
    }

    if (job.jobId === null) throw new GithubError("GitHub hasn't named this job yet.");
    const http = this.deps.github.clientFor({
      forgeId: job.forgeId,
      kind: "repo",
      target: job.repo,
    });
    if (!http) throw new GithubError("No GitHub App installation reaches this repository.");
    return http.getText(`/repos/${job.repo}/actions/jobs/${job.jobId}/logs`, LOG_BYTES);
  }

  private async readResult(j: JobRecord) {
    const http = this.deps.github.clientFor({ forgeId: j.forgeId, kind: "repo", target: j.repo });
    if (!http) return;
    const { items } = await http.collection<RawJob>(
      `/repos/${j.repo}/actions/runs/${j.runId}/attempts/${j.runAttempt}/jobs`,
      "jobs",
      100,
      3,
    );
    const match =
      items.find((x) => j.jobId !== null && x.id === j.jobId) ??
      items.find(
        (x) => j.runnerName !== null && x.runner_name?.toLowerCase() === j.runnerName.toLowerCase(),
      );
    if (!match || match.status !== "completed") return;
    this.record({ ...this.fromRaw(match, j.repo, j.forgeId), source: "api" });
  }

  /** The results of one repository's Forgejo tasks, from its newest tasks. */
  private async readForgejoResults(jobs: JobRecord[]) {
    const { forgeId, repo } = jobs[0]!;
    const api = this.deps.forgejo?.apiFor({ forgeId, kind: "repo", target: repo });
    if (!api) return;
    const tasks = new Map((await api.tasks(repo)).map((t) => [t.id, t]));
    for (const j of jobs) {
      const t = j.jobId === null ? undefined : tasks.get(j.jobId);
      if (!t) continue;
      const conclusion = forgejoConclusion(t.status);
      this.record({
        forgeId,
        repo,
        jobId: t.id,
        runId: t.runNumber,
        runAttempt: 1,
        name: t.name,
        workflow: t.workflow,
        runnerName: j.runnerName,
        startedAt: t.startedAt ? Date.parse(t.startedAt) : null,
        finishedAt: conclusion && t.updatedAt ? Date.parse(t.updatedAt) : null,
        conclusion,
        htmlUrl: t.url,
        source: "api",
      });
    }
  }

  private isForgejo(forgeId: string): boolean {
    return this.deps.view().forgejo.connections.some((c) => c.forgeId === forgeId);
  }

  private fromRaw(job: RawJob, repo: string, forgeId: string): JobObservation {
    return {
      forgeId,
      repo,
      jobId: job.id,
      runId: job.run_id,
      runAttempt: job.run_attempt ?? 1,
      name: job.name ?? null,
      workflow: job.workflow_name ?? null,
      runnerName: job.runner_name ?? null,
      startedAt: time(job.started_at),
      finishedAt: job.status === "completed" ? time(job.completed_at) : null,
      conclusion:
        job.status === "completed" ? ((job.conclusion ?? null) as JobConclusion | null) : null,
      htmlUrl: job.html_url ?? null,
      source: "api",
    };
  }

  /** Adds where the job ran, from the runner's name, and whether it was a test run. */
  private record(o: JobObservation) {
    const place = o.runnerName ? this.placeOf(o.runnerName, o.forgeId) : null;
    const { changed } = recordJob(
      this.deps.db,
      {
        ...o,
        machineId: o.machineId ?? place?.machineId ?? null,
        poolId: place?.poolId ?? null,
        ...(o.workflow ? { test: o.workflow === TEST_WORKFLOW } : {}),
      },
      this.now(),
    );
    if (changed) {
      this.changedAt = this.now();
      this.deps.onChange?.();
    }
  }

  /** The machine and pool of a runner, by name: Runyard's own, one-job, or assigned. */
  private placeOf(name: string, forgeId: string) {
    const v = this.deps.view();
    const lower = name.toLowerCase();
    const desired = v.pools.desired.find(
      (d) => d.name.toLowerCase() === lower && d.scope.forgeId === forgeId,
    );
    if (desired) return { machineId: desired.machineId, poolId: desired.poolId };
    const dispatch = v.pools.dispatches.find((d) => d.runnerName.toLowerCase() === lower);
    if (dispatch) return { machineId: dispatch.machineId, poolId: dispatch.poolId };
    const runner = v.runners.find((r) => r.name.toLowerCase() === lower && r.forgeId === forgeId);
    return runner?.machineId ? { machineId: runner.machineId, poolId: null } : null;
  }

  /** Which GitHub App a hook line's job belongs to: the runner's, else the repository owner's. */
  private forgeFor(runnerName: string, repo: string): string | null {
    const v = this.deps.view();
    const lower = runnerName.toLowerCase();
    const known =
      v.pools.desired.find((d) => d.name.toLowerCase() === lower)?.scope.forgeId ??
      v.pools.dispatches.find((d) => d.runnerName.toLowerCase() === lower)?.scope.forgeId ??
      v.runners.find((r) => r.name.toLowerCase() === lower)?.forgeId;
    if (known) return known;
    const owner = repo.split("/")[0]!.toLowerCase();
    return (
      v.github.apps.find((a) => a.installations.some((i) => i.account.toLowerCase() === owner))
        ?.forgeId ?? null
    );
  }
}
