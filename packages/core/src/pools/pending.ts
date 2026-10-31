import type { RunnerView } from "../github/derive.ts";
import type { YardView } from "../machines/derive.ts";
import { scopeKey } from "../scope.ts";
import type { ForgeKind, Scope } from "../model.ts";
import { labelDrift } from "./plan.ts";
import { poolTools, toolInstallPlan, toolList } from "./tools.ts";

/** Which forge each connection in the view is. */
export function forgeKindsOf(view: Pick<YardView, "github" | "forgejo">): Map<string, ForgeKind> {
  return new Map<string, ForgeKind>([
    ...view.github.apps.map((a): [string, ForgeKind] => [a.forgeId, "github"]),
    ...view.forgejo.connections.map((c): [string, ForgeKind] => [c.forgeId, "forgejo"]),
  ]);
}

/**
 * What a machine's review would most likely do, from what Runyard already
 * knows: its records, the forges' runner lists and the machine's last check.
 * A hint for when to review, not the plan: the review reads everything again
 * and decides, and may find more (a runner changed by hand) or less.
 */
export function pendingChanges(view: YardView, machineId: string): string[] {
  const out: string[] = [];
  const machine = view.machines.find((m) => m.id === machineId);
  if (!machine || machine.connection.state !== "connected") return out;
  const p = view.pools;
  const forgeRunner = (scope: Scope, name: string): RunnerView | undefined =>
    view.runners.find(
      (r) => scopeKey(r.scope) === scopeKey(scope) && r.name.toLowerCase() === name.toLowerCase(),
    );

  const kinds = forgeKindsOf(view);
  const wantedTools = [
    ...new Set(
      p.pools
        .filter((pool) => pool.machines.some((m) => m.machineId === machineId))
        .flatMap((pool) => poolTools(pool, kinds, machine.os)),
    ),
  ];

  if (wantedTools.length && machine.readiness && machine.os) {
    const install = toolInstallPlan(machine.os, machine.readiness, wantedTools).install;
    if (install.length) out.push(`Install ${toolList(install, machine.os)}`);
  }

  const desired = p.desired.filter((d) => d.machineId === machineId);
  for (const d of desired) {
    const registration = p.registrations.find((r) => r.key === d.key);
    const remote = forgeRunner(d.scope, d.name);
    // Recorded but not on the forge counts too (removed there, or never finished), when
    // the forge's runner list could be read.
    if (!registration || (!remote && forgeRead(view, d.scope.forgeId))) {
      out.push(`Install ${d.name}`);
      continue;
    }
    if (d.runnerKind === "forgejo" && remote && registration.history !== true) {
      out.push(`Record jobs on ${d.name}`);
      continue;
    }
    if (!remote || d.runnerKind !== "actions") continue;

    if (!remote.stale) {
      const drift = labelDrift(d.labels, remote.labels);
      if (drift.missing.length || drift.unexpected.length) out.push(`Update labels on ${d.name}`);
    }
    // Cleanup unknown (null) for runners installed before Runyard recorded it; job hooks
    // missing on runners set up before run history.
    const applied = registration.cleanup;
    const cleanupChanged = applied != null && applied !== (d.cleanup ?? "off");
    const hooksMissing = d.serviceMode !== "windows-service" && registration.history !== true;
    if (cleanupChanged || hooksMissing) out.push(`Set job hooks on ${d.name}`);
  }
  const wanted = new Set(desired.map((d) => d.key));
  for (const r of p.registrations)
    if (r.machineId === machineId && !wanted.has(r.key)) out.push(`Remove ${r.runnerName}`);

  const templates = p.templates.filter((t) => t.machineId === machineId);
  for (const t of templates)
    if (!p.templateRecords.some((r) => r.key === t.key))
      out.push(`Install runner software for ${t.poolName}`);
  const wantedTemplates = new Set(templates.map((t) => t.key));
  for (const r of p.templateRecords)
    if (r.machineId === machineId && !wantedTemplates.has(r.key))
      out.push(`Remove runner software for ${r.poolName}`);

  for (const m of p.migrations)
    if (m.machineId === machineId && m.state === "ready") out.push(`Retire ${m.runnerName}`);
  return out;
}

/** Whether the forge's runner lists were read without errors, so a missing runner is missing. */
function forgeRead(view: YardView, forgeId: string): boolean {
  const app = view.github.apps.find((a) => a.forgeId === forgeId);
  if (app)
    return !app.error && app.installations.every((i) => !i.runnersError && i.runnersAt !== null);
  const conn = view.forgejo.connections.find((c) => c.forgeId === forgeId);
  if (conn)
    return !conn.error && conn.scopes.every((sc) => !sc.runnersError && sc.runnersAt !== null);
  return false;
}
