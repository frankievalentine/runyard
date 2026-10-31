import type { OsFamily } from "../machines/model.ts";
import { runnerKindFor, type ForgeKind } from "../model.ts";
import { scopeKey } from "../scope.ts";
import { serviceModeFor, type DesiredRunner, type DesiredTemplate, type Pool } from "./model.ts";

export const POOL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;
/** GitHub limits runner names to 64 characters. */
const MAX_RUNNER_NAME = 64;

type MachineInfo = { name: string; os: OsFamily | null };

/** Lowercase letters, digits and dashes, for runner names and paths. */
export function slug(value: string, max = 40): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/, "") || "x"
  );
}

/** A runner's own label, which only it carries. */
export function runnerLabel(name: string): string {
  return `runyard-runner-${name.toLowerCase()}`;
}

/** The directory every Runyard runner lives under; the install script refuses anything else. */
export function runnerRoot(os: OsFamily): string {
  return os === "windows" ? "C:\\ProgramData\\Runyard\\runners" : "~/runyard-runners";
}

/**
 * Every runner the pools call for. An organization (or other multi-repo
 * scope) gets one runner per slot. A personal repository gets its own runner
 * per slot too, because GitHub can't share a personal account's runner
 * across repositories, so N repositories fan out to N registrations.
 * Machines whose OS isn't known yet are skipped until it is.
 */
export function desiredRunners(
  pools: Pool[],
  machines: ReadonlyMap<string, MachineInfo>,
  /** Each forge's kind; scopes of unknown forges count as GitHub. */
  forges: ReadonlyMap<string, ForgeKind> = new Map(),
): DesiredRunner[] {
  const out: DesiredRunner[] = [];
  // On-demand pools keep no registered runners; see desiredTemplates.
  for (const pool of pools.filter((p) => p.mode !== "onDemand")) {
    for (const { machineId, slots } of pool.machines) {
      const machine = machines.get(machineId);
      const mode = machine?.os ? serviceModeFor(machine.os) : null;
      if (!machine?.os || !mode) continue;
      const windows = machine.os === "windows";
      const sep = windows ? "\\" : "/";
      for (const scope of pool.scopes) {
        const kind = runnerKindFor[forges.get(scope.forgeId) ?? "github"];
        const perRepo = scope.kind === "repo";
        for (let slot = 1; slot <= slots; slot++) {
          const n = String(slot).padStart(2, "0");
          // Forgejo runners get their own directories, so a mixed pool's runners never share one.
          const dir =
            kind === "forgejo"
              ? [pool.name, `forgejo-${slug(scope.target.replace("/", "-"))}`, n]
              : perRepo
                ? [pool.name, slug(scope.target.replace("/", "-")), n]
                : [pool.name, n];
          const name = `${slug(machine.name, 30)}-${pool.name}-${n}`.slice(0, MAX_RUNNER_NAME);
          out.push({
            key: `${pool.id}:${machineId}:${scopeKey(scope)}:${slot}`,
            poolId: pool.id,
            poolName: pool.name,
            machineId,
            scope,
            slot,
            name,
            path: [runnerRoot(machine.os), ...dir].join(sep),
            labels: [
              ...new Set([
                ...pool.labels,
                "runyard",
                `runyard-pool-${pool.name}`,
                // GitHub runners also carry their own, so a test job can target exactly one.
                ...(kind === "actions" ? [runnerLabel(name)] : []),
              ]),
            ],
            serviceMode: mode,
            runnerKind: kind,
            ...(kind === "forgejo"
              ? { forgejoMode: pool.forgejoMode }
              : { cleanup: pool.cleanup ?? "off" }),
          });
        }
      }
    }
  }
  return out;
}

/**
 * The runner templates on-demand pools call for: one per machine and runner
 * program (GitHub's actions/runner, forgejo-runner) the pool's scopes need.
 */
export function desiredTemplates(
  pools: Pool[],
  machines: ReadonlyMap<string, MachineInfo>,
  forges: ReadonlyMap<string, ForgeKind> = new Map(),
): DesiredTemplate[] {
  const out: DesiredTemplate[] = [];
  for (const pool of pools.filter((p) => p.mode === "onDemand")) {
    for (const { machineId } of pool.machines) {
      const os = machines.get(machineId)?.os;
      if (!os) continue;
      const sep = os === "windows" ? "\\" : "/";
      for (const kind of ["actions", "forgejo"] as const) {
        const scopes = pool.scopes.filter(
          (s) => runnerKindFor[forges.get(s.forgeId) ?? "github"] === kind,
        );
        if (scopes.length === 0) continue;
        out.push({
          key: `${pool.id}:${machineId}:${kind}`,
          poolId: pool.id,
          poolName: pool.name,
          machineId,
          os,
          runnerKind: kind,
          path: [runnerRoot(os), pool.name, `template-${kind}`].join(sep),
          scopes,
          labels: [...new Set([...pool.labels, "runyard", `runyard-pool-${pool.name}`])],
          ...(kind === "forgejo" ? { forgejoMode: pool.forgejoMode } : {}),
        });
      }
    }
  }
  return out;
}

/** Two desired runners in one scope with one name would collide on GitHub. */
export function nameCollisions(runners: DesiredRunner[]): string[] {
  const seen = new Map<string, DesiredRunner>();
  const problems: string[] = [];
  for (const r of runners) {
    const key = `${scopeKey(r.scope)}:${r.name}`;
    const other = seen.get(key);
    if (other)
      problems.push(
        `${r.name} is needed twice in ${r.scope.target} (pools ${other.poolName} and ${r.poolName}).`,
      );
    else seen.set(key, r);
  }
  return problems;
}
