import { createPrivateKey, sign } from "node:crypto";
import { API_VERSION, GithubError, type Fetch } from "./client.ts";

/** Installation tokens last an hour; they're replaced this long before they expire. */
const TOKEN_MARGIN_MS = 5 * 60_000;

/**
 * GitHub App authentication: a short-lived JWT signed with the app's private
 * key, exchanged for installation tokens that are cached until near expiry.
 */
export class GithubAppAuth {
  private tokens = new Map<number, { token: string; expiresAt: number }>();
  private key: ReturnType<typeof createPrivateKey>;

  constructor(
    private readonly options: {
      appId: string;
      privateKey: string;
      apiBase: string;
      fetch: Fetch;
      now?: () => number;
    },
  ) {
    this.key = createPrivateKey(options.privateKey);
  }

  private get now() {
    return this.options.now?.() ?? Date.now();
  }

  /** A JWT for app-level endpoints, valid for nine minutes, backdated for clock drift. */
  jwt(): string {
    const iat = Math.floor(this.now / 1000) - 60;
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat, exp: iat + 600, iss: this.options.appId })}`;
    return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), this.key).toString("base64url")}`;
  }

  async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - TOKEN_MARGIN_MS > this.now) return cached.token;
    const res = await this.options.fetch(
      new Request(`${this.options.apiBase}/app/installations/${installationId}/access_tokens`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": "runyard",
          Authorization: `Bearer ${this.jwt()}`,
        },
      }),
    );
    if (!res.ok) {
      throw new GithubError(
        `GitHub wouldn't issue an installation token (${res.status}). Check that the app is still installed.`,
        res.status,
      );
    }
    const body = (await res.json()) as { token: string; expires_at: string };
    this.tokens.set(installationId, { token: body.token, expiresAt: Date.parse(body.expires_at) });
    return body.token;
  }

  forget(installationId: number) {
    this.tokens.delete(installationId);
  }
}
