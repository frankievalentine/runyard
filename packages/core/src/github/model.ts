import type { Timed } from "../machines/derive.ts";
import type { Scope } from "../model.ts";

/** A self-hosted runner as GitHub lists it. */
export type GhRunner = {
  id: number;
  name: string;
  os: string;
  status: "online" | "offline";
  busy: boolean;
  labels: string[];
  ephemeral: boolean;
  version: string | null;
};

/** A queued or running workflow job. */
export type GhJob = {
  id: number;
  runId: number;
  /** `owner/name`. */
  repo: string;
  name: string;
  workflowName: string | null;
  status: "queued" | "in_progress";
  labels: string[];
  runnerId: number | null;
  runnerName: string | null;
  createdAt: number;
  startedAt: number | null;
  htmlUrl: string | null;
  headBranch: string | null;
};

export type RateLimit = { limit: number; remaining: number; resetsAt: number | null };

/** One GitHub App installation: an organization, or a personal account with selected repositories. */
export type InstallationObservation = {
  id: number;
  account: string;
  accountType: "User" | "Organization";
  /** `all` or `selected`, as the installation grants. */
  repositorySelection: "all" | "selected";
  /** Repositories the installation can read, `owner/name`, most recently pushed first. */
  repos: string[];
  /**
   * The ones with an active Actions workflow, which are all Runyard polls: a
   * repository without one never queues a job. Null until checked, or when
   * GitHub won't say, and then every repository is polled.
   */
  ciRepos: string[] | null;
  runners: Timed<{ scope: Scope; runner: GhRunner }[]> | null;
  runnersError: Timed<string> | null;
  jobs: Timed<{ jobs: GhJob[]; reposScanned: string[]; truncated: boolean }> | null;
  jobsError: Timed<string> | null;
};

/** A GitHub App Runyard was set up with, and what it last read. */
export type GithubAppObservation = {
  forgeId: string;
  name: string;
  slug: string;
  /** The account that owns the app; only that account can install it. */
  owner: string;
  htmlUrl: string;
  installations: InstallationObservation[];
  error: string | null;
  rateLimit: RateLimit | null;
};

/** Ported from aarondfrancis/fleet's status rules. */
export const GITHUB_STALE_AFTER_MS = 150_000;
export const JOBS_STALE_AFTER_MS = 300_000;
