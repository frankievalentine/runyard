import { describe, expect, test } from "vite-plus/test";
import {
  deriveGithub,
  onDemandService,
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

test("links runners Runyard registered to their machines", () => {
  const view = deriveGithub([app([install()])], 1000, new Map([["gh:org:acme:mini-02", "m1"]]));
  expect(view.runners.map((r) => [r.name, r.machineId])).toEqual([
    ["mini-01", null],
    ["mini-02", "m1"],
    ["old", null],
  ]);
});

describe("on-demand runners and runners GitHub doesn't list", () => {
  const withJobs = (jobs: GhJob[]) =>
    install({ jobs: { at: 1000, value: { truncated: false, reposScanned: ["acme/app"], jobs } } });

  test("boat jobs are queued work that starts on demand, matched by exact label", () => {
    expect(onDemandService(["boat-large"])).toBe("boat");
    expect(onDemandService(["boats"])).toBeNull();
    const view = deriveGithub(
      [
        app([
          withJobs([
            job({ id: 201, labels: ["boat"] }),
            job({ id: 202, labels: ["ubuntu-latest"] }),
          ]),
        ]),
      ],
      1000,
    );
    expect(view.queue.jobs.map((j) => [j.id, j.onDemand, j.eligible])).toEqual([[201, "boat", []]]);
  });

  test("a running job on a runner GitHub doesn't list still shows, as an unlisted busy runner", () => {
    const view = deriveGithub(
      [
        app([
          withJobs([
            job({
              id: 301,
              status: "in_progress",
              labels: ["boat"],
              runnerId: 9001,
              runnerName: "boat-ci-x1",
              startedAt: 900,
            }),
            job({
              id: 302,
              status: "in_progress",
              labels: ["self-hosted", "gpu"],
              runnerId: 9002,
              runnerName: "elsewhere",
            }),
            // GitHub's own runners aren't this fleet's.
            job({
              id: 303,
              status: "in_progress",
              labels: ["ubuntu-latest"],
              runnerId: 9003,
              runnerName: "GitHub Actions 3",
            }),
            // Runs on a listed runner, so it isn't duplicated.
            job({ id: 304, status: "in_progress", runnerId: 1, runnerName: "mini-01" }),
          ]),
        ]),
      ],
      1000,
    );
    const unlisted = view.runners.filter((r) => !r.listed);
    expect(
      unlisted.map((r) => [r.name, r.onDemand, r.activity, r.ephemeral, r.job?.id, r.scope.kind]),
    ).toEqual([
      ["boat-ci-x1", "boat", "busy", true, 301, "repo"],
      ["elsewhere", null, "busy", false, 302, "repo"],
    ]);
    expect(view.runners.find((r) => r.name === "mini-01")).toMatchObject({
      listed: true,
      job: { id: 304 },
    });
    expect(view.summary.busy).toBe(3);
  });

  test("a listed runner with boat labels is marked as boat's", () => {
    const listed = install({
      runners: {
        at: 1000,
        value: [
          {
            scope: { forgeId: "gh", kind: "repo", target: "acme/app" },
            runner: runner({
              id: 9001,
              name: "boat-ci-x1",
              labels: ["boat"],
              ephemeral: true,
              busy: true,
            }),
          },
        ],
      },
      jobs: {
        at: 1000,
        value: {
          truncated: false,
          reposScanned: ["acme/app"],
          jobs: [
            job({
              id: 301,
              status: "in_progress",
              labels: ["boat"],
              runnerId: 9001,
              runnerName: "boat-ci-x1",
            }),
          ],
        },
      },
    });
    const view = deriveGithub([app([listed])], 1000);
    expect(view.runners.map((r) => [r.name, r.onDemand, r.listed, r.job?.id])).toEqual([
      ["boat-ci-x1", "boat", true, 301],
    ]);
  });
});
