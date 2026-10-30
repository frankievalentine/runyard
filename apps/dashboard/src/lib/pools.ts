import type { DesiredRunner, YardView, ForgeKind, RunnerView, Scope } from "@runyard/core";

export function sameScope(a: Scope, b: Scope): boolean {
  return (
    a.forgeId === b.forgeId &&
    a.kind === b.kind &&
    a.target.toLowerCase() === b.target.toLowerCase()
  );
}

/** The forge's runner for a desired one: same scope, same name. */
export function runnerFor(view: YardView, d: DesiredRunner): RunnerView | undefined {
  return view.runners.find(
    (r) => sameScope(r.scope, d.scope) && r.name.toLowerCase() === d.name.toLowerCase(),
  );
}

export type ScopeOption = {
  scope: Scope;
  label: string;
  group: string;
  forge: ForgeKind;
  /** A Forgejo repository listed under its account: chosen alone, or covered by the account. */
  account?: Scope;
};

/**
 * Scopes a pool can serve: each GitHub organization installation and each
 * repository of a personal one, and each Forgejo account and organization,
 * then each of their repositories.
 */
export function availableScopes(view: YardView): ScopeOption[] {
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
      // Repository scopes are listed under their account, from its repositories.
      if (s.kind === "repo") continue;
      const account: Scope = { forgeId: c.forgeId, kind: s.kind, target: s.target };
      out.push({
        scope: account,
        label: `${s.target} on ${host} (every repository)`,
        group: host,
        forge: "forgejo",
      });
      for (const repo of s.repos)
        out.push({
          scope: { forgeId: c.forgeId, kind: "repo", target: repo },
          label: repo,
          group: host,
          forge: "forgejo",
          account,
        });
    }
  }
  return out;
}

/** Whether a scope belongs to a Forgejo connection. */
export function isForgejo(view: YardView, scope: Scope): boolean {
  return view.forgejo.connections.some((c) => c.forgeId === scope.forgeId);
}

export function scopeLabel(scope: Scope): string {
  if (scope.kind === "org") return `${scope.target} (organization)`;
  if (scope.kind === "user") return `${scope.target} (account)`;
  return scope.target;
}
