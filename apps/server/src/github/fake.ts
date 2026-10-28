import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { Hono, type Context } from "hono";
import type { Fetch } from "./client.ts";

type Runner = {
  id: number;
  name: string;
  os: string;
  status: string;
  busy: boolean;
  labels: string[];
};
type Job = {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  labels: string[];
  runner_id?: number;
  runner_name?: string;
  created_at: string;
  started_at?: string;
};
type Installation = {
  id: number;
  account: string;
  type: "User" | "Organization";
  repos: string[];
  selection: "all" | "selected";
};

/**
 * A stand-in for GitHub's API with just the endpoints Runyard calls. Verifies
 * app JWTs with the app's real public key, issues installation tokens,
 * answers conditional requests with 304s, and converts manifests.
 */
export class FakeGithub {
  readonly appId = "424242";
  readonly privateKey: string;
  private readonly publicKey: string;
  installations: Installation[] = [];
  /** Runners by organization name or `owner/repo`. */
  runners = new Map<string, Runner[]>();
  /** The app's webhook, as Runyard last set it, and the events it subscribes to. */
  hook: { url: string; secret: string | null } = { url: "", secret: null };
  appEvents: string[] = [];
  /** Single-use runner configs handed out, and runners deleted through the API. */
  jitConfigs: { owner: string; name: string; labels: string[]; config: string; id: number }[] = [];
  deletedRunners: { owner: string; id: number }[] = [];
  /** Workflow runs by `owner/repo`, each with its jobs. */
  runs = new Map<string, { id: number; status: "queued" | "in_progress"; jobs: Job[] }[]>();
  tokens = new Map<string, number>();
  requests: string[] = [];
  /** Repositories GitHub reports as public. */
  publicRepos = new Set<string>();
  /** Organizations whose Default runner group admits public repositories. */
  openGroups = new Set<string>();
  /** Registration and removal tokens handed out, by scope (organization or `owner/repo`). */
  issued: { kind: "registration" | "remove"; owner: string; token: string }[] = [];
  /** Label updates, by `owner:runnerId`. */
  labelUpdates: { owner: string; runnerId: number; labels: string[] }[] = [];
  /** Answers a converted manifest with this owner. */
  manifestOwner = { login: "frankie", type: "User" };
  readonly fetch: Fetch;

  /** `privateKey` reuses an app key from an earlier run, as the demo does across restarts. */
  constructor(privateKey?: string) {
    if (privateKey) {
      this.privateKey = privateKey;
      this.publicKey = createPublicKey(privateKey)
        .export({ type: "spki", format: "pem" })
        .toString();
    } else {
      const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
      // GitHub hands out PKCS#1 keys ("BEGIN RSA PRIVATE KEY").
      this.privateKey = keys.privateKey.export({ type: "pkcs1", format: "pem" }).toString();
      this.publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    }
    const app = this.routes();
    this.fetch = async (request) => app.fetch(request);
  }

  private routes() {
    const app = new Hono();
    app.use(async (c, next) => {
      this.requests.push(
        `${c.req.method} ${new URL(c.req.url).pathname}${new URL(c.req.url).search}`,
      );
      await next();
    });
    app.post("/app-manifests/:code/conversions", (c) => {
      if (c.req.param("code") !== "good-code") return c.json({ message: "Not Found" }, 404);
      return c.json({
        id: Number(this.appId),
        slug: "runyard-test",
        name: "Runyard test",
        client_id: "Iv1.abc",
        client_secret: "client-secret",
        webhook_secret: "webhook-secret",
        pem: this.privateKey,
        html_url: "https://github.com/apps/runyard-test",
        owner: this.manifestOwner,
      });
    });
    app.post("/app/installations/:id/access_tokens", (c) => {
      if (!this.validJwt(c))
        return c.json({ message: "A JSON web token could not be decoded" }, 401);
      const id = Number(c.req.param("id"));
      if (!this.installations.some((i) => i.id === id))
        return c.json({ message: "Not Found" }, 404);
      const token = `ghs_${crypto.randomUUID()}`;
      this.tokens.set(token, id);
      return c.json({ token, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
    });
    app.get("/app", (c) => {
      if (!this.validJwt(c)) return c.json({ message: "Bad credentials" }, 401);
      return c.json({ id: Number(this.appId), slug: "runyard-fake", events: this.appEvents });
    });
    app.get("/app/hook/config", (c) => {
      if (!this.validJwt(c)) return c.json({ message: "Bad credentials" }, 401);
      return c.json({ url: this.hook.url, content_type: "json", insecure_ssl: "0" });
    });
    app.patch("/app/hook/config", async (c) => {
      if (!this.validJwt(c)) return c.json({ message: "Bad credentials" }, 401);
      const body = (await c.req.json()) as { url: string; secret: string; content_type: string };
      this.hook = { url: body.url, secret: body.secret };
      return c.json({ url: body.url, content_type: body.content_type, insecure_ssl: "0" });
    });
    app.get("/app/installations", (c) => {
      if (!this.validJwt(c)) return c.json({ message: "Bad credentials" }, 401);
      return this.page(
        c,
        this.installations.map((i) => ({
          id: i.id,
          account: { login: i.account, type: i.type },
          repository_selection: i.selection,
          suspended_at: null,
        })),
      );
    });
    app.get("/installation/repositories", (c) => {
      const inst = this.installationFor(c);
      if (!inst) return c.json({ message: "Bad credentials" }, 401);
      return this.page(c, {
        total_count: inst.repos.length,
        repositories: inst.repos.map((full_name, i) => ({
          full_name,
          archived: false,
          pushed_at: new Date(Date.now() - i * 60_000).toISOString(),
        })),
      });
    });
    app.get("/orgs/:org/actions/runners", (c) => this.runnerList(c, c.req.param("org")));
    for (const kind of ["registration", "remove"] as const) {
      const issue = (c: Context, owner: string) => {
        if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
        const token = `${kind === "registration" ? "AREG" : "AREM"}${crypto.randomUUID().replace(/-/g, "")}`;
        this.issued.push({ kind, owner, token });
        return c.json({ token, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
      };
      const suffix = kind === "registration" ? "registration-token" : "remove-token";
      app.post(`/orgs/:org/actions/runners/${suffix}`, (c) => issue(c, c.req.param("org")));
      app.post(`/repos/:owner/:repo/actions/runners/${suffix}`, (c) =>
        issue(c, `${c.req.param("owner")}/${c.req.param("repo")}`),
      );
    }
    // Single-use runners: registered at once (offline until they connect), like GitHub does.
    const jit = async (c: Context, owner: string) => {
      if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
      const { name, labels } = (await c.req.json()) as { name: string; labels: string[] };
      const id = 50_000 + this.jitConfigs.length;
      const config = `JIT${crypto.randomUUID().replace(/-/g, "")}`;
      this.jitConfigs.push({ owner, name, labels, config, id });
      this.runners.set(owner, [
        ...(this.runners.get(owner) ?? []),
        { id, name, os: "macOS", status: "offline", busy: false, labels },
      ]);
      return c.json({ runner: { id, name }, encoded_jit_config: config }, 201);
    };
    app.post("/orgs/:org/actions/runners/generate-jitconfig", (c) => jit(c, c.req.param("org")));
    app.post("/repos/:owner/:repo/actions/runners/generate-jitconfig", (c) =>
      jit(c, `${c.req.param("owner")}/${c.req.param("repo")}`),
    );
    const removeRunner = (c: Context, owner: string) => {
      if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
      const id = Number(c.req.param("id"));
      this.deletedRunners.push({ owner, id });
      this.runners.set(
        owner,
        (this.runners.get(owner) ?? []).filter((r) => r.id !== id),
      );
      return c.body(null, 204);
    };
    app.delete("/orgs/:org/actions/runners/:id", (c) => removeRunner(c, c.req.param("org")));
    app.delete("/repos/:owner/:repo/actions/runners/:id", (c) =>
      removeRunner(c, `${c.req.param("owner")}/${c.req.param("repo")}`),
    );
    const putLabels = async (c: Context, owner: string) => {
      if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
      const { labels } = (await c.req.json()) as { labels: string[] };
      const runnerId = Number(c.req.param("id"));
      this.labelUpdates.push({ owner, runnerId, labels });
      const runner = (this.runners.get(owner) ?? []).find((r) => r.id === runnerId);
      if (runner)
        runner.labels = [
          ...runner.labels.filter((l) =>
            ["self-hosted", "macOS", "Linux", "Windows", "X64", "ARM64"].includes(l),
          ),
          ...labels,
        ];
      return c.json({ total_count: labels.length, labels: labels.map((name) => ({ name })) });
    };
    app.put("/orgs/:org/actions/runners/:id/labels", (c) => putLabels(c, c.req.param("org")));
    app.put("/repos/:owner/:repo/actions/runners/:id/labels", (c) =>
      putLabels(c, `${c.req.param("owner")}/${c.req.param("repo")}`),
    );
    app.get("/orgs/:org/actions/runner-groups", (c) => {
      if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
      const groups = [
        {
          id: 1,
          name: "Default",
          default: true,
          allows_public_repositories: this.openGroups.has(c.req.param("org")),
        },
      ];
      return this.page(c, { total_count: 1, runner_groups: groups });
    });
    app.get("/repos/actions/runner/releases/latest", (c) =>
      this.page(c, {
        tag_name: "v2.329.0",
        assets: ["osx-arm64", "osx-x64", "linux-x64", "linux-arm64", "win-x64"].map((p) => {
          const name = `actions-runner-${p}-2.329.0.${p.startsWith("win") ? "zip" : "tar.gz"}`;
          return {
            name,
            browser_download_url: `https://github.com/actions/runner/releases/download/v2.329.0/${name}`,
            digest: `sha256:${"ab".repeat(32)}`,
          };
        }),
      }),
    );
    app.get("/repos/:owner/:repo/actions/runners", (c) =>
      this.runnerList(c, `${c.req.param("owner")}/${c.req.param("repo")}`),
    );
    app.get("/repos/:owner/:repo", (c) => {
      if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
      const full = `${c.req.param("owner")}/${c.req.param("repo")}`;
      const isPublic = this.publicRepos.has(full);
      return this.page(c, {
        full_name: full,
        private: !isPublic,
        visibility: isPublic ? "public" : "private",
      });
    });
    app.get("/repos/:owner/:repo/actions/runs", (c) => {
      if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
      const runs = (this.runs.get(`${c.req.param("owner")}/${c.req.param("repo")}`) ?? []).filter(
        (r) => r.status === c.req.query("status"),
      );
      return this.page(c, {
        total_count: runs.length,
        workflow_runs: runs.map((r) => ({ id: r.id })),
      });
    });
    app.get("/repos/:owner/:repo/actions/runs/:run/jobs", (c) => {
      if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
      const repo = `${c.req.param("owner")}/${c.req.param("repo")}`;
      const run = (this.runs.get(repo) ?? []).find((r) => r.id === Number(c.req.param("run")));
      const jobs = (run?.jobs ?? []).map((j) => ({
        ...j,
        run_id: run!.id,
        workflow_name: "CI",
        html_url: null,
        head_branch: "main",
      }));
      return this.page(c, { total_count: jobs.length, jobs });
    });
    return app;
  }

  private runnerList(c: Context, owner: string) {
    if (!this.installationFor(c)) return c.json({ message: "Bad credentials" }, 401);
    const runners = (this.runners.get(owner) ?? []).map((r) => ({
      ...r,
      labels: r.labels.map((name) => ({ name })),
    }));
    return this.page(c, { total_count: runners.length, runners });
  }

  /** A JSON page with an ETag and rate-limit headers; a matching If-None-Match gets a 304. */
  private page(c: Context, body: unknown) {
    const text = JSON.stringify(body);
    const etag = `"${Bun.hash(text).toString(16)}"`;
    c.header("x-ratelimit-limit", "5000");
    c.header("x-ratelimit-remaining", "4990");
    c.header("x-ratelimit-reset", String(Math.floor(Date.now() / 1000) + 3600));
    c.header("etag", etag);
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    return c.body(text, 200, { "content-type": "application/json" });
  }

  private installationFor(c: Context) {
    const token = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    const id = this.tokens.get(token);
    return this.installations.find((i) => i.id === id);
  }

  private validJwt(c: Context): boolean {
    const jwt = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    const [header, payload, signature] = jwt.split(".");
    if (!header || !payload || !signature) return false;
    const ok = verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey(this.publicKey),
      Buffer.from(signature, "base64url"),
    );
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      iss: string;
      exp: number;
    };
    return ok && claims.iss === this.appId && claims.exp * 1000 > Date.now();
  }
}
