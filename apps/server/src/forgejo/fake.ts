import { Hono, type Context } from "hono";
import type { Fetch } from "../github/client.ts";

type Runner = {
  id: number;
  uuid: string;
  name: string;
  status: string;
  labels: string[];
  version: string;
  ephemeral: boolean;
};
type Repo = { id: number; full_name: string; private: boolean; owner: { login: string } };
type Job = {
  id: number;
  run_id: number;
  repo_id: number;
  name: string;
  status: string;
  runs_on: string[];
};

/**
 * A stand-in for a Forgejo instance (shapes from Codeberg's API spec) and for
 * code.forgejo.org's forgejo-runner releases. Scopes are `user`, `org:<name>`
 * or `repo:<owner/name>`.
 */
export class FakeForgejo {
  version = "16.0.0+gitea-1.22.0";
  token = "fj_test_token_1234";
  login = "frankie";
  orgs: string[] = [];
  repos: Repo[] = [];
  runners = new Map<string, Runner[]>();
  jobs = new Map<string, Job[]>();
  /** Each repository's tasks, as `actions/tasks` answers, by full name. */
  tasks = new Map<string, Record<string, unknown>[]>();
  /** Runner tokens handed out at registration. */
  issued: { scope: string; name: string; token: string }[] = [];
  deleted: { scope: string; id: number }[] = [];
  private nextId = 1;
  /** While set, every request waits for it: lets a test hold a refresh mid-fetch. */
  gate: Promise<void> | null = null;
  readonly fetch: Fetch;

  constructor() {
    const app = this.routes();
    this.fetch = async (request) => {
      if (this.gate) await this.gate;
      return app.fetch(request);
    };
  }

  private routes() {
    const app = new Hono();
    app.get("/forgejo/runner/releases/download/:tag/:file", (c) => {
      const file = c.req.param("file");
      return file.endsWith(".sha256")
        ? c.text(`${"cd".repeat(32)}  ${file.replace(/\.sha256$/, "")}\n`)
        : c.body("binary");
    });
    app.get("/api/v1/repos/forgejo/runner/releases/latest", (c) =>
      c.json({
        tag_name: "v13.2.0",
        assets: ["amd64", "arm64"].flatMap((arch) =>
          ["", ".sha256"].map((ext) => ({
            name: `forgejo-runner-13.2.0-linux-${arch}${ext}`,
            browser_download_url: `https://code.forgejo.org/forgejo/runner/releases/download/v13.2.0/forgejo-runner-13.2.0-linux-${arch}${ext}`,
          })),
        ),
      }),
    );
    app.use("/api/v1/*", async (c, next) => {
      if (c.req.header("authorization") !== `token ${this.token}`)
        return c.json({ message: "token is required" }, 401);
      await next();
    });
    app.get("/api/v1/version", (c) => c.json({ version: this.version }));
    app.get("/api/v1/user", (c) => c.json({ login: this.login }));
    app.get("/api/v1/user/orgs", (c) =>
      this.page(
        c,
        this.orgs.map((username) => ({ username })),
      ),
    );
    app.get("/api/v1/user/repos", (c) => this.page(c, this.repos));
    app.get("/api/v1/repos/:owner/:repo/actions/tasks", (c) => {
      const tasks = this.tasks.get(`${c.req.param("owner")}/${c.req.param("repo")}`) ?? [];
      return c.json({ workflow_runs: tasks, total_count: tasks.length });
    });

    app.get("/api/v1/orgs/:org/repos", (c) =>
      this.page(
        c,
        this.repos.filter((r) => r.owner.login === c.req.param("org")),
      ),
    );
    const scoped = (prefix: string, scope: (c: Context) => string) => {
      app.get(`${prefix}/actions/runners/jobs`, (c) => c.json(this.jobs.get(scope(c)) ?? []));
      app.get(`${prefix}/actions/runners`, (c) => this.page(c, this.runners.get(scope(c)) ?? []));
      app.post(`${prefix}/actions/runners`, async (c) => {
        const { name } = (await c.req.json()) as { name: string };
        const runner: Runner = {
          id: this.nextId++,
          uuid: crypto.randomUUID(),
          name,
          status: "offline",
          labels: [],
          version: "",
          ephemeral: false,
        };
        this.runners.set(scope(c), [...(this.runners.get(scope(c)) ?? []), runner]);
        const token = `fjrt_${crypto.randomUUID().replace(/-/g, "")}`;
        this.issued.push({ scope: scope(c), name, token });
        return c.json({ id: runner.id, uuid: runner.uuid, token }, 201);
      });
      app.delete(`${prefix}/actions/runners/:id`, (c) => {
        const id = Number(c.req.param("id"));
        this.deleted.push({ scope: scope(c), id });
        this.runners.set(
          scope(c),
          (this.runners.get(scope(c)) ?? []).filter((r) => r.id !== id),
        );
        return c.body(null, 204);
      });
    };
    scoped("/api/v1/user", () => "user");
    scoped("/api/v1/orgs/:org", (c) => `org:${c.req.param("org")}`);
    scoped(
      "/api/v1/repos/:owner/:repo",
      (c) => `repo:${c.req.param("owner")}/${c.req.param("repo")}`,
    );
    return app;
  }

  private page(c: Context, items: unknown[]) {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json(items.slice((page - 1) * limit, page * limit));
  }
}
