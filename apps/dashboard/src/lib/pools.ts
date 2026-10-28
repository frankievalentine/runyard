import type { DesiredRunner, FleetView, ForgeKind, RunnerView, Scope } from "@runyard/core";

export function sameScope(a: Scope, b: Scope): boolean {
  return (
    a.forgeId === b.forgeId &&
    a.kind === b.kind &&
    a.target.toLowerCase() === b.target.toLowerCase()
  );
}

/** The forge's runner for a desired one: same scope, same name. */
export function runnerFor(view: FleetView, d: DesiredRunner): RunnerView | undefined {
  return view.runners.find(
    (r) => sameScope(r.scope, d.scope) && r.name.toLowerCase() === d.name.toLowerCase(),
  );
}

export type ScopeOption = { scope: Scope; label: string; group: string; forge: ForgeKind };

/**
 * Scopes a pool can serve: each GitHub organization installation and each
 * repository of a personal one, and each Forgejo account and organization.
 */
export function availableScopes(view: FleetView): ScopeOption[] {
  const out: ScopeOption[] = [];
  for (const app of view.github.apps) {
    for (const i of app.installations) {
      if (i.accountType === "Organization") {
        out.push({
          scope: { forgeId: app.forgeId, kind: "org", target: i.account },
          label: `${i.account} (all repositories)`,
          group: i.account,
          forge: "github",
        });
      } else {
        for (const repo of i.repos)
          out.push({
            scope: { forgeId: app.forgeId, kind: "repo", target: repo },
            label: repo,
            group: i.account,
            forge: "github",
          });
      }
    }
  }
  for (const c of view.forgejo.connections) {
    const host = new URL(c.baseUrl).host;
    for (const s of c.scopes) {
      out.push({
        scope: { forgeId: c.forgeId, kind: s.kind, target: s.target },
        label: `${s.target} on ${host} (all ${s.kind === "org" ? "organization" : "account"} repositories)`,
        group: host,
        forge: "forgejo",
      });
    }
  }
  return out;
}

/** Whether a scope belongs to a Forgejo connection. */
export function isForgejo(view: FleetView, scope: Scope): boolean {
  return view.forgejo.connections.some((c) => c.forgeId === scope.forgeId);
}

export function scopeLabel(scope: Scope): string {
  if (scope.kind === "org") return `${scope.target} (organization)`;
  if (scope.kind === "user") return `${scope.target} (account)`;
  return scope.target;
}
