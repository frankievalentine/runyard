import { pendingChanges } from "../pools/pending.ts";
import { sshUser } from "./access.ts";
import { readinessProblems } from "./readiness.ts";
import type { YardView } from "./derive.ts";

export type Issue = {
  id: string;
  title: string;
  detail: string;
  /** The machine the issue opens, if any. */
  machineId: string | null;
  /** A page the issue opens instead of a machine. */
  page?: "boat";
  /** The section of the machine's page it opens. */
  hash?: "changes";
  /** A runner the issue opens instead. */
  runnerKey?: string;
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
    const pending = pendingChanges(view, m.id);
    if (pending.length)
      issues.push({
        id: `${m.id}:changes`,
        title: `${m.name}: ${pending.length === 1 ? "a change" : `${pending.length} changes`} waiting`,
        detail: `${pending.join("; ")}. Review its changes, then run them.`,
        machineId: m.id,
        hash: "changes",
      });
    const d = m.diagnostics;
    if (!d || d.stale || c.state !== "connected") continue;
    const macRunners = macRunnerIssue(view, m.id);
    if (macRunners) issues.push(macRunners);
    const missing = readinessProblems(m.readiness);
    if (
      missing.length &&
      view.pools.pools.some((p) => p.machines.some((x) => x.machineId === m.id))
    )
      issues.push({
        id: `${m.id}:readiness`,
        title: `${m.name}: not ready for its pools' jobs`,
        detail: `${missing.map((i) => `${i.title}: ${i.value}`).join("; ")}. See Runner readiness on its page.`,
        machineId: m.id,
      });
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
  // Runners registered another way, until someone says which machine they run on.
  const unmanaged = view.runners.filter(
    (r) => r.listed && !r.ephemeral && !r.onDemand && !r.machineId,
  );
  const first = unmanaged[0];
  // The same name can be registered in several scopes.
  const names = [...new Set(unmanaged.map((r) => r.name))];
  if (first)
    issues.push({
      id: "runners:unmanaged",
      title:
        unmanaged.length === 1
          ? `${first.name}: not managed by Runyard`
          : `${unmanaged.length} runners Runyard doesn't manage`,
      detail: `${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}. Open ${unmanaged.length === 1 ? "it" : "one"} to choose the machine it runs on, then move it into a pool if you'd like Runyard to take it over.`,
      machineId: null,
      runnerKey: first.key,
    });
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

/**
 * A Mac in a pool whose runners stop at logout: they're LaunchAgents, so
 * after a restart they wait for their user to log in unless automatic login
 * is on for that user.
 */
function macRunnerIssue(view: YardView, machineId: string): Issue | null {
  const m = view.machines.find((x) => x.id === machineId);
  if (!m || m.os !== "macos") return null;
  if (!view.pools.pools.some((p) => p.machines.some((x) => x.machineId === machineId))) return null;
  const check = m.diagnostics?.checks.find((c) => c.id === "login-auto");
  if (!check) return null;
  const runAs = sshUser(m.sshTarget);
  const autoUser = check.value.startsWith("As ") ? check.value.slice(3) : null;
  const fix =
    "Turn on automatic login for it in System Settings ▸ Users & Groups (not available while FileVault is on).";
  if (!autoUser)
    return {
      id: `${m.id}:mac-login`,
      title: `${m.name}: runners stop while logged out`,
      detail: `Its runners are LaunchAgents, which run only while ${runAs ?? "their user"} is logged in, and automatic login is off. ${fix}`,
      machineId: m.id,
    };
  if (runAs && autoUser !== runAs)
    return {
      id: `${m.id}:mac-login`,
      title: `${m.name}: runners stop while logged out`,
      detail: `Automatic login is for ${autoUser}, but the runners run as ${runAs}. ${fix}`,
      machineId: m.id,
    };
  return null;
}
