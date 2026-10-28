import { runnerLabel, scopeKey, type Scope } from "@runyard/core";
import { GithubError } from "../github/client.ts";
import type { GithubMonitor } from "../github/monitor.ts";
import {
  defaultBranch,
  dispatchTestWorkflow,
  hasTestWorkflow,
  TEST_WORKFLOW,
  testWorkflowRuns,
} from "./github.ts";

/** The workflow file a user adds to a repository so Runyard can test its runners. */
export const TEST_WORKFLOW_YAML = `# Added for Runyard: runs a short check on one runner, chosen by its own label.
name: Runyard runner check
run-name: Runyard runner check on \${{ inputs.runner }}
on:
  workflow_dispatch:
    inputs:
      runner:
        description: The runner's label (runyard-runner-...)
        required: true
      docker:
        description: Also run a container
        type: boolean
        default: false
permissions:
  contents: read
jobs:
  check:
    runs-on: [self-hosted, "\${{ inputs.runner }}"]
    timeout-minutes: 15
    defaults:
      run:
        shell: bash
    steps:
      - uses: actions/checkout@v4
      - name: Tools
        run: |
          uname -a
          git --version
          command -v cc && cc --version | head -n 1 || echo "No C compiler"
      - name: Build and run a program
        run: |
          if command -v cc >/dev/null; then
            printf 'int main(void) { return 0; }\\n' > runyard-check.c
            cc runyard-check.c -o runyard-check && ./runyard-check && echo "Compiled and ran a program"
          else
            echo "Skipped: no C compiler"
          fi
      - name: Docker
        if: \${{ inputs.docker }}
        run: docker run --rm hello-world
`;

export type TestJob = {
  id: string;
  scope: Scope;
  runnerName: string;
  repo: string;
  docker: boolean;
  startedAt: number;
  /** queued and in_progress, then completed with GitHub's conclusion. */
  status: "dispatched" | "queued" | "in_progress" | "completed";
  conclusion: string | null;
  url: string | null;
};

export class TestJobError extends Error {
  constructor(
    message: string,
    /** `noWorkflow`: the repository lacks the workflow file; `permission`: the app can't start workflows. */
    readonly code: "noWorkflow" | "permission" | "other" = "other",
  ) {
    super(message);
  }
}

/** How long to look for a dispatched run before giving up on finding it. */
const FIND_RUN_MS = 10 * 60_000;
/** GitHub is asked about pending runs at most this often. */
const REFRESH_MS = 5_000;

/**
 * Test jobs for Runyard's GitHub runners: starts the user's test workflow on
 * one runner (by its own label), then follows the run it started. Kept in
 * memory: the latest per runner, as a guide; GitHub has the full history.
 */
export class TestJobs {
  private jobs = new Map<string, TestJob>();
  private refreshedAt = 0;

  constructor(private readonly deps: { github: GithubMonitor; now?: () => number }) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private http(scope: Scope) {
    const http = this.deps.github.clientFor(scope);
    if (!http) throw new TestJobError("The GitHub App for this runner isn't usable right now.");
    return http;
  }

  async start(input: { scope: Scope; runnerName: string; repo: string; docker: boolean }) {
    const http = this.http(input.scope);
    try {
      if (!(await hasTestWorkflow(http, input.repo)))
        throw new TestJobError(
          `${input.repo} has no .github/workflows/${TEST_WORKFLOW} on its default branch yet.`,
          "noWorkflow",
        );
      const ref = await defaultBranch(http, input.repo);
      await dispatchTestWorkflow(http, input.repo, ref, {
        runner: runnerLabel(input.runnerName),
        docker: input.docker,
      });
    } catch (error) {
      if (error instanceof GithubError && error.status === 403)
        throw new TestJobError(
          "The GitHub App can't start workflows yet. In the app's settings on GitHub, set Actions to Read and write, then accept the change on its installation.",
          "permission",
        );
      throw error;
    }
    const job: TestJob = {
      id: crypto.randomUUID(),
      ...input,
      startedAt: this.now(),
      status: "dispatched",
      conclusion: null,
      url: null,
    };
    this.jobs.set(key(input.scope, input.runnerName), job);
    return job;
  }

  /** The latest test job of each runner, with pending ones refreshed from GitHub. */
  async list(): Promise<TestJob[]> {
    if (this.now() - this.refreshedAt >= REFRESH_MS) {
      this.refreshedAt = this.now();
      await this.refresh().catch(() => undefined);
    }
    return [...this.jobs.values()];
  }

  private async refresh() {
    for (const job of this.jobs.values()) {
      if (job.status === "completed") continue;
      const runs = await testWorkflowRuns(this.http(job.scope), job.repo);
      const label = runnerLabel(job.runnerName);
      // The run GitHub made for this dispatch: titled with the runner's label, created after it.
      const run = runs.find(
        (r) =>
          r.display_title.endsWith(` ${label}`) &&
          Date.parse(r.created_at) >= job.startedAt - 60_000,
      );
      if (!run) {
        if (this.now() - job.startedAt > FIND_RUN_MS) {
          job.status = "completed";
          job.conclusion = "not_found";
        }
        continue;
      }
      job.url = run.html_url;
      job.status =
        run.status === "completed"
          ? "completed"
          : run.status === "in_progress"
            ? "in_progress"
            : "queued";
      job.conclusion = run.conclusion;
    }
  }
}

const key = (scope: Scope, name: string) => `${scopeKey(scope)}:${name.toLowerCase()}`;
