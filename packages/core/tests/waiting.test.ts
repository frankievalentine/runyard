import { expect, test } from "vite-plus/test";
import { waitingReasons, type Pool, type QueuedJobView, type YardView } from "../src/index.ts";

const job = (labels: string[], eligible: string[] = []): QueuedJobView =>
  ({
    id: 1,
    forge: "github",
    repo: "acme/app",
    name: "build",
    labels,
    onDemand: null,
    eligible,
  }) as QueuedJobView;
const org = { forgeId: "gh", kind: "org" as const, target: "acme" };
const runner = (name: string, labels: string[], activity = "idle") => ({
  key: name,
  name,
  forge: "github",
  scope: org,
  labels: ["self-hosted", "Linux", ...labels],
  activity,
});
const pool = (over: Partial<Pool>): Pool => ({
  id: "p1",
  name: "gpu",
  labels: ["gpu"],
  machines: [{ machineId: "m1", slots: 1 }],
  scopes: [org],
  forgejoMode: { kind: "host" },
  mode: "persistent",
  paused: false,
  toolProfiles: [],
  cleanup: "off",
  ...over,
});
const view = (over: {
  runners?: unknown[];
  pools?: Pool[];
  desired?: unknown[];
  templateRecords?: unknown[];
  dispatches?: unknown[];
  queueAt?: number | null;
}) =>
  ({
    runners: over.runners ?? [],
    machines: [
      {
        id: "m1",
        name: "Builder",
        os: "linux",
        readiness: null,
        connection: { state: "connected" },
      },
    ],
    queue: { jobs: [], complete: true, at: over.queueAt ?? null },
    github: { apps: [{ forgeId: "gh" }] },
    forgejo: { connections: [] },
    pools: {
      pools: over.pools ?? [],
      desired: over.desired ?? [],
      templateRecords: over.templateRecords ?? [],
      dispatches: over.dispatches ?? [],
    },
  }) as unknown as YardView;

test("nothing serves the repository", () => {
  expect(waitingReasons(job(["self-hosted", "gpu"]), view({}))).toEqual([
    "No runner takes jobs from acme/app.",
    "No pool serves acme/app; create one to give it runners.",
  ]);
});

test("runners and pools that lack a label say which", () => {
  const v = view({
    runners: [runner("linux-01", ["docker"])],
    pools: [pool({ labels: ["docker"] })],
  });
  expect(waitingReasons(job(["self-hosted", "linux", "gpu"]), v)).toEqual([
    "No runner for acme/app has gpu.",
    "Pool gpu serves acme/app but doesn't have gpu.",
  ]);
});

test("busy, offline and not yet installed", () => {
  const busy = view({ runners: [runner("gpu-01", ["gpu"], "busy")] });
  expect(waitingReasons(job(["gpu"], ["gpu-01"]), busy)).toEqual([
    "Every runner that matches is busy (gpu-01).",
  ]);
  const offline = view({ runners: [runner("gpu-01", ["gpu"], "offline")] });
  expect(waitingReasons(job(["gpu"]), offline)[0]).toBe(
    "The runners that match are offline: gpu-01.",
  );
  const uninstalled = view({
    pools: [pool({})],
    desired: [{ poolId: "p1", machineId: "m1", scope: org, name: "builder-gpu-01" }],
  });
  expect(waitingReasons(job(["self-hosted", "linux", "gpu"]), uninstalled)[1]).toBe(
    "Pool gpu's runners aren't installed yet; review Builder to install them.",
  );
});

test("on-demand pools: paused, not installed, or about to start one", () => {
  const onDemand = (over: Partial<Pool>, templates: unknown[] = []) =>
    waitingReasons(
      job(["gpu"]),
      view({ pools: [pool({ mode: "onDemand", ...over })], templateRecords: templates }),
    )[1];
  expect(onDemand({ paused: true })).toBe("Pool gpu would take it, but it's paused.");
  expect(onDemand({})).toContain("runner software isn't installed yet");
  expect(onDemand({}, [{ poolId: "p1" }])).toBe(
    "Pool gpu should start a one-job runner for it within a minute.",
  );
});

test("on-demand pools: what its runners so far did about the job", () => {
  const base = {
    pools: [pool({ mode: "onDemand", machines: [{ machineId: "m1", slots: 1 }] })],
    templateRecords: [{ poolId: "p1" }],
  };
  const run = (dispatches: unknown[], queueAt: number | null = 2_000, now = 2_000) =>
    waitingReasons(job(["gpu"]), view({ ...base, dispatches, queueAt }), now)[1];
  const d = (over: object) => ({
    id: "d",
    poolId: "p1",
    machineId: "m1",
    runnerName: "builder-gpu-1a",
    runnerKind: "actions",
    jobId: 1,
    state: "done",
    startedAt: 1_000,
    endedAt: 1_500,
    detail: null,
    cleared: false,
    ...over,
  });
  expect(run([d({ state: "starting", endedAt: null })])).toBe(
    "Runyard started builder-gpu-1a for it on Builder; it takes the job once GitHub lists it.",
  );
  expect(run([d({})], 1_400)).toBe(
    "Its runner builder-gpu-1a ended without running it; Runyard starts another once the queue is read again (1 of 3 tries).",
  );
  expect(run([d({})])).toBe(
    "Pool gpu starts another runner for it within a minute (2 of 3 tries).",
  );
  expect(run([d({ id: "a" }), d({ id: "b" }), d({ id: "c" })])).toContain(
    "Runyard started 3 runners for it and none ran it.",
  );
  // Another job's runner fills the only slot.
  expect(run([d({ jobId: 9, state: "running", endedAt: null })])).toContain(
    "running as many one-job runners as they're allowed (Builder: 1)",
  );
});
