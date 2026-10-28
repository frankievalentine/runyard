import type { ForgejoJob, ForgejoRunner, Scope } from "@runyard/core";
import type { Fetch } from "../github/client.ts";

/** Registration through `POST …/actions/runners` arrived in Forgejo 15. */
export const MIN_FORGEJO_MAJOR = 15;
const TIMEOUT_MS = 20_000;
const PAGE = 50;

export class ForgejoError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/** Whether a Forgejo version string (e.g. `16.0.0-dev…+gitea-1.22.0`) is new enough. */
export function supportedVersion(version: string): boolean {
  const major = Number(/^v?(\d+)\./.exec(version)?.[1]);
  return Number.isFinite(major) && major >= MIN_FORGEJO_MAJOR;
}

type RawRunner = {
  id: number;
  uuid: string;
  name: string;
  status: string;
  labels?: (string | { name: string })[] | null;
  version?: string;
  ephemeral?: boolean;
};
type RawJob = {
  id: number;
  run_id: number;
  repo_id: number;
  name: string;
  status: string;
  runs_on?: string[] | null;
};
export type ForgejoRepo = { id: number; fullName: string; private: boolean; owner: string };

/** Forgejo's REST API as one user, with an access token. */
export class ForgejoApi {
  constructor(
    private readonly fetch: Fetch,
    readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetch(
        new Request(`${this.baseUrl.replace(/\/$/, "")}/api/v1${path}`, {
          method,
          headers: {
            Accept: "application/json",
            Authorization: `token ${this.token}`,
            "User-Agent": "runyard",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );
    } catch (error) {
      throw new ForgejoError(
        `Couldn't reach ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // Not JSON.
      }
      if (res.status === 401)
        throw new ForgejoError(
          "Forgejo rejected the access token (401). It may have expired or been revoked.",
          401,
        );
      if (res.status === 403)
        throw new ForgejoError(
          `Forgejo refused access (403): ${message}. Check the token's scopes.`,
          403,
        );
      throw new ForgejoError(`Forgejo returned ${res.status}: ${message}`, res.status);
    }
    return res.status === 204 ? null : ((await res.json()) as unknown);
  }

  private async list<T>(path: string, maxPages = 20): Promise<T[]> {
    const items: T[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= maxPages; page++) {
      const batch = (await this.request("GET", `${path}${sep}page=${page}&limit=${PAGE}`)) as
        | T[]
        | null;
      items.push(...(batch ?? []));
      if (!batch || batch.length < PAGE) return items;
    }
    return items;
  }

  async version(): Promise<string> {
    return ((await this.request("GET", "/version")) as { version: string }).version;
  }

  async login(): Promise<string> {
    return ((await this.request("GET", "/user")) as { login: string }).login;
  }

  async orgs(): Promise<string[]> {
    return (await this.list<{ username: string }>("/user/orgs")).map((o) => o.username);
  }

  /** The account's own repositories (not ones it only collaborates on). */
  async repos(scope: Scope, login: string): Promise<ForgejoRepo[]> {
    const raw =
      scope.kind === "org"
        ? await this.list<{
            id: number;
            full_name: string;
            private: boolean;
            owner: { login: string };
          }>(`/orgs/${enc(scope.target)}/repos`)
        : await this.list<{
            id: number;
            full_name: string;
            private: boolean;
            owner: { login: string };
          }>("/user/repos");
    const owner = scope.kind === "org" ? scope.target : login;
    return raw
      .filter((r) => r.owner.login.toLowerCase() === owner.toLowerCase())
      .map((r) => ({ id: r.id, fullName: r.full_name, private: r.private, owner: r.owner.login }));
  }

  async runners(scope: Scope): Promise<ForgejoRunner[]> {
    const raw = await this.list<RawRunner>(runnersPath(scope));
    return raw.map((r) => ({
      id: r.id,
      uuid: r.uuid,
      name: r.name,
      status: r.status,
      // Strip any `:host` / `:docker://…` execution part to compare names.
      labels: (r.labels ?? []).map((l) => (typeof l === "string" ? l : l.name).split(":")[0]!),
      version: r.version ?? null,
      ephemeral: r.ephemeral ?? false,
    }));
  }

  /**
   * Creates the runner on Forgejo; the uuid and token go into the runner's own
   * config. An ephemeral runner takes one job and is removed.
   */
  async register(
    scope: Scope,
    name: string,
    ephemeral = false,
  ): Promise<{ id: number; uuid: string; token: string }> {
    return (await this.request("POST", runnersPath(scope), {
      name,
      description: "Managed by Runyard",
      ephemeral,
    })) as {
      id: number;
      uuid: string;
      token: string;
    };
  }

  async deleteRunner(scope: Scope, id: number) {
    await this.request("DELETE", `${runnersPath(scope)}/${id}`);
  }

  /** Jobs for the scope's runners: waiting, and running ones too. */
  async jobs(scope: Scope, repoNames: ReadonlyMap<number, string>): Promise<ForgejoJob[]> {
    const raw =
      ((await this.request("GET", `${runnersPath(scope)}/jobs`)) as RawJob[] | null) ?? [];
    return raw.map((j) => ({
      id: j.id,
      runId: j.run_id,
      repo: repoNames.get(j.repo_id) ?? `repository ${j.repo_id}`,
      name: j.name,
      status: j.status,
      runsOn: j.runs_on ?? [],
    }));
  }
}

function enc(value: string) {
  return encodeURIComponent(value);
}

export function runnersPath(scope: Scope): string {
  if (scope.kind === "user") return "/user/actions/runners";
  if (scope.kind === "org") return `/orgs/${enc(scope.target)}/actions/runners`;
  if (scope.kind === "repo")
    return `/repos/${scope.target.split("/").map(enc).join("/")}/actions/runners`;
  return "/admin/actions/runners";
}

/** The latest forgejo-runner Linux binary and its published SHA-256. */
export async function latestForgejoRunner(
  fetch: Fetch,
  arch: "amd64" | "arm64",
): Promise<{ url: string; name: string; sha256: string }> {
  const base = "https://code.forgejo.org";
  const res = await fetch(
    new Request(`${base}/api/v1/repos/forgejo/runner/releases/latest`, {
      headers: { "User-Agent": "runyard" },
    }),
  );
  if (!res.ok) throw new ForgejoError(`Couldn't read forgejo-runner releases (${res.status}).`);
  const release = (await res.json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  };
  const version = release.tag_name.replace(/^v/, "");
  const name = `forgejo-runner-${version}-linux-${arch}`;
  const binary = release.assets.find((a) => a.name === name);
  const checksum = release.assets.find((a) => a.name === `${name}.sha256`);
  if (!binary || !checksum)
    throw new ForgejoError(`The latest forgejo-runner release has no ${name}.`);
  const prefix = `${base}/forgejo/runner/releases/download/`;
  if (!binary.browser_download_url.startsWith(prefix))
    throw new ForgejoError(`Unexpected download location for ${name}.`);
  const sums = await fetch(
    new Request(checksum.browser_download_url, { headers: { "User-Agent": "runyard" } }),
  );
  const sha256 = /^([0-9a-f]{64})\s/.exec((await sums.text()).trim())?.[1];
  if (!sums.ok || !sha256) throw new ForgejoError(`Couldn't read ${name}'s SHA-256.`);
  return { url: binary.browser_download_url, name, sha256 };
}
