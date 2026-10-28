import type { QueuedJobView } from "../github/derive.ts";
import type { YardView } from "../machines/derive.ts";
import { readinessProblems } from "../machines/readiness.ts";
import type { ForgeKind, Scope } from "../model.ts";
import { scopeKey } from "../scope.ts";

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
export function waitingReasons(job: QueuedJobView, view: YardView): string[] {
  if (job.onDemand) return [`${job.onDemand} starts a VM for it; Runyard doesn't run these.`];
  const wanted = job.labels.map((l) => l.toLowerCase());
  const kinds = new Map<string, ForgeKind>([
    ...view.github.apps.map((a): [string, ForgeKind] => [a.forgeId, "github"]),
    ...view.forgejo.connections.map((c): [string, ForgeKind] => [c.forgeId, "forgejo"]),
  ]);
  const reasons: string[] = [];

  const serving = view.runners.filter((r) => r.forge === job.forge && serves(r.scope, job.repo));
  const matching = serving.filter((r) => {
    const have = new Set(r.labels.map((l) => l.toLowerCase()));
    return wanted.every((l) => have.has(l));
  });
  if (job.eligible.length) {
    const idle = matching.filter((r) => r.activity === "idle");
    reasons.push(
      idle.length
        ? `${idle.map((r) => r.name).join(", ")} ${idle.length === 1 ? "is" : "are"} idle and matches; the forge should hand the job over shortly.`
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
      reasons.push(`Pool ${p.name} serves ${job.repo} but doesn't have ${lacks.join(", ")}.`);
      continue;
    }
    const notReady = machines.filter((m) => readinessProblems(m.readiness).length > 0);
    if (p.mode === "onDemand") {
      if (p.paused) reasons.push(`Pool ${p.name} would take it, but it's paused.`);
      else if (!view.pools.templateRecords.some((t) => t.poolId === p.id))
        reasons.push(
          `Pool ${p.name} would take it, but its runner software isn't installed yet; review its machines.`,
        );
      else if (notReady.length === machines.length && machines.length)
        reasons.push(
          `Pool ${p.name} would take it, but its machines aren't ready: ${notReady.map((m) => m.name).join(", ")}.`,
        );
      else reasons.push(`Pool ${p.name} should start a one-job runner for it within a minute.`);
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
      reasons.push(
        `Pool ${p.name} would take it, but calls for no runners yet; check its machines.`,
      );
    else if (installed.length === 0) {
      const names = [
        ...new Set(desired.map((d) => view.machines.find((m) => m.id === d.machineId)?.name)),
      ].filter(Boolean);
      reasons.push(
        `Pool ${p.name}'s runners aren't installed yet; review ${names.join(", ")} to install them.`,
      );
    }
  }
  return [...new Set(reasons)];
}
