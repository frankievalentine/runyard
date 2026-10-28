import { expect, test } from "vite-plus/test";
import { deriveYard, deriveForgejo, type ForgejoConnectionObservation } from "../src/index.ts";

const user = { forgeId: "fj", kind: "user" as const, target: "frankie" };
const conn = (over: Partial<ForgejoConnectionObservation> = {}): ForgejoConnectionObservation => ({
  forgeId: "fj",
  baseUrl: "https://codeberg.org",
  login: "frankie",
  version: "16.0.0",
  error: null,
  scopes: [
    {
      scope: user,
      runners: {
        at: 1000,
        value: [
          {
            id: 1,
            uuid: "u1",
            name: "box-ci-01",
            status: "active",
            labels: ["docker", "ubuntu"],
            version: "13.2.0",
            ephemeral: false,
          },
          {
            id: 2,
            uuid: "u2",
            name: "box-ci-02",
            status: "idle",
            labels: ["docker", "ubuntu"],
            version: "13.2.0",
            ephemeral: false,
          },
          {
            id: 3,
            uuid: "u3",
            name: "old",
            status: "offline",
            labels: [],
            version: null,
            ephemeral: false,
          },
        ],
      },
      runnersError: null,
      jobs: {
        at: 1000,
        value: [
          {
            id: 7,
            runId: 70,
            repo: "frankie/site",
            name: "build",
            status: "waiting",
            runsOn: ["docker"],
          },
          {
            id: 8,
            runId: 71,
            repo: "frankie/site",
            name: "deploy",
            status: "running",
            runsOn: ["docker"],
          },
        ],
      },
      jobsError: null,
      publicRepos: [],
    },
  ],
  ...over,
});

test("runner activity from Forgejo's status string", () => {
  const view = deriveForgejo([conn()], 1000);
  expect(view.runners.map((r) => [r.name, r.activity, r.forge])).toEqual([
    ["box-ci-01", "busy", "forgejo"],
    ["box-ci-02", "idle", "forgejo"],
    ["old", "offline", "forgejo"],
  ]);
  expect(
    deriveForgejo([conn()], 1000 + 150_001).runners.every((r) => r.activity === "unknown"),
  ).toBe(true);
});

test("waiting jobs queue with the user's label-compatible runners", () => {
  const view = deriveForgejo([conn()], 1000);
  expect(view.queue.jobs.map((j) => [j.name, j.eligible])).toEqual([
    ["build", ["fj:user:frankie:1", "fj:user:frankie:2"]],
  ]);
});

test("the yard view merges both forges' runners, queue and counts", () => {
  const yard = deriveYard({
    machines: [],
    observations: new Map(),
    tailnet: { at: null, snapshot: null, error: null },
    ignoredNodeIds: new Set(),
    states: new Map(),
    forgejo: [conn()],
    now: 1000,
  });
  expect(yard.runners).toHaveLength(3);
  expect(yard.summary).toMatchObject({ runners: 3, busy: 1, idle: 1, offline: 1 });
  expect(yard.queue.jobs).toHaveLength(1);
  expect(yard.queue.complete).toBe(true);
});

test("an admin's assignment places a runner on a machine; a registration wins", () => {
  const base = {
    machines: [],
    observations: new Map(),
    tailnet: { at: null, snapshot: null, error: null },
    ignoredNodeIds: new Set<string>(),
    states: new Map(),
    forgejo: [conn()],
    now: 1000,
  };
  const scope = { forgeId: "fj", kind: "user" as const, target: "Frankie" };
  const yard = deriveYard({
    ...base,
    assignments: [{ scope, runnerName: "BOX-CI-01", machineId: "m1" }],
  });
  const box = yard.runners.find((r) => r.name === "box-ci-01")!;
  expect(box.machineId).toBe("m1");
  expect(yard.assignedRunners).toEqual([box.key]);
  const registered = deriveYard({
    ...base,
    assignments: [{ scope, runnerName: "box-ci-01", machineId: "m1" }],
    registrations: [
      {
        key: "k",
        machineId: "m2",
        runnerName: "box-ci-01",
        scope,
        path: "~/r",
        serviceMode: "systemd",
        runnerKind: "forgejo",
      },
    ],
  });
  expect(registered.runners.find((r) => r.name === "box-ci-01")?.machineId).toBe("m2");
  expect(registered.assignedRunners).toEqual([]);
});
