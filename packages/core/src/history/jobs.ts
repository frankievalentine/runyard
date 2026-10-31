/** How a finished job ended, as GitHub reports it; null until it's known. */
export type JobConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "neutral"
  | "action_required"
  | "startup_failure"
  | "stale";

/** Where a job record came from; a record can have several. */
export type JobSource = "webhook" | "hook" | "api";

/** One job that ran on a self-hosted runner Runyard sees, kept 30 days. */
export type JobRecord = {
  id: string;
  forgeId: string;
  /** `owner/name`. */
  repo: string;
  /** The forge's job ID; null until a webhook or a GitHub read names it. */
  jobId: number | null;
  runId: number;
  runAttempt: number;
  /** The job's name as the forge shows it. */
  name: string | null;
  workflow: string | null;
  runnerName: string | null;
  machineId: string | null;
  poolId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  conclusion: JobConclusion | null;
  htmlUrl: string | null;
  /** A run of Runyard's Test this runner workflow. */
  test: boolean;
  /** What the machine's hooks reported: the job's start, then its end; null without hooks. */
  hook: "started" | "completed" | null;
  sources: JobSource[];
};

/** How long Runyard keeps finished jobs. */
export const JOB_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** What one source knows about a job; merged into its record. */
export type JobObservation = Partial<Omit<JobRecord, "id" | "sources">> & {
  forgeId: string;
  repo: string;
  runId: number;
  runAttempt: number;
  source: JobSource;
};

/**
 * Folds an observation into a job's record. Known values win over unknown
 * ones, the earliest start and the latest finish are kept, and a hook's
 * completion outranks its start. Pure.
 */
export function mergeJob(record: JobRecord | undefined, o: JobObservation, id: string): JobRecord {
  const pick = <K extends keyof JobRecord>(key: K): JobRecord[K] | null =>
    ((o as Partial<JobRecord>)[key] ?? record?.[key] ?? null) as JobRecord[K] | null;
  const earliest = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null ? Math.min(a, b) : (a ?? b ?? null);
  const latest = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null ? Math.max(a, b) : (a ?? b ?? null);
  const conclusion = pick("conclusion");
  return {
    id: record?.id ?? id,
    forgeId: o.forgeId,
    repo: o.repo,
    jobId: pick("jobId"),
    // 0 is a run not known yet: a Forgejo runner's log names the task, not its run.
    runId: o.runId || record?.runId || 0,
    runAttempt: o.runAttempt,

    name: pick("name"),
    workflow: pick("workflow"),
    runnerName: pick("runnerName"),
    machineId: pick("machineId"),
    poolId: pick("poolId"),
    startedAt: earliest(o.startedAt, record?.startedAt),
    finishedAt: latest(o.finishedAt, record?.finishedAt),
    conclusion,
    htmlUrl: pick("htmlUrl"),
    test: Boolean(o.test ?? record?.test),
    hook:
      record?.hook === "completed" || o.hook === "completed"
        ? "completed"
        : (o.hook ?? record?.hook ?? null),
    sources: [...new Set([...(record?.sources ?? []), o.source])].sort(),
  };
}

/** Counts for a summary line, such as "41 passed · 2 failed · 1 cancelled". */
export type JobCounts = {
  passed: number;
  failed: number;
  cancelled: number;
  running: number;
  /** Finished, with the result not read yet. */
  unknown: number;
};

export function countJobs(jobs: JobRecord[], now: number): JobCounts {
  const counts: JobCounts = { passed: 0, failed: 0, cancelled: 0, running: 0, unknown: 0 };
  for (const j of jobs) {
    const result = jobResult(j, now);
    if (result === "passed") counts.passed++;
    else if (result === "cancelled") counts.cancelled++;
    else if (result === "failed" || result === "lost") counts.failed++;
    else if (result === "running") counts.running++;
    else counts.unknown++;
  }
  return counts;
}

/** How long after the forge finishes a job its runner's end hook may still be read. */
const HOOK_GRACE_MS = 5 * 60_000;

/**
 * The runner said the job started but never that it finished, though the
 * forge finished it a while ago: the runner or its machine went away mid-job.
 * A machine problem, not the job's.
 */
export function isLost(j: JobRecord, now: number): boolean {
  return (
    j.hook === "started" &&
    j.conclusion !== null &&
    j.finishedAt !== null &&
    now - j.finishedAt > HOOK_GRACE_MS
  );
}

/** A job's result in a word, for its row. */
export function jobResult(
  j: JobRecord,
  now: number,
): "passed" | "failed" | "cancelled" | "running" | "unknown" | "lost" {
  if (isLost(j, now)) return "lost";
  if (j.conclusion === "success") return "passed";
  if (j.conclusion === "cancelled" || j.conclusion === "skipped") return "cancelled";
  if (j.conclusion !== null) return "failed";
  return j.finishedAt === null ? "running" : "unknown";
}

/** One line of a machine's job log, written by Runyard's runner hooks. */
export type HookLine = {
  at: number;
  event: "started" | "completed";
  runnerName: string;
  repo: string;
  runId: number;
  runAttempt: number;
  workflow: string | null;
};

/**
 * Parses the log's tab-separated lines (seconds, event, runner, repository,
 * run ID, attempt, workflow), skipping anything malformed. Pure.
 */
export function parseHookLines(text: string): HookLine[] {
  const out: HookLine[] = [];
  // Windows machines end their lines with \r\n.
  for (const line of text.split(/\r?\n/)) {
    const [at, event, runnerName, repo, runId, runAttempt, workflow] = line.split("\t");
    if (event !== "started" && event !== "completed") continue;
    if (!runnerName || !repo?.includes("/")) continue;
    const seconds = Number(at);
    const run = Number(runId);
    const attempt = Number(runAttempt || "1");
    if (!Number.isFinite(seconds) || !Number.isInteger(run) || run <= 0) continue;
    out.push({
      at: seconds * 1000,
      event,
      runnerName,
      repo,
      runId: run,
      runAttempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
      workflow: workflow || null,
    });
  }
  return out;
}

/** A Forgejo runner took a task (Forgejo's name for a job), as its own log says. */
export type ForgejoTaskLine = { at: number; runnerName: string; taskId: number; repo: string };

/**
 * Lines the machine check prints for Forgejo runners' logs: time (as the
 * runner logs it), runner, task and repository, tab-separated. Unreadable
 * lines are skipped. Pure.
 */
export function parseForgejoLines(text: string): ForgejoTaskLine[] {
  const out: ForgejoTaskLine[] = [];
  for (const line of text.split("\n")) {
    const [time, runnerName, task, repo] = line.split("\t");
    const at = Date.parse(time ?? "");
    const taskId = Number(task);
    if (!Number.isFinite(at) || !Number.isInteger(taskId) || taskId <= 0) continue;
    if (!runnerName || !repo?.includes("/")) continue;
    out.push({ at, runnerName, taskId, repo });
  }
  return out;
}

/** A Forgejo task's status as a result; null while it hasn't finished. */
export function forgejoConclusion(status: string): JobConclusion | null {
  return status === "success" ||
    status === "failure" ||
    status === "cancelled" ||
    status === "skipped"
    ? status
    : null;
}
