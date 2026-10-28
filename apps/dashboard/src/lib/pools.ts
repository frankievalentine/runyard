import type { DesiredRunner, FleetView, RunnerView, Scope } from "@runyard/core";

export function sameScope(a: Scope, b: Scope): boolean {
  return (
    a.forgeId === b.forgeId &&
    a.kind === b.kind &&
    a.target.toLowerCase() === b.target.toLowerCase()
  );
}

/** GitHub's runner for a desired one: same scope, same name. */
export function runnerFor(view: FleetView, d: DesiredRunner): RunnerView | undefined {
  return view.github.runners.find(
    (r) => sameScope(r.scope, d.scope) && r.name.toLowerCase() === d.name.toLowerCase(),
  );
}

/** Scopes a pool can serve: each organization installation, and each repository of a personal installation. */
export function availableScopes(view: FleetView): { scope: Scope; label: string; group: string }[] {
  const out: { scope: Scope; label: string; group: string }[] = [];
  for (const app of view.github.apps) {
    for (const i of app.installations) {
      if (i.accountType === "Organization") {
        out.push({
          scope: { forgeId: app.forgeId, kind: "org", target: i.account },
          label: `${i.account} (all repositories)`,
          group: i.account,
        });
      } else {
        for (const repo of i.repos)
          out.push({
            scope: { forgeId: app.forgeId, kind: "repo", target: repo },
            label: repo,
            group: i.account,
          });
      }
    }
  }
  return out;
}

export function scopeLabel(scope: Scope): string {
  return scope.kind === "org" ? `${scope.target} (organization)` : scope.target;
}
