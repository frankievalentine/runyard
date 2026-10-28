import { describe, expect, test } from "bun:test";
import type { OperationView, Review } from "./engine.ts";
import type { TestJob } from "./test-jobs.ts";
import { finish, pool, setup, type Setup } from "./test-helpers.ts";

/** An installed organization runner, mini-mac-01, that Runyard registered. */
async function installed() {
  const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
  await pool(s, [{ kind: "org", target: "acme" }]);
  const review = await s.call<Review>("POST", `/api/machines/${s.machine.id}/review`);
  await finish(s, await s.call<OperationView>("POST", `/api/reviews/${review.id}/execute`, {}));
  return s;
}
const start = (s: Setup, over: Record<string, unknown> = {}) =>
  s.raw("POST", "/api/runner-tests", {
    scope: { forgeId: s.forgeId, kind: "org", target: "acme" },
    runnerName: "mini-mac-01",
    repo: "acme/app",
    ...over,
  });

describe("a runner's test job", () => {
  test("asks for the workflow file first, and shows it", async () => {
    const s = await installed();
    const res = await start(s);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "noWorkflow" });
    const { workflow } = await s.call<{ workflow: { path: string; yaml: string } }>(
      "GET",
      "/api/runner-tests",
    );
    expect(workflow.path).toBe(".github/workflows/runyard-runner-check.yml");
    expect(workflow.yaml).toContain('runs-on: [self-hosted, "${{ inputs.runner }}"]');
    expect(workflow.yaml).toContain("workflow_dispatch");
  });

  test("starts the workflow on exactly that runner and follows its run", async () => {
    const s = await installed();
    s.fakeGithub.testWorkflows.add("acme/app");
    const res = await start(s, { docker: true });
    expect(res.status).toBe(201);
    expect(s.fakeGithub.dispatches).toEqual([
      {
        repo: "acme/app",
        ref: "main",
        inputs: { runner: "runyard-runner-mini-mac-01", docker: "true" },
      },
    ]);
    const run = s.fakeGithub.workflowRuns.get("acme/app")![0]!;
    run.status = "completed";
    run.conclusion = "success";
    const { jobs } = await s.call<{ jobs: TestJob[] }>("GET", "/api/runner-tests");
    expect(jobs).toMatchObject([
      { runnerName: "mini-mac-01", status: "completed", conclusion: "success", url: run.html_url },
    ]);
  });

  test("refuses runners Runyard didn't install, other repositories, and explains a missing permission", async () => {
    const s = await installed();
    s.fakeGithub.testWorkflows.add("acme/app");
    expect((await start(s, { runnerName: "someone-else" })).status).toBe(400);
    expect(await (await start(s, { repo: "other/app" })).json()).toEqual({
      error: "This runner doesn't take jobs from other/app.",
    });
    s.fakeGithub.dispatchForbidden = true;
    const denied = await start(s);
    expect(await denied.json()).toMatchObject({ code: "permission" });
  });
});
