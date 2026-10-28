import type { GhJob, GhRunner } from "@runyard/core";
import { GithubError, type GithubHttp } from "./client.ts";

/** Ported from aarondfrancis/fleet's github.rs limits: a busy repository can't monopolize a poll. */
export const MAX_REPOS = 50;
const CONCURRENCY = 4;
const MAX_RUN_PAGES = 4;
const MAX_JOB_PAGES = 10;
const MAX_RUNNER_PAGES = 20;

type RawInstallation = {
  id: number;
  account: { login: string; type: string } | null;
  repository_selection: "all" | "selected";
  suspended_at: string | null;
};
type RawRunner = {
  id: number;
  name: string;
  os?: string;
  status: string;
  busy: boolean;
  labels?: { name: string }[];
  ephemeral?: boolean;
  version?: string;
};
type RawJob = {
  id: number;
  run_id: number;
  name: string;
  workflow_name?: string | null;
  status: string;
  labels?: string[];
  runner_id?: number | null;
  runner_name?: string | null;
  created_at: string;
  started_at?: string | null;
  html_url?: string | null;
  head_branch?: string | null;
};

export type Installation = {
  id: number;
  account: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
};

/** The app's installations (app JWT), skipping suspended ones. */
export async function listInstallations(http: GithubHttp): Promise<Installation[]> {
  const { items } = await http.collection<RawInstallation>("/app/installations", null, 100, 10);
  return items
    .filter((i) => !i.suspended_at && i.account)
    .map((i) => ({
      id: i.id,
      account: i.account!.login,
      accountType: i.account!.type === "Organization" ? "Organization" : "User",
      repositorySelection: i.repository_selection,
    }));
}

/** Repositories an installation can read, most recently pushed first, archived ones left out. */
export async function installationRepos(http: GithubHttp): Promise<string[]> {
  type Repo = { full_name: string; archived?: boolean; pushed_at?: string | null };
  const { items } = await http.collection<Repo>(
    "/installation/repositories",
    "repositories",
    100,
    10,
  );
  return items
    .filter((r) => !r.archived)
    .sort((a, b) => Date.parse(b.pushed_at ?? "0") - Date.parse(a.pushed_at ?? "0"))
    .map((r) => r.full_name);
}

export async function orgRunners(http: GithubHttp, org: string): Promise<GhRunner[]> {
  return runners(http, `/orgs/${encodeURIComponent(org)}/actions/runners`, org);
}

export async function repoRunners(http: GithubHttp, repo: string): Promise<GhRunner[]> {
  return runners(http, `/repos/${repoPath(repo)}/actions/runners`, repo);
}

async function runners(http: GithubHttp, path: string, owner: string): Promise<GhRunner[]> {
  const list = await http
    .collection<RawRunner>(path, "runners", 100, MAX_RUNNER_PAGES)
    .catch((error: unknown) => {
      if (error instanceof GithubError && (error.status === 403 || error.status === 404)) {
        throw new GithubError(
          `${error.message}. Listing ${owner}'s runners needs the app's "Self-hosted runners" (organization) or "Administration" (repository) permission.`,
          error.status,
        );
      }
      throw error;
    });
  if (list.truncated) {
    throw new GithubError(
      `Couldn't read all of ${owner}'s runners within ${MAX_RUNNER_PAGES} pages.`,
    );
  }
  return list.items.map((r) => ({
    id: r.id,
    name: r.name,
    os: r.os ?? "",
    status: r.status === "online" ? "online" : "offline",
    busy: r.busy,
    labels: (r.labels ?? []).map((l) => l.name),
    ephemeral: r.ephemeral ?? false,
    version: r.version ?? null,
  }));
}

/**
 * Queued and in-progress jobs in the given repositories (there's no
 * account-wide jobs endpoint). A repository the app can't read marks the
 * scan incomplete instead of hiding the others.
 */
export async function scanJobs(
  http: GithubHttp,
  repos: string[],
): Promise<{ jobs: GhJob[]; truncated: boolean }> {
  let truncated = repos.length > MAX_REPOS;
  const queue = repos.slice(0, MAX_REPOS);
  const jobs: GhJob[] = [];
  let failure: unknown;
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      try {
        const result = await repoJobs(http, repo);
        truncated ||= result.truncated;
        jobs.push(...result.jobs);
      } catch (error) {
        if (error instanceof GithubError && (error.status === 403 || error.status === 404))
          truncated = true;
        else failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  if (failure) throw failure;
  return { jobs: jobs.sort((a, b) => a.id - b.id), truncated };
}

async function repoJobs(http: GithubHttp, repo: string) {
  type Run = { id: number };
  const path = `/repos/${repoPath(repo)}/actions`;
  const active = await http.collection<Run>(
    `${path}/runs?status=in_progress`,
    "workflow_runs",
    50,
    MAX_RUN_PAGES,
  );
  const queued = await http.collection<Run>(
    `${path}/runs?status=queued`,
    "workflow_runs",
    50,
    MAX_RUN_PAGES,
  );
  let truncated = active.truncated || queued.truncated;
  const runIds = [...new Set([...active.items, ...queued.items].map((r) => r.id))].sort(
    (a, b) => a - b,
  );
  const jobs: GhJob[] = [];
  for (const runId of runIds) {
    const batch = await http.collection<RawJob>(
      `${path}/runs/${runId}/jobs?filter=latest`,
      "jobs",
      100,
      MAX_JOB_PAGES,
    );
    truncated ||= batch.truncated;
    for (const j of batch.items) {
      if (j.status !== "queued" && j.status !== "in_progress") continue;
      jobs.push({
        id: j.id,
        runId: j.run_id,
        repo,
        name: j.name,
        workflowName: j.workflow_name ?? null,
        status: j.status,
        labels: j.labels ?? [],
        runnerId: j.runner_id ?? null,
        runnerName: j.runner_name ?? null,
        createdAt: Date.parse(j.created_at),
        startedAt: j.started_at ? Date.parse(j.started_at) : null,
        htmlUrl: j.html_url ?? null,
        headBranch: j.head_branch ?? null,
      });
    }
  }
  return { jobs, truncated };
}

/** `owner/name` with each part encoded. */
function repoPath(repo: string) {
  return repo.split("/").map(encodeURIComponent).join("/");
}
