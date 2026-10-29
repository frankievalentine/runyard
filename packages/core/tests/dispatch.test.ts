import { describe, expect, test } from "vite-plus/test";
import {
  advanceDispatches,
  DISPATCH_RETRY_AFTER_FAILURE_MS,
  nextAttempt,
  deriveYard,
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
  toolProfiles: [],
  cleanup: "off",
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
    queueAt: null as number | null,
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
    job: null,
    runnerId: 77,
    state: "starting",
    startedAt: 1_000_000,
    endedAt: null,
    detail: null,
    cleared: false,
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
    // The same ID on Forgejo is a different job.
    expect(
      planDispatches({ ...base, dispatches: [dispatch({ runnerKind: "forgejo", state: "done" })] }),
    ).toHaveLength(1);
    expect(
      none({
        runners: [{ key: "r", activity: "idle" } as RunnerView],
        queue: [job({ eligible: ["r"] })],
      }),
    ).toEqual([]);
    expect(none({ queue: [job({ onDemand: "boat.dev" })] })).toEqual([]);
  });

  test("a job still queued after its runner ended gets another, up to three", () => {
    const ended = dispatch({ state: "done", endedAt: 1_000_000 });
    const at = (queueAt: number | null, dispatches: Dispatch[], now = 1_000_000) =>
      planDispatches({ ...base, queueAt, dispatches, now });
    // Not until the queue was read after it ended: the job may already be running.
    expect(at(999_000, [ended])).toEqual([]);
    expect(at(1_000_500, [ended])).toMatchObject([{ previous: { id: "d1" } }]);
    // A failed start waits ten minutes.
    const failed = dispatch({ state: "failed", endedAt: 1_000_000 });
    expect(at(1_000_500, [failed], 1_000_500)).toEqual([]);
    expect(at(1_600_500, [failed], 1_600_500)).toHaveLength(1);
    // Three runners in all, unless Try again cleared them.
    const three = ["a", "b", "c"].map((id, i) =>
      dispatch({ id, state: "done", startedAt: 1_000_000 + i, endedAt: 1_000_000 + i }),
    );
    expect(at(1_000_500, three)).toEqual([]);
    expect(
      at(
        1_000_500,
        three.map((d) => ({ ...d, cleared: true })),
      ),
    ).toHaveLength(1);
  });

  test("nextAttempt says why a job gets no runner now", () => {
    expect(nextAttempt([], null, 0)).toEqual({ ok: true, previous: null });
    expect(nextAttempt([dispatch({ state: "running" })], 5, 5)).toMatchObject({ why: "active" });
    expect(nextAttempt([dispatch({ state: "failed", endedAt: 0 })], 5, 5)).toMatchObject({
      why: "wait",
      at: DISPATCH_RETRY_AFTER_FAILURE_MS,
    });
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

test("a running one-job runner shows on the machine it was started on", () => {
  const view = deriveYard({
    machines: [],
    observations: new Map(),
    tailnet: { at: null, snapshot: null, error: null },
    ignoredNodeIds: new Set(),
    states: new Map(),
    forgejo: [
      {
        forgeId: "fj",
        baseUrl: "https://forgejo.test",
        login: "frankie",
        version: "16.0.0",
        error: null,
        scopes: [
          {
            scope: { forgeId: "fj", kind: "user", target: "frankie" },
            runners: {
              at: 1000,
              value: [
                {
                  id: 5,
                  uuid: "u",
                  name: "box-jit-a1",
                  status: "active",
                  labels: [],
                  version: null,
                  ephemeral: true,
                },
              ],
            },
            runnersError: null,
            jobs: null,
            jobsError: null,
            publicRepos: [],
          },
        ],
      },
    ],
    dispatches: [
      {
        id: "d1",
        poolId: "p1",
        machineId: "m9",
        runnerName: "box-jit-a1",
        runnerKind: "forgejo",
        scope: { forgeId: "fj", kind: "user", target: "frankie" },
        jobId: 1,
        job: null,
        runnerId: 5,
        state: "running",
        startedAt: 0,
        endedAt: null,
        detail: null,
        cleared: false,
      },
    ],
    now: 1000,
  });
  expect(view.runners[0]?.machineId).toBe("m9");
});
