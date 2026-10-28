import type { QueuedJobView, RunnerView } from "../github/derive.ts";
import type { MachineView } from "../machines/derive.ts";
import type { ForgeKind, RunnerKind, Scope } from "../model.ts";
import type { DesiredTemplate, Pool, TemplateRecord } from "./model.ts";

/** How long a one-job runner may take to show up on its forge before Runyard gives up on it. */
export const DISPATCH_START_TIMEOUT_MS = 10 * 60_000;
/** At most this many runners start per pool per minute. */
export const DISPATCH_STARTS_PER_MINUTE = 6;

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
  /** The forge's ID for the runner, to delete it if it never starts. */
  runnerId: number | null;
  state: DispatchState;
  startedAt: number;
  endedAt: number | null;
  detail: string | null;
};

/** A runner to start: for this job, from this pool's template on this machine, registered in this scope. */
export type DispatchPlan = {
  job: QueuedJobView;
  pool: Pool;
  template: DesiredTemplate;
  machineId: string;
  scope: Scope;
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
 * when no idle runner can take it and Runyard hasn't started one for it
 * before. It goes to an unpaused on-demand pool that serves its repository and
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
  /** Machines with a review or another operation running. */
  busyMachines: ReadonlySet<string>;
  forgeKinds: ReadonlyMap<string, ForgeKind>;
  now: number;
}): DispatchPlan[] {
  const installed = new Set(input.installed.map((t) => t.key));
  const dispatched = new Set(input.dispatches.map((d) => d.jobId));
  const active = input.dispatches.filter((d) => d.state === "starting" || d.state === "running");
  const plans: DispatchPlan[] = [];
  const startedRecently = (poolId: string) =>
    input.dispatches.filter((d) => d.poolId === poolId && input.now - d.startedAt < 60_000).length +
    plans.filter((p) => p.pool.id === poolId).length;
  const load = (poolId: string, machineId: string) =>
    active.filter((d) => d.poolId === poolId && d.machineId === machineId).length +
    plans.filter((p) => p.pool.id === poolId && p.machineId === machineId).length;

  for (const job of input.queue) {
    if (job.onDemand || dispatched.has(job.id)) continue;
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
        plan = { job, pool, template: best.template, machineId: best.machineId, scope };
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
