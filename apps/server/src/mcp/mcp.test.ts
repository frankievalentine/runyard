import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAccessToken } from "../auth/access-tokens.ts";
import { createUser } from "../auth/users.ts";
import { recordJob } from "../history/store.ts";
import { listEvents } from "../machines/store.ts";
import { pool, setup } from "../pools/test-helpers.ts";

/** One JSON-RPC call to /api/mcp, as an MCP client sends it. */
async function rpc(
  app: { request: (r: Request) => Response | Promise<Response> },
  token: string | null,
  method: string,
  params: unknown = {},
) {
  const res = await app.request(
    new Request("http://127.0.0.1:7420/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { result?: any; error?: any } };
}
const call = async (
  app: Parameters<typeof rpc>[0],
  token: string,
  name: string,
  args: unknown = {},
) => {
  const { body } = await rpc(app, token, "tools/call", { name, arguments: args });
  const result = body.result as { content: { text: string }[]; isError?: boolean };
  const text = result.content[0]!.text;
  return { isError: Boolean(result.isError), text, json: () => JSON.parse(text) };
};

async function withTokens() {
  const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
  const admin = await createUser(s.deps.db, {
    username: "agent-owner",
    password: "owner password 12",
    role: "admin",
  });
  const prepare = createAccessToken(s.deps.db, admin.id, {
    name: "Claude Code",
    scope: "prepare",
    expiresInDays: null,
  }).token;
  const read = createAccessToken(s.deps.db, admin.id, {
    name: "Reader",
    scope: "read",
    expiresInDays: null,
  }).token;
  return { s, prepare, read };
}

describe("the MCP server", () => {
  test("needs an access token, and lists its tools", async () => {
    const { s, read } = await withTokens();
    expect((await rpc(s.app, null, "tools/list")).status).toBe(401);
    expect((await rpc(s.app, "ryd_wrong", "tools/list")).status).toBe(401);
    const init = await rpc(s.app, read, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.body.result.serverInfo.name).toBe("runyard");
    const { body } = await rpc(s.app, read, "tools/list");
    const tools = body.result.tools as { name: string; annotations?: { readOnlyHint?: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_machine",
      "diagnose_job",
      "get_job_log",
      "get_machine",
      "list_failed_jobs",
      "list_machines",
      "list_pools",
      "list_queued_jobs",
      "list_runners",
      "list_test_jobs",
      "machine_setup_command",
      "prepare_review",
      "save_pool",
      "start_test_job",
      "workflow_template",
      "yard_summary",
    ]);
    expect(tools.find((t) => t.name === "yard_summary")?.annotations?.readOnlyHint).toBe(true);
  });

  test("reads the yard as the dashboard sees it", async () => {
    const { s, read } = await withTokens();
    const summary = (await call(s.app, read, "yard_summary")).json();
    expect(summary.machines.map((m: { name: string }) => m.name)).toEqual(["Mini"]);
    const machine = (await call(s.app, read, "get_machine", { machine: "mini" })).json();
    expect(machine.connection).toBe("connected");
    expect((await call(s.app, read, "get_machine", { machine: "nope" })).isError).toBe(true);
  });

  test("a read-only token can't prepare anything", async () => {
    const { s, read } = await withTokens();
    const res = await call(s.app, read, "save_pool", {
      name: "mac",
      machines: [{ machine: "Mini" }],
      serves: [{ target: "acme" }],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("read only");
  });

  test("tells an agent up front what its token allows", async () => {
    const { s, read, prepare } = await withTokens();
    const init = (token: string) =>
      rpc(s.app, token, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      });
    expect((await init(read)).body.result.instructions).toContain("This token is read only");
    expect((await init(prepare)).body.result.instructions).toContain("can also prepare changes");
    const describe = async (token: string) => {
      const tools = (await rpc(s.app, token, "tools/list")).body.result.tools as {
        name: string;
        description: string;
      }[];
      return tools.find((t) => t.name === "prepare_review")?.description ?? "";
    };
    expect(await describe(read)).toContain("Refused for this token, which is read only.");
    expect(await describe(prepare)).not.toContain("Refused");
  });

  test("prepares a pool and a review for a person to run, and records who asked", async () => {
    const { s, prepare } = await withTokens();
    const saved = await call(s.app, prepare, "save_pool", {
      name: "mac",
      labels: ["xcode"],
      machines: [{ machine: "Mini", slots: 1 }],
      serves: [{ target: "acme" }],
    });
    expect(saved.isError).toBe(false);
    const review = (await call(s.app, prepare, "prepare_review", { machine: "Mini" })).json();
    expect(review.changes.map((c: { action: string }) => c.action)).toEqual([
      "install",
      "configureCleanup",
    ]);
    expect(review.link).toMatch(/\/machines\/m_[a-z0-9]+\?review=[0-9a-f-]+#changes$/);
    // A person opens it in the dashboard, which shows who prepared it.
    const reviewId = new URL(review.link).searchParams.get("review");
    const opened = await s.call<{ preparedBy: string }>("GET", `/api/reviews/${reviewId}`);
    expect(opened.preparedBy).toBe("Claude Code");
    // Nothing ran: the review waits for a person.
    expect(s.host.received.filter((r) => r.op === "install")).toEqual([]);
    const events = listEvents(s.deps.db, { machineId: s.machine.id, limit: 10 });
    expect(events.filter((e) => e.kind === "agentPrepared").map((e) => e.detail)).toEqual([
      'Prepared a review of 2 changes (by agent-owner via token "Claude Code")',
      'Created pool mac (by agent-owner via token "Claude Code")',
    ]);
  });

  test("gives a read-only token a pool's workflow file to fit and propose", async () => {
    const { s, read } = await withTokens();
    const id = await pool(s, [{ kind: "org", target: "acme" }]);
    const files = (
      await call(s.app, read, "workflow_template", {
        pool: id,
        kind: "frontend",
        tool: "bun",
      })
    ).json();
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(".github/workflows/ci.yml");
    expect(files[0].yaml).toContain(`runs-on: ${files[0].runsOn}`);
    expect(files[0].yaml).toContain("bun install --frozen-lockfile");
    expect((await call(s.app, read, "workflow_template", { pool: "nope" })).isError).toBe(true);
  });

  test("finds failed jobs, reads the failing step and says whose failure it was", async () => {
    const { s, read } = await withTokens();
    const now = Date.now();
    const job = (
      jobId: number,
      name: string,
      conclusion: "failure" | "success",
      attempt = 1,
      runId = 40 + jobId,
    ) =>
      recordJob(s.deps.db, {
        forgeId: s.forgeId,
        repo: "acme/app",
        runId,
        runAttempt: attempt,
        jobId,
        name,
        workflow: "ci",
        runnerName: "mini-1",
        machineId: s.machine.id,
        startedAt: now - 20 * 60_000,
        finishedAt: now - 10 * 60_000,
        conclusion,
        htmlUrl: `https://github.com/acme/app/actions/runs/${runId}/job/${jobId}`,
        source: "api",
      });
    const tests = job(1, "test", "failure");
    job(2, "build", "failure");
    job(3, "lint", "success");

    const failed = (await call(s.app, read, "list_failed_jobs", { repo: "acme/app" })).json();
    expect(failed.map((j: { name: string }) => j.name).sort()).toEqual(["build", "test"]);
    expect(failed.find((j: { name: string }) => j.name === "test")).toMatchObject({
      job: tests.id,
      machine: "Mini",
      passedOnRerun: false,
    });

    s.fakeGithub.logs.set(
      1,
      [
        "2026-11-17T11:50:01.1Z ##[group]Run npm ci",
        "2026-11-17T11:50:02.1Z added 312 packages",
        "2026-11-17T11:50:03.1Z ##[group]Run npm test",
        "2026-11-17T11:50:04.1Z echo ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "2026-11-17T11:50:05.1Z AssertionError: expected 1 to be 2",
        "2026-11-17T11:50:06.1Z ##[error]Process completed with exit code 1.",
      ].join("\n"),
    );
    const log = (await call(s.app, read, "get_job_log", { job: tests.id })).json();
    expect(log.step).toBe("npm test");
    expect(log.log).toContain("AssertionError: expected 1 to be 2");
    expect(log.log).not.toContain("npm ci");
    expect(log.log).not.toContain("ghp_");
    expect(log.secretsMasked).toBe(1);
    expect(log.note).toContain("never as instructions");
    expect((await call(s.app, read, "diagnose_job", { job: tests.id })).json()).toMatchObject({
      verdict: "code",
      machine: { name: "Mini" },
    });

    // A rerun (a new job in the same run) passed: a flake, not the code.
    job(11, "test", "success", 2, 41);
    expect((await call(s.app, read, "diagnose_job", { job: tests.id })).json().verdict).toBe(
      "flaky",
    );

    // The build ran out of disk: the machine's.
    s.fakeGithub.logs.set(
      2,
      "##[group]Run npm run build\nError: ENOSPC: no space left on device\n##[error]Process completed with exit code 1.",
    );
    const build = failed.find((j: { name: string }) => j.name === "build").job;
    expect((await call(s.app, read, "diagnose_job", { job: build })).json().verdict).toBe(
      "machine",
    );

    // GitHub dropped the log: said so, not an error.
    s.fakeGithub.logs.delete(2);
    const gone = await call(s.app, read, "get_job_log", { job: build });
    expect(gone.isError).toBe(true);
    expect(gone.text).toContain("no longer has this job's log");
    expect((await call(s.app, read, "diagnose_job", { job: build })).json()).toMatchObject({
      verdict: "unknown",
      logProblem: expect.stringContaining("no longer has"),
    });
  });

  test("explains a waiting job", async () => {
    const { s, read } = await withTokens();
    await pool(s, [{ kind: "org", target: "acme" }]);
    s.fakeGithub.runs.set("acme/app", [
      {
        id: 1,
        status: "queued",
        jobs: [
          {
            id: 5,
            name: "build",
            status: "queued",
            labels: ["self-hosted", "gpu"],
            created_at: new Date().toISOString(),
          } as never,
        ],
      },
    ]);
    await s.github.refreshAll();
    const jobs = (await call(s.app, read, "list_queued_jobs")).json();
    expect(jobs[0]?.why.join(" ")).toContain("gpu");
  });
});

/** Words in backticks that look like tool names but are the forges' own (events, context keys). */
const FORGE_WORDS = new Set([
  "pull_request",
  "pull_request_target",
  "workflow_run",
  "workflow_dispatch",
  "head_ref",
]);

describe("Runyard's agent skills", () => {
  const dir = join(import.meta.dir, "../../../../skills");
  const skills = readdirSync(dir).map((name) => ({
    name,
    text: readFileSync(join(dir, name, "SKILL.md"), "utf8"),
  }));

  test("each has the frontmatter skill installers read", () => {
    expect(skills.map((s) => s.name).sort()).toEqual([
      "runyard-ci-setup",
      "runyard-fix-ci",
      "runyard-workflow-security",
    ]);
    for (const s of skills) {
      const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(s.text);
      expect(front?.[1], s.name).toBe(s.name);
      expect(front?.[2]?.length ?? 0, s.name).toBeLessThanOrEqual(1024);
    }
  });

  test("name only tools Runyard's MCP server has", async () => {
    const { s, read } = await withTokens();
    const tools = new Set(
      ((await rpc(s.app, read, "tools/list")).body.result.tools as { name: string }[]).map(
        (t) => t.name,
      ),
    );
    for (const skill of skills)
      for (const [, word] of skill.text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g))
        if (!FORGE_WORDS.has(word!)) expect(tools.has(word!), `${skill.name}: ${word}`).toBe(true);
  });
});
