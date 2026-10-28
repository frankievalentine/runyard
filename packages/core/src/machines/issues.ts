import type { YardView } from "./derive.ts";

export type Issue = {
  id: string;
  title: string;
  detail: string;
  /** The machine the issue opens, if any. */
  machineId: string | null;
  /** A page the issue opens instead of a machine. */
  page?: "boat";
};

/**
 * What needs a look, besides active alerts (shown separately). Ported from
 * aarondfrancis/fleet's `issues`: findings come only from current data, and an active alert
 * replaces the matching disk or offline row.
 */
export function deriveIssues(view: YardView): Issue[] {
  const issues: Issue[] = [];
  if (view.tailnet.error) {
    issues.push({
      id: "tailnet",
      title: "Tailscale can't be read on this machine",
      detail: `${view.tailnet.error} Tailnet status and offline alerts wait for it.`,
      machineId: null,
    });
  }
  for (const m of view.machines) {
    const c = m.connection;
    if (c.state === "error") {
      issues.push({
        id: `${m.id}:ssh`,
        title: `${m.name}: couldn't connect over SSH`,
        detail: c.detail,
        machineId: m.id,
      });
    } else if (c.state === "stale") {
      issues.push({
        id: `${m.id}:ssh`,
        title: `${m.name}: showing an old SSH read`,
        detail: c.reason,
        machineId: m.id,
      });
    }
    const d = m.diagnostics;
    if (!d || d.stale || c.state !== "connected") continue;
    const diskAlert = m.alerts.some((a) => a.kind === "lowDisk");
    for (const check of d.checks) {
      if (check.status !== "warn" || (diskAlert && check.id === "disk-space")) continue;
      issues.push({
        id: `${m.id}:${check.id}`,
        title: `${m.name}: ${check.title}`,
        detail: `${check.value}. ${check.detail}`,
        machineId: m.id,
      });
    }
  }
  const leftover = view.boat?.leftover ?? [];
  if (leftover.length) {
    const dollars = leftover.reduce((sum, v) => sum + (v.dollars ?? 0), 0);
    issues.push({
      id: "boat:leftover",
      title: `${leftover.length} boat.dev VM${leftover.length === 1 ? "" : "s"} running outside CI`,
      detail: `${leftover.map((v) => v.name).join(", ")}${dollars > 0 ? `: $${dollars.toFixed(2)} so far this month` : ""}. Still billing; stop ${leftover.length === 1 ? "it" : "them"} if no longer needed.`,
      machineId: null,
      page: "boat",
    });
  }
  return issues;
}
