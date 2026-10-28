import type { RateLimit } from "@runyard/core";

/** Ported from fleet's github.rs: conditional requests, bounded pagination and readable errors. */
export const API_VERSION = "2022-11-28";
const MAX_CACHED_PAGES = 512;
const REQUEST_TIMEOUT_MS = 20_000;

export type Fetch = (request: Request) => Promise<Response>;

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

type Page = { body: unknown; hasNext: boolean };

/**
 * One authenticated view of the GitHub API. Every GET is conditional (ETag),
 * and a 304 doesn't count against the rate limit.
 */
export class GithubHttp {
  private cache = new Map<string, { etag: string; page: Page }>();
  rateLimit: RateLimit | null = null;

  constructor(
    private readonly fetch: Fetch,
    private readonly apiBase: string,
    private readonly token: () => Promise<string>,
  ) {}

  async get(path: string): Promise<Page> {
    const url = `${this.apiBase.replace(/\/$/, "")}${path}`;
    const cached = this.cache.get(url);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "runyard",
      Authorization: `Bearer ${await this.token()}`,
    };
    if (cached) headers["If-None-Match"] = cached.etag;
    let res: Response;
    try {
      res = await this.fetch(
        new Request(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
      );
    } catch (error) {
      throw new GithubError(
        `Couldn't reach GitHub: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.recordRate(res.headers);
    if (res.status === 304 && cached) {
      // Re-insert so the least recently used page is evicted first.
      this.cache.delete(url);
      this.cache.set(url, cached);
      return cached.page;
    }
    if (!res.ok) throw await errorFor(res, this.rateLimit);
    const page = { body: (await res.json()) as unknown, hasNext: hasNext(res.headers.get("link")) };
    const etag = res.headers.get("etag");
    if (etag) {
      this.cache.delete(url);
      this.cache.set(url, { etag, page });
      if (this.cache.size > MAX_CACHED_PAGES) this.cache.delete(this.cache.keys().next().value!);
    }
    return page;
  }

  /** Pages through a list in `field`; `truncated` when it didn't fit in `maxPages`. */
  async collection<T>(path: string, field: string | null, perPage: number, maxPages: number) {
    const items: T[] = [];
    const separator = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.get(`${path}${separator}per_page=${perPage}&page=${page}`);
      const body = res.body as Record<string, unknown>;
      const batch = (field ? body[field] : body) as T[] | undefined;
      if (!Array.isArray(batch))
        throw new GithubError(`Unexpected response from GitHub for ${path}.`);
      items.push(...batch);
      const total = field && typeof body.total_count === "number" ? body.total_count : null;
      const more =
        res.hasNext || (total === null ? batch.length === perPage : items.length < total);
      if (!more) return { items, truncated: false };
      // An empty page with an advertised continuation is incomplete too.
      if (batch.length === 0) return { items, truncated: true };
    }
    return { items, truncated: true };
  }

  private recordRate(headers: Headers) {
    const limit = Number(headers.get("x-ratelimit-limit"));
    const remaining = Number(headers.get("x-ratelimit-remaining"));
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (headers.has("x-ratelimit-limit") && Number.isFinite(limit) && Number.isFinite(remaining)) {
      this.rateLimit = {
        limit,
        remaining,
        resetsAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : null,
      };
    }
  }
}

function hasNext(link: string | null): boolean {
  return (link ?? "").split(",").some((part) => /;\s*rel="?[^"]*\bnext\b/.test(part));
}

async function errorFor(res: Response, rate: RateLimit | null): Promise<GithubError> {
  const text = await res.text().catch(() => "");
  let message = text;
  try {
    message = (JSON.parse(text) as { message?: string }).message ?? text;
  } catch {
    // Not JSON; keep the text.
  }
  if (res.status === 401) {
    return new GithubError(
      "GitHub rejected Runyard's credentials (401). The app's key may have been revoked.",
      401,
    );
  }
  if (
    (res.status === 403 || res.status === 429) &&
    res.headers.get("x-ratelimit-remaining") === "0"
  ) {
    const at = rate?.resetsAt ? new Date(rate.resetsAt).toLocaleTimeString() : "soon";
    return new GithubError(`GitHub's rate limit is used up; it resets at ${at}.`, res.status);
  }
  if (res.status === 403) return new GithubError(`GitHub refused access (403): ${message}`, 403);
  if (res.status === 404) return new GithubError(`Not found on GitHub (404): ${message}`, 404);
  return new GithubError(`GitHub returned ${res.status}: ${message}`, res.status);
}
