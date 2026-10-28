import { scopeKey } from "@runyard/core";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, requireUser, type AppEnv } from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import { GithubError } from "../github/client.ts";
import { TEST_WORKFLOW } from "../pools/github.ts";
import { listRegistrations } from "../pools/store.ts";
import { TEST_WORKFLOW_YAML, TestJobError, type TestJobs } from "../pools/test-jobs.ts";
import { json } from "./validate.ts";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Test jobs: the workflow file to add, the latest result per runner, and starting one. */
export function testJobRoutes({ db, testJobs }: { db: Db; testJobs: TestJobs }) {
  return new Hono<AppEnv>()
    .get("/runner-tests", requireUser(), async (c) =>
      c.json({
        workflow: { path: `.github/workflows/${TEST_WORKFLOW}`, yaml: TEST_WORKFLOW_YAML },
        jobs: await testJobs.list(),
      }),
    )
    .post(
      "/runner-tests",
      requireAdmin(),
      json(
        z.object({
          scope: z.object({
            forgeId: z.string(),
            kind: z.enum(["user", "org", "repo"]),
            target: z.string(),
          }),
          runnerName: z.string().trim().min(1).max(64),
          repo: z.string().trim().regex(REPO, "Choose a repository as owner/name."),
          docker: z.boolean().default(false),
        }),
      ),
      async (c) => {
        const { scope, runnerName, repo, docker } = c.req.valid("json");
        const registered = listRegistrations(db).find(
          (r) =>
            scopeKey(r.scope) === scopeKey(scope) &&
            r.runnerName.toLowerCase() === runnerName.toLowerCase(),
        );
        if (!registered || registered.runnerKind !== "actions")
          return c.json(
            { error: "Only GitHub runners Runyard installed can run a test job." },
            400,
          );
        // The runner takes jobs only from repositories its scope covers.
        const serves =
          scope.kind === "org"
            ? repo.split("/")[0]!.toLowerCase() === scope.target.toLowerCase()
            : repo.toLowerCase() === scope.target.toLowerCase();
        if (!serves) return c.json({ error: `This runner doesn't take jobs from ${repo}.` }, 400);
        try {
          return c.json(await testJobs.start({ scope, runnerName, repo, docker }), 201);
        } catch (error) {
          if (error instanceof TestJobError)
            return c.json({ error: error.message, code: error.code }, 400);
          if (error instanceof GithubError) return c.json({ error: error.message }, 502);
          throw error;
        }
      },
    );
}
