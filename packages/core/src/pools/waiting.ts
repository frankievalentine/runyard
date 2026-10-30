import type { QueuedJobView } from "../github/derive.ts";
import type { YardView } from "../machines/derive.ts";
import { readinessProblems } from "../machines/readiness.ts";
import type { ForgeKind, Scope } from "../model.ts";
import { scopeKey } from "../scope.ts";
import { DISPATCH_ATTEMPTS, jobAttempts, nextAttempt } from "./dispatch.ts";
import type { Dispatch } from "./dispatch.ts";

/** Labels GitHub gives every self-hosted runner by itself; architecture ones aren't checked. */
const OS_LABELS: Record<string, string> = { macos: "macos", linux: "linux", windows: "windows" };
const ARCH = new Set(["x64", "arm64", "arm"]);

const owner = (repo: string) => repo.slice(0, repo.indexOf("/")).toLowerCase();

/** Whether a runner or pool scope takes jobs from a repository. */
function serves(scope: Scope, repo: string): boolean {
  return scope.kind === "repo"
    ? scope.target.toLowerCase() === repo.toLowerCase()
    : scope.target.toLowerCase() === owner(repo);
}

/**
 * Why a queued job is still waiting, in plain sentences, from what Runyard
 * sees: the runners that could take it, then the pools that could provide
 * one. A guide, not a promise: GitHub's runner groups can also keep a job
 * from a runner. No I/O.
 */
export function waitingReasons(job: QueuedJobView, view: YardView, now = Date.now()): string[] {
  if (job.onDemand) return [`${job.onDemand} starts a VM for it; Runyard doesn't run these.`];
  // A runner Runyard started for it is on its way: anything else would be noise, and the
  // forge lists that runner as offline until it connects.
  const active = activeDispatch(job, view);
  if (active) return [activeLine(active, view)];
  const wanted = job.labels.map((l) => l.toLowerCase());
  const kinds = new Map<string, ForgeKind>([
    ...view.github.apps.map((a): [string, ForgeKind] => [a.forgeId, "github"]),
    ...view.forgejo.connections.map((c): [string, ForgeKind] => [c.forgeId, "forgejo"]),
  ]);
  const reasons: string[] = [];
  // Pools that would take it come first, then the runners, then pools that can't.
  const handling: string[] = [];
  const lacking: string[] = [];

  const serving = view.runners.filter((r) => r.forge === job.forge && serves(r.scope, job.repo));
  const matching = serving.filter((r) => {
    const have = new Set(r.labels.map((l) => l.toLowerCase()));
    return wanted.every((l) => have.has(l));
  });
  if (job.eligible.length) {
    const idle = matching.filter((r) => r.activity === "idle");
    reasons.push(
      idle.length
        ? `${idle.map((r) => r.name).join(", ")} ${idle.length === 1 ? "is idle and matches" : "are idle and match"}; the forge should hand the job over shortly.`
        : `Every runner that matches is busy (${matching.map((r) => r.name).join(", ")}).`,
    );
    return reasons;
  }
  if (matching.length)
    reasons.push(`The runners that match are offline: ${matching.map((r) => r.name).join(", ")}.`);
  else if (serving.length) {
    const custom = wanted.filter((l) => l !== "self-hosted" && !OS_LABELS[l] && !ARCH.has(l));
    const anyHas = (l: string) => serving.some((r) => r.labels.some((x) => x.toLowerCase() === l));
    const missing = custom.filter((l) => !anyHas(l));
    reasons.push(
      missing.length
        ? `No runner for ${job.repo} has ${missing.join(", ")}.`
        : `No single runner for ${job.repo} has all of ${job.labels.join(", ")}.`,
    );
  } else reasons.push(`No runner takes jobs from ${job.repo}.`);

  const pools = view.pools.pools.filter((p) =>
    p.scopes.some((s) => (kinds.get(s.forgeId) ?? "github") === job.forge && serves(s, job.repo)),
  );
  if (pools.length === 0) {
    reasons.push(`No pool serves ${job.repo}; create one to give it runners.`);
    return reasons;
  }
  const runnerLines = reasons.splice(0);
  for (const p of pools) {
    const machines = view.machines.filter((m) => p.machines.some((x) => x.machineId === m.id));
    const has = new Set(
      [
        ...p.labels,
        "runyard",
        `runyard-pool-${p.name}`,
        "self-hosted",
        ...machines.map((m) => (m.os ? OS_LABELS[m.os] : undefined)),
      ]
        .filter((l): l is string => Boolean(l))
        .map((l) => l.toLowerCase()),
    );
    const lacks = wanted.filter((l) => !has.has(l) && !ARCH.has(l));
    if (lacks.length) {
      lacking.push(`Pool ${p.name} serves ${job.repo} but doesn't have ${lacks.join(", ")}.`);
      continue;
    }
    const notReady = machines.filter((m) => readinessProblems(m.readiness).length > 0);
    if (p.mode === "onDemand") {
      if (p.paused) handling.push(`Pool ${p.name} would take it, but it's paused.`);
      else if (!view.pools.templateRecords.some((t) => t.poolId === p.id))
        handling.push(
          `Pool ${p.name} would take it, but its runner software isn't installed yet; review its machines.`,
        );
      else if (notReady.length === machines.length && machines.length)
        handling.push(
          `Pool ${p.name} would take it, but its machines aren't ready: ${notReady.map((m) => m.name).join(", ")}.`,
        );
      else handling.push(onDemandReason(job, p.id, p.name, p.machines, view, now));
      continue;
    }
    const scopes = new Set(p.scopes.map(scopeKey));
    const desired = view.pools.desired.filter(
      (d) => d.poolId === p.id && scopes.has(scopeKey(d.scope)) && serves(d.scope, job.repo),
    );
    const installed = desired.filter((d) =>
      view.runners.some(
        (r) =>
          scopeKey(r.scope) === scopeKey(d.scope) && r.name.toLowerCase() === d.name.toLowerCase(),
      ),
    );
    if (desired.length === 0)
      handling.push(
        `Pool ${p.name} would take it, but calls for no runners yet; check its machines.`,
      );
    else if (installed.length === 0) {
      const names = [
        ...new Set(desired.map((d) => view.machines.find((m) => m.id === d.machineId)?.name)),
      ].filter(Boolean);
      handling.push(
        `Pool ${p.name}'s runners aren't installed yet; review ${names.join(", ")} to install them.`,
      );
    }
  }
  return [...new Set([...handling, ...runnerLines, ...lacking])];
}

/** What an unpaused, installed on-demand pool is doing about a job, from its runners so far. */
function onDemandReason(
  job: QueuedJobView,
  poolId: string,
  poolName: string,
  slots: { machineId: string; slots: number }[],
  view: YardView,
  now: number,
): string {
  const dispatches = view.pools.dispatches;
  const attempts = jobAttempts(dispatches, job.forge === "forgejo" ? "forgejo" : "actions", job.id);
  const next = nextAttempt(attempts, view.queue.at, now);
  if (!next.ok && next.why === "active") return activeLine(next.dispatch, view);
  if (!next.ok && next.why === "exhausted")
    return `Runyard started ${next.count} runners for it and none ran it. The last one's log is on pool ${poolName}'s page; Try again starts another.`;
  if (!next.ok && next.why === "wait")
    return next.last.state === "failed"
      ? `Its last runner failed to start${next.last.detail ? ` (${next.last.detail})` : ""}; Runyard tries again${next.at ? ` at ${new Date(next.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : " shortly"} (${attempts.length} of ${DISPATCH_ATTEMPTS} tries).`
      : `Its runner ${next.last.runnerName} ended without running it; Runyard starts another once the queue is read again (${attempts.length} of ${DISPATCH_ATTEMPTS} tries).`;
  // Free to start: say so unless every machine is reachable-but-full or unreachable.
  const active = dispatches.filter(
    (d) => d.poolId === poolId && (d.state === "starting" || d.state === "running"),
  );
  const states = slots.map(({ machineId, slots: n }) => {
    const m = view.machines.find((x) => x.id === machineId);
    const used = active.filter((d) => d.machineId === machineId).length;
    return {
      name: m?.name ?? machineId,
      connected: m?.connection.state === "connected",
      full: used >= n,
      n,
    };
  });
  if (states.length && states.every((x) => !x.connected))
    return `Pool ${poolName} would start a runner for it, but its machines aren't connected right now: ${states.map((x) => x.name).join(", ")}.`;
  if (states.length && states.every((x) => !x.connected || x.full))
    return `Pool ${poolName}'s machines are running as many one-job runners as they're allowed (${states.map((x) => `${x.name}: ${x.n}`).join(", ")}); another starts when one ends.`;
  return attempts.length
    ? `Pool ${poolName} starts another runner for it within a minute (${attempts.length + 1} of ${DISPATCH_ATTEMPTS} tries).`
    : `Pool ${poolName} should start a one-job runner for it within a minute.`;
}

/** The one-job runner Runyard started for a job that's still starting or online, if any. */
export function activeDispatch(job: QueuedJobView, view: YardView): Dispatch | undefined {
  if (job.onDemand) return undefined;
  const last = jobAttempts(
    view.pools.dispatches,
    job.forge === "forgejo" ? "forgejo" : "actions",
    job.id,
  )[0];
  return last && (last.state === "starting" || last.state === "running") ? last : undefined;
}

function activeLine(d: Dispatch, view: YardView): string {
  const machine = view.machines.find((m) => m.id === d.machineId)?.name ?? d.machineId;
  return d.state === "starting"
    ? `Runyard started ${d.runnerName} for it on ${machine}; it takes the job once it connects.`
    : `${d.runnerName} is online on ${machine}; the forge should hand it the job shortly.`;
}

/** What a waiting job's status pill says, for jobs no runner online matches. */
export type WaitingState = "runnerStarting" | "runnerOnline" | "poolPaused" | "noRunner";

export function waitingState(job: QueuedJobView, view: YardView): WaitingState {
  const active = activeDispatch(job, view);
  if (active) return active.state === "starting" ? "runnerStarting" : "runnerOnline";
  const wanted = new Set(job.labels.map((l) => l.toLowerCase()));
  const paused = view.pools.pools.some(
    (p) =>
      p.mode === "onDemand" &&
      p.paused &&
      p.scopes.some((s) => serves(s, job.repo)) &&
      p.labels.some((l) => wanted.has(l.toLowerCase())),
  );
  return paused ? "poolPaused" : "noRunner";
}
