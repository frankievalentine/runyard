import { scopeKey } from "../scope.ts";
import type { RunnerKind, Scope } from "../model.ts";
import {
  isActive,
  serviceModeFor,
  type DesiredRunner,
  type DesiredTemplate,
  type LocalTemplate,
  type TemplateRecord,
  type ForgejoMode,
  type LocalRunner,
  type Migration,
  type RemoteRunner,
  type ServiceMode,
} from "./model.ts";

export type PlanAction =
  | "install"
  | "start"
  | "reconcileLabels"
  | "remove"
  | "inspect"
  | "repairRegistration"
  | "recoverLocal"
  | "preserveService"
  | "inspectOffline"
  | "publicRepo"
  | "groupPolicy"
  | "unsupportedPlatform"
  | "installTemplate"
  | "removeTemplate"
  | "retire";

export type PlanItem = {
  action: PlanAction;
  machineId: string;
  runnerName: string;
  scope: Scope;
  /** The runner's exact directory. */
  path: string;
  reason: string;
  /** Needs a person: the plan can't do it, or a guard refuses it. */
  blocked: boolean;
  /** For reconcileLabels: the labels to set. For install: the labels to register with. */
  labels?: string[];
  serviceMode: ServiceMode;
  runnerKind: RunnerKind;
  /** Forgejo only: how its labels run jobs. */
  forgejoMode?: ForgejoMode;
};

/** A runner Runyard registered earlier, kept so it can be found and removed when no longer wanted. */
export type Registration = {
  key: string;
  machineId: string;
  runnerName: string;
  scope: Scope;
  path: string;
  serviceMode: ServiceMode;
  runnerKind: RunnerKind;
};

/** Whether a scope may get persistent runners. */
export type ScopePolicy =
  /** A private repository, or an organization group that admits no public repositories. */
  { ok: true } | { ok: false; reason: string };

/** Everything one machine's plan is computed from: read fresh before review and again before execution. */
export type PlanInput = {
  machineId: string;
  desired: DesiredRunner[];
  registrations: Registration[];
  /** Probe results by exact path. */
  local: ReadonlyMap<string, LocalRunner>;
  /** GitHub runners by scope key, then by name. */
  github: ReadonlyMap<string, ReadonlyMap<string, RemoteRunner>>;
  policies: ReadonlyMap<string, ScopePolicy>;
  machineError: string | null;
  /** Per scope key: why GitHub couldn't be read. */
  githubErrors: ReadonlyMap<string, string>;
  /** On-demand pools' runner templates for this machine. */
  templates?: DesiredTemplate[];
  /** Templates Runyard installed earlier. */
  templateRecords?: TemplateRecord[];
  /** Template probes by exact path. */
  localTemplates?: ReadonlyMap<string, LocalTemplate>;
  /** Runners Runyard didn't install that are moving into a pool. */
  migrations?: Migration[];
};

/** Labels GitHub adds by itself; reconciling never adds or removes them. */
const BUILTIN = new Set(["self-hosted", "linux", "macos", "windows", "x64", "arm64", "arm"]);

/** The old runner's labels that jobs could ask for and the replacement wouldn't have. */
export function uncoveredLabels(old: string[], replacement: string[]): string[] {
  const have = new Set(replacement.map((l) => l.toLowerCase()));
  return [
    ...new Set(old.map((l) => l.toLowerCase()).filter((l) => !BUILTIN.has(l) && !have.has(l))),
  ].sort();
}

export function labelDrift(desired: string[], actual: string[]) {
  const want = new Set(desired.map((l) => l.toLowerCase()));
  const have = new Set(actual.map((l) => l.toLowerCase()).filter((l) => !BUILTIN.has(l)));
  return {
    missing: [...want].filter((l) => !have.has(l)).sort(),
    unexpected: [...have].filter((l) => !want.has(l)).sort(),
  };
}

/**
 * Desired versus actual for one machine, as plan items. Pure. Ported from
 * aarondfrancis/fleet's plan.py rules: unreachable sources block instead of looking
 * missing, half-configured runners need a person, busy runners are never
 * touched, and nothing is ever replaced.
 */
export function planMachine(input: PlanInput): PlanItem[] {
  const items: PlanItem[] = [];
  const desiredKeys = new Set(input.desired.map((d) => d.key));

  for (const d of input.desired) {
    const sk = scopeKey(d.scope);
    const base = {
      machineId: d.machineId,
      runnerName: d.name,
      scope: d.scope,
      path: d.path,
      serviceMode: d.serviceMode,
      runnerKind: d.runnerKind,
      ...(d.forgejoMode ? { forgejoMode: d.forgejoMode } : {}),
    };
    const item = (
      action: PlanAction,
      reason: string,
      blocked = false,
      labels?: string[],
    ): PlanItem => ({
      ...base,
      action,
      reason,
      blocked,
      ...(labels ? { labels } : {}),
    });

    if (d.runnerKind === "forgejo" && d.serviceMode !== "systemd") {
      items.push(item("unsupportedPlatform", "forgejo-runner is only published for Linux.", true));
      continue;
    }
    const ghError = input.githubErrors.get(sk);
    if (ghError || input.machineError) {
      const reasons = [
        ghError && `${d.runnerKind === "forgejo" ? "Forgejo" : "GitHub"} unavailable: ${ghError}`,
        input.machineError && `machine unavailable: ${input.machineError}`,
      ];
      items.push(item("inspect", reasons.filter(Boolean).join("; "), true));
      continue;
    }

    const remote = input.github.get(sk)?.get(d.name.toLowerCase());
    const local = input.local.get(d.path);
    const configured = local?.configured === true;

    if (!remote && !configured) {
      const policy = input.policies.get(sk);
      if (!policy || !policy.ok) {
        // Forgejo has no runner groups: an account's public repositories need the typed override.
        const action =
          d.scope.kind === "repo" || d.runnerKind === "forgejo" ? "publicRepo" : "groupPolicy";
        items.push(
          item(
            action,
            policy && !policy.ok ? policy.reason : "Its access policy couldn't be checked.",
            true,
          ),
        );
        continue;
      }
      items.push(
        item(
          "install",
          `register in ${d.scope.target} and start it as a ${describeMode(d.serviceMode)}`,
          false,
          d.labels,
        ),
      );
      continue;
    }
    if (!remote && configured) {
      items.push(
        item(
          "repairRegistration",
          "The directory is configured, but GitHub has no runner with this name. Inspect it by hand.",
          true,
        ),
      );
      continue;
    }
    if (remote && !configured) {
      items.push(
        item(
          "recoverLocal",
          "GitHub has this runner, but its directory isn't configured on the machine.",
          true,
        ),
      );
      continue;
    }
    if (!remote || !local) continue;
    if (local.agentName && local.agentName !== d.name) {
      items.push(
        item(
          "repairRegistration",
          `The directory is configured as ${local.agentName}, not ${d.name}.`,
          true,
        ),
      );
      continue;
    }

    const { missing, unexpected } = labelDrift(d.labels, remote.labels);
    if (missing.length || unexpected.length) {
      const changes = [
        missing.length && `add ${missing.join(", ")}`,
        unexpected.length && `remove ${unexpected.join(", ")}`,
      ];
      items.push(item("reconcileLabels", changes.filter(Boolean).join("; "), false, d.labels));
    }
    if (!isActive(local.service)) {
      if (remote.busy)
        items.push(
          item(
            "preserveService",
            `The service is ${local.service}, but GitHub reports a running job.`,
            true,
          ),
        );
      else items.push(item("start", `The service is ${local.service}.`));
    } else if (remote.status !== "online") {
      items.push(
        item(
          "inspectOffline",
          "The service is running, but GitHub reports the runner offline.",
          true,
        ),
      );
    }
  }

  // Runners Runyard registered that no pool wants any more.
  for (const r of input.registrations) {
    if (r.machineId !== input.machineId || desiredKeys.has(r.key)) continue;
    const sk = scopeKey(r.scope);
    const base = {
      machineId: r.machineId,
      runnerName: r.runnerName,
      scope: r.scope,
      path: r.path,
      serviceMode: r.serviceMode,
      runnerKind: r.runnerKind,
    };
    const ghError = input.githubErrors.get(sk);
    if (ghError || input.machineError) {
      items.push({
        ...base,
        action: "inspect",
        reason: ghError ?? input.machineError ?? "",
        blocked: true,
      });
      continue;
    }
    const remote = input.github.get(sk)?.get(r.runnerName.toLowerCase());
    if (remote?.busy) {
      items.push({
        ...base,
        action: "remove",
        reason: "No pool needs it, but it's running a job. Remove it once it's idle.",
        blocked: true,
      });
      continue;
    }
    items.push({
      ...base,
      action: "remove",
      reason:
        "No pool needs it any more: stop and uninstall its service and deregister it. The directory is kept.",
      blocked: false,
    });
  }
  items.push(...planTemplates(input));
  items.push(...planRetirements(input));
  return items;
}

/**
 * Runners Runyard didn't install, retired once a runner from their new pool
 * stands in for them: online, idle, labeled and running, on the same machine
 * and scope (aarondfrancis/fleet's retire rule). Retiring only deregisters the
 * old runner on the forge; its service and directory are left for a person.
 */
function planRetirements(input: PlanInput): PlanItem[] {
  const items: PlanItem[] = [];
  for (const m of input.migrations ?? []) {
    if (m.machineId !== input.machineId) continue;
    const sk = scopeKey(m.scope);
    const replacements = input.desired.filter(
      (d) => d.poolId === m.poolId && scopeKey(d.scope) === sk,
    );
    const first = replacements[0];
    const item = (reason: string, blocked: boolean): PlanItem => ({
      action: "retire",
      machineId: m.machineId,
      runnerName: m.runnerName,
      scope: m.scope,
      path: m.path ?? "",
      reason,
      blocked,
      serviceMode: first?.serviceMode ?? "systemd",
      runnerKind: first?.runnerKind ?? "actions",
    });
    const forgeError = input.githubErrors.get(sk);
    if (forgeError) {
      items.push(item(`The forge couldn't be read: ${forgeError}`, true));
      continue;
    }
    const old = input.github.get(sk)?.get(m.runnerName.toLowerCase());
    // Already gone from the forge: nothing left to retire.
    if (!old) continue;
    if (!first) {
      items.push(
        item(
          `The pool has no runner for ${m.scope.target} on this machine. Add the machine or ${m.scope.target} to it.`,
          true,
        ),
      );
      continue;
    }
    const uncovered = uncoveredLabels(old.labels, first.labels);
    if (uncovered.length) {
      items.push(
        item(
          `Jobs asking for ${uncovered.join(", ")} would have no runner; add ${uncovered.length === 1 ? "it" : "them"} to pool ${first.poolName}.`,
          true,
        ),
      );
      continue;
    }
    if (old.busy) {
      items.push(item("It's running a job; it can be retired once it's idle.", true));
      continue;
    }
    if (input.machineError) {
      items.push(item(`The replacement can't be checked: ${input.machineError}`, true));
      continue;
    }
    const standIn = replacements.find((d) => {
      const remote = input.github.get(sk)?.get(d.name.toLowerCase());
      const local = input.local.get(d.path);
      const drift = remote ? labelDrift(d.labels, remote.labels) : null;
      return (
        remote?.status === "online" &&
        !remote.busy &&
        drift?.missing.length === 0 &&
        drift.unexpected.length === 0 &&
        local?.configured === true &&
        isActive(local.service)
      );
    });
    if (!standIn) {
      items.push(
        item(
          `Waiting for ${replacements.map((d) => d.name).join(" or ")} to be online, idle, labeled and running.`,
          true,
        ),
      );
      continue;
    }
    items.push(
      item(
        `Deregister it; ${standIn.name} takes its jobs. Its service and directory are left for you to remove.`,
        false,
      ),
    );
  }
  return items;
}

/**
 * On-demand pools' runner templates: installed once per machine and runner
 * program, under the same guards as runners, and removed when no pool needs
 * them. One-job runners are started from them later, without a review.
 */
function planTemplates(input: PlanInput): PlanItem[] {
  const items: PlanItem[] = [];
  const wanted = (input.templates ?? []).filter((t) => t.machineId === input.machineId);
  const wantedKeys = new Set(wanted.map((t) => t.key));
  for (const t of wanted) {
    const mode = serviceModeFor(t.os);
    const item = (action: PlanAction, reason: string, blocked: boolean): PlanItem => ({
      action,
      machineId: t.machineId,
      runnerName: `${t.poolName} template`,
      scope: t.scopes[0]!,
      path: t.path,
      reason,
      blocked,
      serviceMode: mode ?? "systemd",
      runnerKind: t.runnerKind,
      labels: t.labels,
      ...(t.forgejoMode ? { forgejoMode: t.forgejoMode } : {}),
    });
    if (t.os !== "linux" && t.os !== "macos") {
      items.push(
        item(
          "unsupportedPlatform",
          "On-demand runners run on Linux and macOS machines for now.",
          true,
        ),
      );
      continue;
    }
    if (t.runnerKind === "forgejo" && t.os !== "linux") {
      items.push(item("unsupportedPlatform", "forgejo-runner is only published for Linux.", true));
      continue;
    }
    if (input.machineError) {
      items.push(item("inspect", input.machineError, true));
      continue;
    }
    const local = input.localTemplates?.get(t.path);
    if (local?.present) continue;
    // A one-job runner may serve any of the pool's scopes, so each must pass.
    const refused = t.scopes
      .map((s) => ({ s, policy: input.policies.get(scopeKey(s)) }))
      .find(({ policy }) => !policy || !policy.ok);
    if (refused) {
      const action =
        refused.s.kind === "repo" || t.runnerKind === "forgejo" ? "publicRepo" : "groupPolicy";
      items.push(
        item(
          action,
          refused.policy && !refused.policy.ok
            ? refused.policy.reason
            : "Its access policy couldn't be checked.",
          true,
        ),
      );
      continue;
    }
    items.push(
      item(
        "installTemplate",
        `Download and unpack ${t.runnerKind === "forgejo" ? "forgejo-runner" : "GitHub's runner"} for one-job runners; nothing is registered until a job needs it.`,
        false,
      ),
    );
  }
  for (const r of input.templateRecords ?? []) {
    if (r.machineId !== input.machineId || wantedKeys.has(r.key)) continue;
    if (input.localTemplates && !input.localTemplates.get(r.path)?.present) continue;
    items.push({
      action: "removeTemplate",
      machineId: r.machineId,
      runnerName: `${r.poolName} template`,
      scope: r.scope,
      path: r.path,
      reason: "No on-demand pool needs it any more: delete the unpacked runner software.",
      blocked: false,
      serviceMode: r.serviceMode,
      runnerKind: r.runnerKind,
    });
  }
  return items;
}

/** Plan items Runyard can carry out; the rest wait for a person. */
export function actionable(items: PlanItem[]): PlanItem[] {
  return items.filter((i) => !i.blocked);
}

/** A comparable fingerprint: execution refuses unless the regenerated plan matches the reviewed one. */
export function planFingerprint(items: PlanItem[]): string {
  return JSON.stringify(
    items
      .map((i) => [i.action, i.runnerName, scopeKey(i.scope), i.path, i.blocked, i.labels ?? null])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

function describeMode(mode: ServiceMode): string {
  return mode === "launchagent"
    ? "LaunchAgent"
    : mode === "systemd"
      ? "systemd service"
      : "Windows service";
}
