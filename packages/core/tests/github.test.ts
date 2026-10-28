import { describe, expect, test } from "vite-plus/test";
import {
  deriveGithub,
  type GhJob,
  type GhRunner,
  type GithubAppObservation,
  type InstallationObservation,
} from "../src/index.ts";

const runner = (over: Partial<GhRunner> = {}): GhRunner => ({
  id: 1,
  name: "mini-01",
  os: "macOS",
  status: "online",
  busy: false,
  labels: ["self-hosted", "macOS", "ARM64", "xcode"],
  ephemeral: false,
  version: "2.329.0",
  ...over,
});

const job = (over: Partial<GhJob> = {}): GhJob => ({
  id: 100,
  runId: 10,
  repo: "acme/app",
  name: "build",
  workflowName: "CI",
  status: "queued",
  labels: ["self-hosted", "xcode"],
  runnerId: null,
  runnerName: null,
  createdAt: 50,
  startedAt: null,
  htmlUrl: null,
  headBranch: "main",
  ...over,
});

const install = (over: Partial<InstallationObservation> = {}): InstallationObservation => ({
  id: 7,
  account: "acme",
  accountType: "Organization",
  repositorySelection: "all",
  repos: ["acme/app", "acme/web"],
  runners: {
    at: 1000,
    value: [
      {
        scope: { forgeId: "gh", kind: "org", target: "acme" },
        runner: runner({ id: 1, busy: true }),
      },
      {
        scope: { forgeId: "gh", kind: "org", target: "acme" },
        runner: runner({ id: 2, name: "mini-02" }),
      },
      {
        scope: { forgeId: "gh", kind: "org", target: "acme" },
        runner: runner({ id: 3, name: "old", status: "offline" }),
      },
    ],
  },
  runnersError: null,
  jobs: {
    at: 1000,
    value: {
      truncated: false,
      reposScanned: ["acme/app"],
      jobs: [
        job({ id: 101, status: "in_progress", runnerId: 1, runnerName: "mini-01", startedAt: 900 }),
        job({ id: 102 }),
        job({ id: 103, labels: ["ubuntu-latest"] }),
      ],
    },
  },
  jobsError: null,
  ...over,
});

const app = (installations: InstallationObservation[]): GithubAppObservation => ({
  forgeId: "gh",
  name: "Runyard",
  slug: "runyard-x",
  owner: "acme",
  htmlUrl: "https://github.com/apps/runyard-x",
  installations,
  error: null,
  rateLimit: null,
});

describe("deriveGithub", () => {
  test("runner activity, the running job and fleet-wide counts", () => {
    const view = deriveGithub([app([install()])], 1000);
    expect(view.runners.map((r) => [r.name, r.activity])).toEqual([
      ["mini-01", "busy"],
      ["mini-02", "idle"],
      ["old", "offline"],
    ]);
    expect(view.runners[0]?.job).toMatchObject({ id: 101, repo: "acme/app" });
    expect(view.summary).toEqual({ runners: 3, busy: 1, idle: 1, offline: 1, unknown: 0 });
    expect(view.apps[0]?.installUrl).toBe("https://github.com/apps/runyard-x/installations/new");
  });

  test("queues only self-hosted jobs, with label-compatible online runners", () => {
    const view = deriveGithub([app([install()])], 1000);
    expect(view.queue.jobs.map((j) => j.id)).toEqual([102]);
    expect(view.queue.jobs[0]?.eligible).toEqual(["gh:org:acme:1", "gh:org:acme:2"]);
    expect(view.queue.complete).toBe(true);
  });

  test("stale runner data is unknown, and stale jobs make the queue incomplete", () => {
    const view = deriveGithub([app([install()])], 1000 + 150_001);
    expect(view.runners.every((r) => r.activity === "unknown")).toBe(true);
    expect(view.runners[0]?.job).toBeNull();
    const later = deriveGithub([app([install()])], 1000 + 300_001);
    expect(later.queue).toMatchObject({ jobs: [], complete: false });
  });

  test("a personal account's repo runners match jobs only in their own repository", () => {
    const repoScope = (target: string) => ({ forgeId: "gh", kind: "repo" as const, target });
    const view = deriveGithub(
      [
        app([
          install({
            account: "frankie",
            accountType: "User",
            repositorySelection: "selected",
            repos: ["frankie/app", "frankie/site"],
            runners: {
              at: 1000,
              value: [
                { scope: repoScope("frankie/app"), runner: runner({ id: 9, busy: true }) },
                { scope: repoScope("frankie/site"), runner: runner({ id: 9, busy: true }) },
              ],
            },
            jobs: {
              at: 1000,
              value: {
                truncated: false,
                reposScanned: ["frankie/app", "frankie/site"],
                jobs: [job({ repo: "frankie/app", status: "in_progress", runnerId: 9 })],
              },
            },
          }),
        ]),
      ],
      1000,
    );
    expect(view.runners.map((r) => [r.scopeLabel, r.job?.repo ?? null])).toEqual([
      ["frankie/app", "frankie/app"],
      ["frankie/site", null],
    ]);
  });

  test("an installation without runner data contributes no runners", () => {
    const view = deriveGithub([app([install({ runners: null, jobs: null })])], 1000);
    expect(view.runners).toEqual([]);
    expect(view.queue.complete).toBe(false);
  });
});
