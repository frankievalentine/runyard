import type {
  YardView,
  ForgejoMode,
  OsFamily,
  PoolMode,
  QueuedJobView,
  Scope,
  ToolProfile,
} from "@runyard/core";
import { availableScopes, sameScope } from "./pools.ts";
import { isBuiltinLabel, osLabel } from "./status.ts";

/** A pool's settings before it's saved: what the form edits and suggestions prefill. */
export type PoolDraft = {
  name: string;
  labels: string[];
  machines: { machineId: string; slots: number }[];
  scopes: Scope[];
  forgejoMode: ForgejoMode;
  mode?: PoolMode;
  toolProfiles?: ToolProfile[];
};

export type PoolSuggestion = {
  id: string;
  /** Why Runyard suggests it, in a few words. */
  title: string;
  detail: string;
  draft: PoolDraft;
};

const OS_LABELS: Record<string, OsFamily> = { macos: "macos", linux: "linux", windows: "windows" };
const MAX = 4;

/**
 * Pools Runyard can justify from what it sees, most useful first: queued jobs
 * that no runner matches, then machines not in any pool yet. No I/O.
 */
export function suggestPools(view: YardView): PoolSuggestion[] {
  const options = availableScopes(view);
  const pooled = new Set(view.pools.pools.flatMap((p) => p.machines.map((m) => m.machineId)));
  const usable = view.machines.filter((m) => m.os !== null);
  const taken = new Set(view.pools.pools.map((p) => p.name));
  const uniqueName = (base: string) => {
    let name = base || "pool";
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    return name;
  };
  const out: PoolSuggestion[] = [];

  // Jobs waiting with no runner that has their labels, grouped by those labels.
  const groups = new Map<string, QueuedJobView[]>();
  for (const job of view.queue.jobs) {
    if (job.onDemand || job.eligible.length > 0) continue;
    const key = `${job.forge}:${[...job.labels]
      .map((l) => l.toLowerCase())
      .sort()
      .join(",")}`;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  for (const [key, jobs] of groups) {
    const job = jobs[0]!;
    const custom = job.labels.filter((l) => !isBuiltinLabel(l));
    // forgejo-runner is Linux-only; otherwise an OS label picks the machines.
    const os =
      job.forge === "forgejo"
        ? "linux"
        : (job.labels.map((l) => OS_LABELS[l.toLowerCase()]).find(Boolean) ?? null);
    const machines = usable.filter((m) => os === null || m.os === os);
    if (machines.length === 0) continue;
    const scopes = uniqueScopes(
      jobs.map((j) => scopeFor(options, j)).filter((s): s is Scope => s !== null),
    );
    if (scopes.length === 0) continue;
    const wanted = custom.length
      ? custom.join(", ")
      : os === null
        ? "a self-hosted runner"
        : `a ${osLabel[os]} runner`;
    out.push({
      id: `queue:${key}`,
      title: `${jobs.length} queued job${jobs.length === 1 ? " waits" : "s wait"} for ${wanted}`,
      detail: `${os ? `${osLabel[os]} runners` : "Runners"} on ${names(machines)} for ${scopes.map((s) => s.target).join(", ")}`,
      draft: {
        name: uniqueName(slug(custom[0] ?? os ?? "ci")),
        labels: custom,
        machines: machines.map((m) => ({ machineId: m.id, slots: 1 })),
        scopes,
        forgejoMode: { kind: "host" },
      },
    });
  }

  // Machines not in a pool, one suggestion per operating system, unless a
  // queue suggestion above already covers them.
  const suggested = new Set(out.flatMap((s) => s.draft.machines.map((m) => m.machineId)));
  for (const os of ["linux", "macos", "windows"] as const) {
    const machines = usable.filter((m) => m.os === os && !pooled.has(m.id));
    // True for none at all, too.
    if (machines.every((m) => suggested.has(m.id))) continue;
    // forgejo-runner only runs on Linux, so other machines serve GitHub only.
    const scopes = options
      .filter((o) => o.forge === "github" || os === "linux")
      .filter(
        (o) => o.scope.kind !== "repo" || options.filter((x) => x.group === o.group).length <= 3,
      )
      .map((o) => o.scope);
    if (scopes.length === 0) continue;
    out.push({
      id: `os:${os}`,
      title: `${osLabel[os]} machine${machines.length === 1 ? "" : "s"} without a pool`,
      detail: `1 runner each on ${names(machines)}, for ${scopes.length === 1 ? scopes[0]!.target : `${scopes.length} accounts and repositories`}`,
      draft: {
        name: uniqueName(os),
        labels: [],
        machines: machines.map((m) => ({ machineId: m.id, slots: 1 })),
        scopes,
        forgejoMode: { kind: "host" },
      },
    });
  }
  return out.slice(0, MAX);
}

/** The scope that would serve a job's repository: its account's, else the repository's own. */
function scopeFor(options: ReturnType<typeof availableScopes>, job: QueuedJobView): Scope | null {
  const owner = job.repo.split("/")[0]!.toLowerCase();
  const forge = job.forge;
  const account = options.find(
    (o) => o.forge === forge && o.scope.kind !== "repo" && o.scope.target.toLowerCase() === owner,
  );
  if (account) return account.scope;
  return (
    options.find(
      (o) =>
        o.forge === forge &&
        o.scope.kind === "repo" &&
        o.scope.target.toLowerCase() === job.repo.toLowerCase(),
    )?.scope ?? null
  );
}

function uniqueScopes(scopes: Scope[]): Scope[] {
  return scopes.filter((s, i) => scopes.findIndex((t) => sameScope(s, t)) === i);
}

function names(machines: { name: string }[]): string {
  return machines.length <= 2
    ? machines.map((m) => m.name).join(" and ")
    : `${machines[0]!.name} and ${machines.length - 1} more`;
}

/** A pool name from a label: lowercase letters, digits and dashes. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
}
