import { describe, expect, test } from "vite-plus/test";
import {
  advanceDispatches,
  desiredRunners,
  desiredTemplates,
  DISPATCH_START_TIMEOUT_MS,
  planDispatches,
  planMachine,
  type Dispatch,
  type DesiredTemplate,
  type MachineView,
  type OsFamily,
  type PlanInput,
  type Pool,
  type QueuedJobView,
  type RunnerView,
  type Scope,
  type TemplateRecord,
} from "../src/index.ts";

const org: Scope = { forgeId: "gh", kind: "org", target: "acme" };
const pool = (over: Partial<Pool> = {}): Pool => ({
  id: "p1",
  name: "jit",
  labels: ["xcode"],
  machines: [{ machineId: "m1", slots: 2 }],
  scopes: [org],
  forgejoMode: { kind: "host" },
  mode: "onDemand",
  paused: false,
  ...over,
});
const info = new Map<string, { name: string; os: OsFamily | null }>([
  ["m1", { name: "Studio Mini", os: "macos" }],
  ["m2", { name: "Win Box", os: "windows" }],
]);
const machine = (id: string, over: Partial<MachineView> = {}) =>
  ({
    id,
    name: id,
    os: "macos",
    connection: { state: "connected", checkedAt: 0 },
    diagnostics: { checks: [{ id: "architecture", value: "arm64" }] },
    ...over,
  }) as unknown as MachineView;
const job = (over: Partial<QueuedJobView> = {}): QueuedJobView => ({
  id: 100,
  forge: "github",
  repo: "acme/app",
  name: "build",
  workflowName: "CI",
  labels: ["self-hosted", "macOS", "ARM64", "xcode"],
  createdAt: 0,
  startedAt: null,
  htmlUrl: null,
  headBranch: null,
  onDemand: null,
  eligible: [],
  ...over,
});
const record = (t: DesiredTemplate): TemplateRecord => ({
  key: t.key,
  machineId: t.machineId,
  poolId: t.poolId,
  poolName: t.poolName,
  scope: t.scopes[0]!,
  runnerKind: t.runnerKind,
  path: t.path,
  serviceMode: "launchagent",
});

describe("on-demand pools", () => {
  test("call for a template per machine, not registered runners", () => {
    expect(desiredRunners([pool()], info)).toEqual([]);
    expect(desiredTemplates([pool()], info).map((t) => [t.key, t.path, t.runnerKind])).toEqual([
      ["p1:m1:actions", "~/runyard-runners/jit/template-actions", "actions"],
    ]);
  });

  test("the review installs a missing template, refuses Windows, and removes unwanted ones", () => {
    const templates = desiredTemplates(
      [
        pool({
          machines: [
            { machineId: "m1", slots: 1 },
            { machineId: "m2", slots: 1 },
          ],
        }),
      ],
      info,
    );
    const base: PlanInput = {
      machineId: "m1",
      desired: [],
      registrations: [],
      local: new Map(),
      github: new Map(),
      policies: new Map([["gh:org:acme", { ok: true }]]),
      machineError: null,
      githubErrors: new Map(),
      templates,
    };
    expect(planMachine(base).map((i) => [i.action, i.blocked])).toEqual([
      ["installTemplate", false],
    ]);
    const present = {
      ...base,
      localTemplates: new Map([
        [templates[0]!.path, { path: templates[0]!.path, present: true, version: "2.329.0" }],
      ]),
    };
    expect(planMachine(present)).toEqual([]);
    expect(planMachine({ ...base, machineId: "m2" }).map((i) => [i.action, i.blocked])).toEqual([
      ["unsupportedPlatform", true],
    ]);
    const refused = {
      ...base,
      policies: new Map([["gh:org:acme", { ok: false as const, reason: "public" }]]),
    };
    expect(planMachine(refused).map((i) => [i.action, i.blocked])).toEqual([["groupPolicy", true]]);
    const leftover = { ...present, templates: [], templateRecords: [record(templates[0]!)] };
    expect(planMachine(leftover).map((i) => [i.action, i.runnerName])).toEqual([
      ["removeTemplate", "jit template"],
    ]);
  });
});

describe("dispatch", () => {
  const templates = desiredTemplates([pool()], info);
  const base = {
    queue: [job()],
    runners: [] as RunnerView[],
    pools: [pool()],
    templates,
    installed: templates.map(record),
    machines: [machine("m1")],
    dispatches: [] as Dispatch[],
    busyMachines: new Set<string>(),
    forgeKinds: new Map([["gh", "github" as const]]),
    now: 1_000_000,
  };
  const dispatch = (over: Partial<Dispatch> = {}): Dispatch => ({
    id: "d1",
    poolId: "p1",
    machineId: "m1",
    runnerName: "studio-mini-jit-a1b2",
    runnerKind: "actions",
    scope: org,
    jobId: 100,
    runnerId: 77,
    state: "starting",
    startedAt: 1_000_000,
    endedAt: null,
    detail: null,
    ...over,
  });

  test("a queued job with no idle runner gets a runner from a matching pool", () => {
    const [plan] = planDispatches(base);
    expect(plan).toMatchObject({
      machineId: "m1",
      scope: org,
      job: { id: 100 },
      pool: { id: "p1" },
    });
  });

  test("nothing starts without a match, a template, capacity or an unpaused pool", () => {
    const none = (over: Partial<typeof base>) => planDispatches({ ...base, ...over });
    expect(none({ queue: [job({ labels: ["self-hosted", "gpu"] })] })).toEqual([]);
    expect(none({ queue: [job({ labels: ["self-hosted", "X64", "xcode"] })] })).toEqual([]);
    expect(none({ queue: [job({ repo: "other/app" })] })).toEqual([]);
    expect(none({ installed: [] })).toEqual([]);
    expect(none({ pools: [pool({ paused: true })] })).toEqual([]);
    expect(none({ pools: [pool({ mode: "persistent" })] })).toEqual([]);
    expect(none({ busyMachines: new Set(["m1"]) })).toEqual([]);
    expect(
      none({
        machines: [machine("m1", { connection: { state: "offline", lastSeen: 0 } } as never)],
      }),
    ).toEqual([]);
    expect(none({ dispatches: [dispatch({ state: "failed" })] })).toEqual([]);
    expect(
      none({
        runners: [{ key: "r", activity: "idle" } as RunnerView],
        queue: [job({ eligible: ["r"] })],
      }),
    ).toEqual([]);
    expect(none({ queue: [job({ onDemand: "boat.dev" })] })).toEqual([]);
  });

  test("slots cap runners per machine, counting ones already starting", () => {
    const queue = [job({ id: 1 }), job({ id: 2 }), job({ id: 3 })];
    expect(planDispatches({ ...base, queue }).map((p) => p.job.id)).toEqual([1, 2]);
    const busy = [dispatch({ jobId: 9, state: "running" })];
    expect(planDispatches({ ...base, queue, dispatches: busy }).map((p) => p.job.id)).toEqual([1]);
  });

  test("dispatches run when listed, finish when their process exits, and time out otherwise", () => {
    const listed = [{ name: "studio-mini-jit-a1b2", scope: org } as RunnerView];
    expect(advanceDispatches([dispatch()], listed, new Set(), 1_000_100)[0]?.state).toBe("running");
    expect(
      advanceDispatches([dispatch()], [], new Set(["studio-mini-jit-a1b2"]), 1_000_100)[0]?.state,
    ).toBe("done");
    const late = advanceDispatches(
      [dispatch()],
      [],
      new Set(),
      1_000_000 + DISPATCH_START_TIMEOUT_MS + 1,
    )[0];
    expect(late).toMatchObject({ state: "failed", detail: expect.stringContaining("10 minutes") });
    expect(advanceDispatches([dispatch({ state: "done" })], [], new Set(), 0)[0]?.state).toBe(
      "done",
    );
  });
});
