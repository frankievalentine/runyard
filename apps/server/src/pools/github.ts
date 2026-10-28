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
