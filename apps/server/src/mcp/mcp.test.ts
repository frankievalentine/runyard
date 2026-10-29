import { describe, expect, test } from "bun:test";
import { createAccessToken } from "../auth/access-tokens.ts";
import { createUser } from "../auth/users.ts";
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
      "get_machine",
      "list_machines",
      "list_pools",
      "list_queued_jobs",
      "list_runners",
      "list_test_jobs",
      "machine_setup_command",
      "prepare_review",
      "save_pool",
      "start_test_job",
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
