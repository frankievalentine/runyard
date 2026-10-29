import type { QueuedJobView, RunnerView } from "../github/derive.ts";
import type { MachineView } from "../machines/derive.ts";
import type { ForgeKind, RunnerKind, Scope } from "../model.ts";
import type { DesiredTemplate, Pool, TemplateRecord } from "./model.ts";

/** How long a one-job runner may take to show up on its forge before Runyard gives up on it. */
export const DISPATCH_START_TIMEOUT_MS = 10 * 60_000;
/** At most this many runners start per pool per minute. */
export const DISPATCH_STARTS_PER_MINUTE = 6;
/** Runners started for one job before Runyard stops and asks: none of them ran it. */
export const DISPATCH_ATTEMPTS = 3;
/** After a runner fails to start, the job waits this long before another is tried. */
export const DISPATCH_RETRY_AFTER_FAILURE_MS = 10 * 60_000;

export type DispatchState = "starting" | "running" | "done" | "failed";

/** One one-job runner Runyard started for a queued job. */
export type Dispatch = {
  id: string;
  poolId: string;
  machineId: string;
  runnerName: string;
  runnerKind: RunnerKind;
  scope: Scope;
  /** The queued job it was started for; it may take another matching job instead. */
  jobId: number;
  /** That job's name, repository and page, as queued; null for dispatches recorded before these were kept. */
  job: { name: string; repo: string; url: string | null } | null;
  /** The forge's ID for the runner, to delete it if it never starts. */
  runnerId: number | null;
  state: DispatchState;
  startedAt: number;
  endedAt: number | null;
  detail: string | null;
  /** Set aside by Try again: it no longer counts toward its job's attempts. */
  cleared: boolean;
};

/** The runners Runyard started for one job that still count, newest first. */
export function jobAttempts(dispatches: Dispatch[], kind: RunnerKind, jobId: number): Dispatch[] {
  return dispatches
    .filter((d) => !d.cleared && d.runnerKind === kind && d.jobId === jobId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Whether a job may get another runner. A one-job runner takes whichever
 * matching job the forge hands it, and can end without running one, so a job
 * still queued after its runner ended gets another: once the queue was read
 * after that end (so it isn't just stale), soon after a runner that ran, ten
 * minutes after one that failed to start, and at most three times in all.
 */
export type NextAttempt =
  | { ok: true; previous: Dispatch | null }
  | { ok: false; why: "active"; dispatch: Dispatch }
  | { ok: false; why: "exhausted"; last: Dispatch; count: number }
  | { ok: false; why: "wait"; last: Dispatch; at: number | null };

export function nextAttempt(
  attempts: Dispatch[],
  queueAt: number | null,
  now: number,
): NextAttempt {
  const last = attempts[0];
  if (!last) return { ok: true, previous: null };
  if (last.state === "starting" || last.state === "running")
    return { ok: false, why: "active", dispatch: last };
  if (attempts.length >= DISPATCH_ATTEMPTS)
    return { ok: false, why: "exhausted", last, count: attempts.length };
  const ended = last.endedAt ?? last.startedAt;
  if (last.state === "failed" && now - ended < DISPATCH_RETRY_AFTER_FAILURE_MS)
    return { ok: false, why: "wait", last, at: ended + DISPATCH_RETRY_AFTER_FAILURE_MS };
  // The queue must have been read after the runner ended, or the job may already be running.
  if (queueAt === null || queueAt <= ended) return { ok: false, why: "wait", last, at: null };
  return { ok: true, previous: last };
}

/** A runner to start: for this job, from this pool's template on this machine, registered in this scope. */
export type DispatchPlan = {
  job: QueuedJobView;
  pool: Pool;
  template: DesiredTemplate;
  machineId: string;
  scope: Scope;
  /** The job's last runner, when this is another try. */
  previous: Dispatch | null;
};

/** Labels every runner has without a pool asking: the forge's own, by OS and architecture. */
function builtinLabels(kind: ForgeKind, machine: MachineView): Set<string> {
  if (kind === "forgejo") return new Set();
  const out = new Set(["self-hosted"]);
  if (machine.os === "macos") out.add("macos");
  if (machine.os === "linux") out.add("linux");
  if (machine.os === "windows") out.add("windows");
  const arch =
    machine.diagnostics?.checks.find((c) => c.id === "architecture")?.value?.toLowerCase() ?? "";
  if (/arm64|aarch64/.test(arch)) out.add("arm64");
  else if (/x86_64|amd64|x64/.test(arch)) out.add("x64");
  return out;
}

/** The pool scope a job's repository falls under, if any. */
function scopeFor(
  pool: Pool,
  job: QueuedJobView,
  kinds: ReadonlyMap<string, ForgeKind>,
): Scope | null {
  const repo = job.repo.toLowerCase();
  const owner = repo.split("/")[0]!;
  return (
    pool.scopes.find((s) => {
      if ((kinds.get(s.forgeId) ?? "github") !== job.forge) return false;
      const target = s.target.toLowerCase();
      return s.kind === "repo" ? target === repo : target === owner;
    }) ?? null
  );
}

/**
 * Which queued jobs get a one-job runner now, and where. Pure. A job qualifies
 * when no idle runner can take it and `nextAttempt` allows one. It goes to an unpaused on-demand pool that serves its repository and
 * has every label it asks for, on a reachable machine with that pool's
 * template installed, a free slot and no operation in progress.
 */
export function planDispatches(input: {
  queue: QueuedJobView[];
  runners: RunnerView[];
  pools: Pool[];
  templates: DesiredTemplate[];
  installed: TemplateRecord[];
  machines: MachineView[];
  dispatches: Dispatch[];
  /** When the queue was last read; null before the first read. */
  queueAt: number | null;
  /** Machines with a review or another operation running. */
  busyMachines: ReadonlySet<string>;
  forgeKinds: ReadonlyMap<string, ForgeKind>;
  now: number;
}): DispatchPlan[] {
  const installed = new Set(input.installed.map((t) => t.key));
  const active = input.dispatches.filter((d) => d.state === "starting" || d.state === "running");
  const plans: DispatchPlan[] = [];
  const startedRecently = (poolId: string) =>
    input.dispatches.filter((d) => d.poolId === poolId && input.now - d.startedAt < 60_000).length +
    plans.filter((p) => p.pool.id === poolId).length;
  const load = (poolId: string, machineId: string) =>
    active.filter((d) => d.poolId === poolId && d.machineId === machineId).length +
    plans.filter((p) => p.pool.id === poolId && p.machineId === machineId).length;

  for (const job of input.queue) {
    if (job.onDemand) continue;
    const attempt = nextAttempt(
      jobAttempts(input.dispatches, job.forge === "forgejo" ? "forgejo" : "actions", job.id),
      input.queueAt,
      input.now,
    );
    if (!attempt.ok) continue;
    const idle = input.runners.some((r) => job.eligible.includes(r.key) && r.activity === "idle");
    if (idle) continue;
    const wanted = job.labels.map((l) => l.toLowerCase());
    let plan: DispatchPlan | null = null;
    for (const pool of input.pools) {
      if (pool.mode !== "onDemand" || pool.paused) continue;
      if (startedRecently(pool.id) >= DISPATCH_STARTS_PER_MINUTE) continue;
      const scope = scopeFor(pool, job, input.forgeKinds);
      if (!scope) continue;
      const kind: RunnerKind = job.forge === "forgejo" ? "forgejo" : "actions";
      const candidates = pool.machines
        .map(({ machineId, slots }) => {
          const machine = input.machines.find((m) => m.id === machineId);
          const template = input.templates.find(
            (t) => t.poolId === pool.id && t.machineId === machineId && t.runnerKind === kind,
          );
          return { machineId, slots, machine, template };
        })
        .filter(
          (c): c is typeof c & { machine: MachineView; template: DesiredTemplate } =>
            c.machine !== undefined &&
            c.template !== undefined &&
            installed.has(c.template.key) &&
            c.machine.connection.state === "connected" &&
            !input.busyMachines.has(c.machineId) &&
            load(pool.id, c.machineId) < c.slots,
        )
        .filter((c) => {
          const have = new Set([
            ...c.template.labels.map((l) => l.toLowerCase()),
            ...builtinLabels(job.forge, c.machine),
          ]);
          return wanted.every((l) => have.has(l));
        })
        // The least loaded machine first.
        .sort((a, b) => load(pool.id, a.machineId) - load(pool.id, b.machineId));
      const best = candidates[0];
      if (best) {
        plan = {
          job,
          pool,
          template: best.template,
          machineId: best.machineId,
          scope,
          previous: attempt.previous,
        };
        break;
      }
    }
    if (plan) plans.push(plan);
  }
  return plans;
}

/**
 * Advances dispatches. Pure. A starting runner the forge lists is running. One
 * whose process the machine sweep found gone has finished, seen or not: a short
 * job can start and end between two runner-list reads. A runner that neither
 * shows up nor exits times out.
 */
export function advanceDispatches(
  dispatches: Dispatch[],
  runners: RunnerView[],
  /** Runner names whose process a sweep found gone. */
  exited: ReadonlySet<string>,
  now: number,
): Dispatch[] {
  const listed = new Set(runners.map((r) => `${r.scope.forgeId}:${r.name.toLowerCase()}`));
  return dispatches.map((d) => {
    if (d.state !== "starting" && d.state !== "running") return d;
    if (exited.has(d.runnerName)) return { ...d, state: "done", endedAt: now };
    const seen = listed.has(`${d.scope.forgeId}:${d.runnerName.toLowerCase()}`);
    if (d.state === "starting" && seen) return { ...d, state: "running" };
    if (d.state === "starting" && now - d.startedAt > DISPATCH_START_TIMEOUT_MS) {
      return {
        ...d,
        state: "failed",
        endedAt: now,
        detail: "The runner didn't show up on the forge within 10 minutes.",
      };
    }
    return d;
  });
}
