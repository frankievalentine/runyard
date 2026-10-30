import type { Timed } from "../machines/derive.ts";
import type { Scope } from "../model.ts";

/** A runner as Forgejo's API lists it. */
export type ForgejoRunner = {
  id: number;
  uuid: string;
  name: string;
  /**
   * Forgejo reports one status string and no busy flag. Observed values are
   * `offline`, `idle` and `active` (running a task); anything else counts as
   * online. Confirm against the live instance.
   */
  status: string;
  /** Label names; Forgejo strips the `:host` / `:docker://…` execution part. */
  labels: string[];
  version: string | null;
  ephemeral: boolean;
};

/** A job from Forgejo's job search. Forgejo doesn't say which runner runs a job. */
export type ForgejoJob = {
  id: number;
  runId: number;
  /** `owner/name`, resolved from the repository ID when Runyard knows it. */
  repo: string;
  name: string;
  /** `waiting`, `running`, `blocked`, … */
  status: string;
  runsOn: string[];
};

/**
 * One scope a Forgejo connection watches: the user's account and its
 * organizations, and the single repositories pools serve.
 */
export type ForgejoScopeObservation = {
  scope: Scope;
  runners: Timed<ForgejoRunner[]> | null;
  runnersError: Timed<string> | null;
  jobs: Timed<ForgejoJob[]> | null;
  jobsError: Timed<string> | null;
  /** Public repositories the account owns; a runner at this scope would serve them. */
  publicRepos: string[] | null;
  /** An account's repositories, for pools that serve just one of them; empty for a repository. */
  repos?: string[] | null;
};

/** A Forgejo instance and user Runyard connects as. */
export type ForgejoConnectionObservation = {
  forgeId: string;
  /** The instance, e.g. `https://codeberg.org`. */
  baseUrl: string;
  login: string;
  version: string | null;
  error: string | null;
  scopes: ForgejoScopeObservation[];
};
