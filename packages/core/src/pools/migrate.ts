import type { RunnerView } from "../github/derive.ts";
import type { OsFamily } from "../machines/model.ts";
import type { RunnerKind } from "../model.ts";
import { scopeKey } from "../scope.ts";
import type { DesiredRunner, Migration, Pool } from "./model.ts";
import { labelDrift, uncoveredLabels } from "./plan.ts";

export type MigrationState =
  /** The forge no longer lists the old runner: nothing left to do. */
  | "gone"
  /** The pool calls for no runner on that machine and scope. */
  | "noReplacement"
  /** The old runner has labels the pool's runners lack. */
  | "labels"
  /** The old runner is running a job. */
  | "busy"
  /** The replacement isn't installed, or isn't online and idle yet. */
  | "waiting"
  /** The machine's review can retire it. */
  | "ready";

export type MigrationView = Migration & {
  poolName: string;
  state: MigrationState;
  detail: string;
  /** The pool's runners that can stand in for it. */
  replacements: string[];
};

/**
 * Where each migration stands, from the forges' last reads. A guide for the
 * dashboard only: the machine's review re-reads everything and decides.
 */
export function migrationViews(
  migrations: Migration[],
  pools: Pool[],
  desired: DesiredRunner[],
  runners: RunnerView[],
): MigrationView[] {
  const runnerFor = (scope: Migration["scope"], name: string) =>
    runners.find(
      (r) => scopeKey(r.scope) === scopeKey(scope) && r.name.toLowerCase() === name.toLowerCase(),
    );
  const out: MigrationView[] = [];
  for (const m of migrations) {
    const pool = pools.find((p) => p.id === m.poolId);
    if (!pool) continue;
    const replacements = desired.filter(
      (d) =>
        d.poolId === m.poolId &&
        d.machineId === m.machineId &&
        scopeKey(d.scope) === scopeKey(m.scope),
    );
    const view = (state: MigrationState, detail: string): MigrationView => ({
      ...m,
      poolName: pool.name,
      state,
      detail,
      replacements: replacements.map((d) => d.name),
    });
    const old = runnerFor(m.scope, m.runnerName);
    if (!old) {
      out.push(view("gone", "The forge no longer lists it, so there's nothing left to retire."));
      continue;
    }
    const first = replacements[0];
    if (!first) {
      out.push(
        view(
          "noReplacement",
          `Pool ${pool.name} has no runner for ${m.scope.target} on this machine. Add the machine or ${m.scope.target} to the pool.`,
        ),
      );
      continue;
    }
    const uncovered = uncoveredLabels(old.labels, first.labels);
    if (uncovered.length) {
      out.push(
        view(
          "labels",
          `Jobs asking for ${uncovered.join(", ")} would have no runner. Add ${uncovered.length === 1 ? "it" : "them"} to pool ${pool.name}.`,
        ),
      );
      continue;
    }
    if (old.activity === "busy") {
      out.push(view("busy", "It's running a job; it can be retired once it's idle."));
      continue;
    }
    const remotes = replacements.map((d) => ({ d, r: runnerFor(d.scope, d.name) }));
    const standIn = remotes.find(({ d, r }) => {
      if (!r || r.stale || r.activity !== "idle") return false;
      const drift = labelDrift(d.labels, r.labels);
      return drift.missing.length === 0 && drift.unexpected.length === 0;
    });
    if (standIn) {
      out.push(
        view(
          "ready",
          `${standIn.d.name} is online and idle. Review the machine to retire ${m.runnerName}.`,
        ),
      );
    } else if (remotes.every(({ r }) => !r)) {
      out.push(
        view(
          "waiting",
          `Review the machine to install ${first.name} first; ${m.runnerName} is retired once it's online and idle.`,
        ),
      );
    } else {
      out.push(
        view(
          "waiting",
          `Waiting for ${replacements.map((d) => d.name).join(" or ")} to be online, idle and labeled.`,
        ),
      );
    }
  }
  return out;
}

/**
 * The steps a person runs after Runyard deregisters a runner it didn't
 * install: stop and remove its service. Runyard never runs these itself.
 */
export function retireCleanup(os: OsFamily | null, kind: RunnerKind, path: string | null): string {
  const dir = path ?? "<its directory>";
  if (kind === "forgejo")
    return [
      "Stop and remove its service by hand. Find its systemd unit with:",
      "  systemctl list-units --all 'forgejo-runner*'",
      "then: sudo systemctl disable --now <unit>",
      `Its directory (${dir}) can be deleted afterward.`,
    ].join("\n");
  if (os === "windows")
    return [
      "Stop and remove its service by hand, in an administrator PowerShell:",
      "  Get-Service actions.runner.*",
      "  Stop-Service <name>; sc.exe delete <name>",
      `Its directory (${dir}) can be deleted afterward.`,
    ].join("\n");
  const sudo = os === "linux" ? "sudo " : "";
  return [
    "Stop and remove its service by hand:",
    `  cd ${dir} && ${sudo}./svc.sh stop && ${sudo}./svc.sh uninstall`,
    "If it ran from a terminal (run.sh) instead, stop that process.",
    "The directory can be deleted afterward.",
  ].join("\n");
}
