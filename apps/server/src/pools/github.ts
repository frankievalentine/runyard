import type { Scope } from "@runyard/core";
import { GithubError, type GithubHttp } from "../github/client.ts";

/** Runner endpoints for an organization or a repository. */
function runnersPath(scope: Scope): string {
  if (scope.kind === "org") return `/orgs/${encodeURIComponent(scope.target)}/actions/runners`;
  if (scope.kind === "repo")
    return `/repos/${scope.target.split("/").map(encodeURIComponent).join("/")}/actions/runners`;
  throw new GithubError(`GitHub has no ${scope.kind} runners.`);
}

/** The URL a runner registers against. */
export function registrationUrl(webBase: string, scope: Scope): string {
  return `${webBase.replace(/\/$/, "")}/${scope.target}`;
}

/** A one-hour registration token, minted only at the moment of use. */
export async function registrationToken(http: GithubHttp, scope: Scope): Promise<string> {
  const body = (await http.send("POST", `${runnersPath(scope)}/registration-token`)) as {
    token: string;
  };
  return body.token;
}

export async function removalToken(http: GithubHttp, scope: Scope): Promise<string> {
  const body = (await http.send("POST", `${runnersPath(scope)}/remove-token`)) as { token: string };
  return body.token;
}

/** Replaces a runner's custom labels; GitHub keeps its own (self-hosted, OS, architecture). */
export async function setLabels(
  http: GithubHttp,
  scope: Scope,
  runnerId: number,
  labels: string[],
) {
  await http.send("PUT", `${runnersPath(scope)}/${runnerId}/labels`, { labels });
}

/** Whether a repository is private (or internal). Public ones need the person's explicit override. */
export async function repoIsPrivate(http: GithubHttp, repo: string): Promise<boolean> {
  const { body } = await http.get(`/repos/${repo.split("/").map(encodeURIComponent).join("/")}`);
  const r = body as { private?: boolean; visibility?: string };
  return r.private === true || r.visibility === "internal";
}

/**
 * Whether runners registered without a group (they join Default) are kept from
 * public repositories. Free organizations only have Default, so that's the
 * group checked rather than requiring a custom one.
 */
export async function defaultGroupAllowsPublic(http: GithubHttp, org: string): Promise<boolean> {
  type Group = { default: boolean; allows_public_repositories: boolean };
  const { items } = await http.collection<Group>(
    `/orgs/${encodeURIComponent(org)}/actions/runner-groups`,
    "runner_groups",
    100,
    5,
  );
  const group = items.find((g) => g.default);
  if (!group) throw new GithubError(`${org} has no default runner group.`);
  return group.allows_public_repositories;
}

export type RunnerAsset = { url: string; name: string; sha256: string | null };

/** GitHub's platform names for the runner archive. */
export function runnerPlatform(
  os: "macos" | "linux" | "windows",
  architecture: string | null,
): string | null {
  const arch = (architecture ?? "").toLowerCase();
  const cpu = /arm64|aarch64/.test(arch)
    ? "arm64"
    : /x86_64|amd64|x64/.test(arch)
      ? "x64"
      : /armv7|arm$/.test(arch)
        ? "arm"
        : null;
  if (!cpu) return null;
  if (os === "macos") return cpu === "arm" ? null : `osx-${cpu}`;
  if (os === "windows") return cpu === "arm" ? null : `win-${cpu}`;
  return `linux-${cpu}`;
}

/** The latest actions/runner release asset for a platform, with GitHub's published SHA-256 when present. */
export async function latestRunnerAsset(http: GithubHttp, platform: string): Promise<RunnerAsset> {
  type Release = {
    tag_name: string;
    assets: { name: string; browser_download_url: string; digest?: string | null }[];
  };
  const { body } = await http.get("/repos/actions/runner/releases/latest");
  const release = body as Release;
  const version = release.tag_name.replace(/^v/, "");
  const name = `actions-runner-${platform}-${version}.${platform.startsWith("win-") ? "zip" : "tar.gz"}`;
  const asset = release.assets.find((a) => a.name === name);
  if (!asset) throw new GithubError(`The latest runner release has no ${name}.`);
  if (
    !asset.browser_download_url.startsWith("https://github.com/actions/runner/releases/download/")
  ) {
    throw new GithubError(`Unexpected download location for ${name}.`);
  }
  const digest = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null;
  return { url: asset.browser_download_url, name, sha256: digest };
}

/**
 * The repository's policy for running workflows from fork pull requests, or
 * null when GitHub won't say (older API, or a permission Runyard lacks).
 */
export async function forkApprovalPolicy(http: GithubHttp, repo: string): Promise<string | null> {
  try {
    const { body } = await http.get(
      `/repos/${repo.split("/").map(encodeURIComponent).join("/")}/actions/permissions/fork-pr-contributor-approval`,
    );
    return (body as { approval_policy?: string }).approval_policy ?? null;
  } catch {
    return null;
  }
}

/**
 * A single-use runner registration: the runner takes one job and GitHub
 * removes it. Runner group 1 is the Default group, as for persistent runners.
 */
export async function jitConfig(
  http: GithubHttp,
  scope: Scope,
  name: string,
  labels: string[],
): Promise<{ runnerId: number; config: string }> {
  const body = (await http.send("POST", `${runnersPath(scope)}/generate-jitconfig`, {
    name,
    runner_group_id: 1,
    labels,
    work_folder: "_work",
  })) as { runner: { id: number }; encoded_jit_config: string };
  return { runnerId: body.runner.id, config: body.encoded_jit_config };
}

export async function deleteRunner(http: GithubHttp, scope: Scope, runnerId: number) {
  await http.send("DELETE", `${runnersPath(scope)}/${runnerId}`);
}

/** The workflow a runner's test job runs, at this path in a repository the user picks. */
export const TEST_WORKFLOW = "runyard-runner-check.yml";

const repoPath = (repo: string) => `/repos/${repo.split("/").map(encodeURIComponent).join("/")}`;

/** Whether the repository has the test workflow; false on 404. */
export async function hasTestWorkflow(http: GithubHttp, repo: string): Promise<boolean> {
  try {
    await http.get(`${repoPath(repo)}/actions/workflows/${TEST_WORKFLOW}`);
    return true;
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return false;
    throw error;
  }
}

export async function defaultBranch(http: GithubHttp, repo: string): Promise<string> {
  const { body } = await http.get(repoPath(repo));
  return (body as { default_branch?: string }).default_branch ?? "main";
}

/** Starts the test workflow for one runner, by its own label. */
export async function dispatchTestWorkflow(
  http: GithubHttp,
  repo: string,
  ref: string,
  inputs: { runner: string; docker: boolean },
) {
  await http.send("POST", `${repoPath(repo)}/actions/workflows/${TEST_WORKFLOW}/dispatches`, {
    ref,
    inputs: { runner: inputs.runner, docker: String(inputs.docker) },
  });
}

export type WorkflowRun = {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  display_title: string;
  created_at: string;
};

/** The test workflow's recent manual runs, newest first. */
export async function testWorkflowRuns(http: GithubHttp, repo: string): Promise<WorkflowRun[]> {
  const { body } = await http.get(
    `${repoPath(repo)}/actions/workflows/${TEST_WORKFLOW}/runs?event=workflow_dispatch&per_page=20`,
  );
  return (body as { workflow_runs?: WorkflowRun[] }).workflow_runs ?? [];
}
