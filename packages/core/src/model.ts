/** A code forge Runyard registers runners with. */
export type ForgeKind = "github" | "forgejo";

/**
 * Where a runner registration lives. GitHub personal accounts have no
 * account-wide runners, so they only use `repo`; Forgejo supports every kind.
 */
export type ScopeKind = "instance" | "org" | "user" | "repo";

export type Scope = {
  forgeId: string;
  kind: ScopeKind;
  /** Owner login for `org`/`user`, `owner/name` for `repo`, empty for `instance`. */
  target: string;
};

/** The runner binary a registration needs on the machine. */
export type RunnerKind = "actions" | "forgejo";

export const runnerKindFor: Record<ForgeKind, RunnerKind> = {
  github: "actions",
  forgejo: "forgejo",
};
