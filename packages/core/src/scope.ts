import type { Scope, ScopeKind } from "./model.ts";

/**
 * Stable identity for a scope, used as a map key and in persisted references.
 * Logins are case-insensitive on both forges, so the target is lowercased.
 */
export function scopeKey(scope: Scope): string {
  return `${scope.forgeId}:${scope.kind}:${scope.target.toLowerCase()}`;
}

const validTarget: Record<ScopeKind, RegExp> = {
  instance: /^$/,
  org: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  user: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  repo: /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/,
};

export function isValidScopeTarget(kind: ScopeKind, target: string): boolean {
  return validTarget[kind].test(target);
}
