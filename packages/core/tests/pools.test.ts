import { describe, expect, test } from "vite-plus/test";
import {
  desiredRunners,
  labelDrift,
  migrationViews,
  nameCollisions,
  planFingerprint,
  planMachine,
  profileTools,
  scopeKey,
  type DesiredRunner,
  type OsFamily,
  type LocalRunner,
  type Migration,
  type PlanInput,
  type Readiness,
  type ToolProfile,
  type Pool,
  type RemoteRunner,
  type RunnerView,
  type Scope,
} from "../src/index.ts";

const org: Scope = { forgeId: "gh", kind: "org", target: "acme" };
const repoA: Scope = { forgeId: "gh", kind: "repo", target: "frankie/app" };
const repoB: Scope = { forgeId: "gh", kind: "repo", target: "frankie/site" };

const pool = (over: Partial<Pool> = {}): Pool => ({
  id: "p1",
  name: "mac",
  labels: ["xcode"],
  machines: [{ machineId: "m1", slots: 2 }],
  scopes: [org],
  forgejoMode: { kind: "host" },
  mode: "persistent",
  paused: false,
  toolProfiles: [],
  ...over,
});
const machines = new Map<string, { name: string; os: OsFamily | null }>([
  ["m1", { name: "Studio Mini", os: "macos" }],
  ["m2", { name: "Win Box", os: "windows" }],
  ["m3", { name: "Unknown", os: null }],
]);

describe("desiredRunners", () => {
  test("one runner per slot for an organization", () => {
    const runners = desiredRunners([pool()], machines);
    expect(runners.map((r) => [r.name, r.path, r.serviceMode])).toEqual([
      ["studio-mini-mac-01", "~/runyard-runners/mac/01", "launchagent"],
      ["studio-mini-mac-02", "~/runyard-runners/mac/02", "launchagent"],
    ]);
    expect(runners[0]?.labels).toEqual(["xcode", "runyard", "runyard-pool-mac"]);
  });

  test("personal repositories fan out to one runner per slot per repository", () => {
    const runners = desiredRunners(
      [pool({ scopes: [repoA, repoB], machines: [{ machineId: "m1", slots: 1 }] })],
      machines,
    );
    expect(runners.map((r) => [r.scope.target, r.name, r.path])).toEqual([
      ["frankie/app", "studio-mini-mac-01", "~/runyard-runners/mac/frankie-app/01"],
      ["frankie/site", "studio-mini-mac-01", "~/runyard-runners/mac/frankie-site/01"],
    ]);
  });

  test("Windows paths and services; machines with an unknown OS wait", () => {
    const runners = desiredRunners(
      [
        pool({
          machines: [
            { machineId: "m2", slots: 1 },
            { machineId: "m3", slots: 1 },
          ],
        }),
      ],
      machines,
    );
    expect(runners.map((r) => [r.path, r.serviceMode])).toEqual([
      ["C:\\runyard-runners\\mac\\01", "windows-service"],
    ]);
  });

  test("detects two runners with one name in one scope", () => {
    const twin = new Map([...machines, ["m4", { name: "studio-mini", os: "linux" as const }]]);
    const runners = desiredRunners(
      [
        pool({
          machines: [
            { machineId: "m1", slots: 1 },
            { machineId: "m4", slots: 1 },
          ],
        }),
      ],
      twin,
    );
    expect(nameCollisions(runners)).toHaveLength(1);
  });
});

test("labelDrift ignores GitHub's own labels and case", () => {
  expect(
    labelDrift(["Xcode", "runyard"], ["self-hosted", "macOS", "ARM64", "xcode", "old"]),
  ).toEqual({
    missing: ["runyard"],
    unexpected: ["old"],
  });
});

describe("planMachine", () => {
  const [d] = desiredRunners([pool({ machines: [{ machineId: "m1", slots: 1 }] })], machines) as [
    DesiredRunner,
  ];
  const remote = (over: Partial<RemoteRunner> = {}): RemoteRunner => ({
    id: 5,
    name: d.name,
    status: "online",
    busy: false,
    labels: ["self-hosted", "macOS", ...d.labels],
    ...over,
  });
  const local = (over: Partial<LocalRunner> = {}): LocalRunner => ({
    path: d.path,
    configured: true,
    service: "active",
    version: "2.329.0",
    agentName: d.name,
    ...over,
  });
  const input = (over: Partial<PlanInput> = {}): PlanInput => ({
    machineId: "m1",
    desired: [d],
    registrations: [],
    local: new Map(),
    github: new Map(),
    policies: new Map([[scopeKey(org), { ok: true }]]),
    machineError: null,
    githubErrors: new Map(),
    ...over,
  });
  const gh = (r: RemoteRunner) => new Map([[scopeKey(org), new Map([[r.name.toLowerCase(), r]])]]);
  const actions = (i: PlanInput) => planMachine(i).map((p) => [p.action, p.blocked]);

  test("installs a runner nobody has yet", () => {
    expect(actions(input())).toEqual([["install", false]]);
  });

  test("a runner in sync needs nothing", () => {
    expect(actions(input({ local: new Map([[d.path, local()]]), github: gh(remote()) }))).toEqual(
      [],
    );
  });

  test("an unreachable machine or GitHub blocks instead of looking missing", () => {
    expect(actions(input({ machineError: "timed out" }))).toEqual([["inspect", true]]);
    expect(actions(input({ githubErrors: new Map([[scopeKey(org), "403"]]) }))).toEqual([
      ["inspect", true],
    ]);
  });

  test("half-configured runners need a person", () => {
    expect(actions(input({ local: new Map([[d.path, local()]]) }))).toEqual([
      ["repairRegistration", true],
    ]);
    expect(actions(input({ github: gh(remote()) }))).toEqual([["recoverLocal", true]]);
    expect(
      actions(
        input({ local: new Map([[d.path, local({ agentName: "other" })]]), github: gh(remote()) }),
      ),
    ).toEqual([["repairRegistration", true]]);
  });

  test("starts a stopped service, but never one whose runner is busy", () => {
    const stopped = new Map([[d.path, local({ service: "inactive" })]]);
    expect(actions(input({ local: stopped, github: gh(remote()) }))).toEqual([["start", false]]);
    expect(actions(input({ local: stopped, github: gh(remote({ busy: true })) }))).toEqual([
      ["preserveService", true],
    ]);
  });

  test("reconciles labels and flags a running service GitHub calls offline", () => {
    const items = planMachine(
      input({
        local: new Map([[d.path, local()]]),
        github: gh(remote({ status: "offline", labels: ["self-hosted", "old"] })),
      }),
    );
    expect(items.map((i) => i.action)).toEqual(["reconcileLabels", "inspectOffline"]);
    expect(items[0]?.reason).toBe("add runyard, runyard-pool-mac, xcode; remove old");
  });

  test("refuses to register into a public repository or a group that admits public ones", () => {
    const [r] = desiredRunners(
      [pool({ scopes: [repoA], machines: [{ machineId: "m1", slots: 1 }] })],
      machines,
    ) as [DesiredRunner];
    const refused = planMachine(
      input({
        desired: [r],
        policies: new Map([[scopeKey(repoA), { ok: false, reason: "frankie/app is public." }]]),
      }),
    );
    expect(refused.map((i) => [i.action, i.blocked, i.reason])).toEqual([
      ["publicRepo", true, "frankie/app is public."],
    ]);
    expect(actions(input({ policies: new Map() }))).toEqual([["groupPolicy", true]]);
  });

  test("removes a runner no pool wants, unless it's busy", () => {
    const registration = {
      key: "old",
      machineId: "m1",
      runnerName: "studio-mini-old-01",
      scope: org,
      path: "~/runyard-runners/old/01",
      serviceMode: "launchagent" as const,
      runnerKind: "actions" as const,
    };
    const base = input({ desired: [], registrations: [registration] });
    expect(actions(base)).toEqual([["remove", false]]);
    const busy = remote({ name: "studio-mini-old-01", busy: true });
    expect(actions({ ...base, github: gh(busy) })).toEqual([["remove", true]]);
  });

  test("fingerprints ignore order but not content", () => {
    const a = planMachine(input());
    expect(planFingerprint(a)).toBe(planFingerprint([...a].reverse()));
    expect(planFingerprint(a)).not.toBe(planFingerprint(planMachine(input({ machineError: "x" }))));
  });
});

describe("moving a runner Runyard didn't install into a pool", () => {
  const p = pool({ machines: [{ machineId: "m1", slots: 1 }] });
  const [d] = desiredRunners([p], machines) as [DesiredRunner];
  const migration: Migration = {
    scope: org,
    runnerName: "old-mac",
    machineId: "m1",
    poolId: "p1",
    path: "/Users/me/actions-runner",
  };
  const old = (over: Partial<RemoteRunner> = {}): RemoteRunner => ({
    id: 9,
    name: "old-mac",
    status: "online",
    busy: false,
    labels: ["self-hosted", "macOS", "xcode"],
    ...over,
  });
  const standIn = (over: Partial<RemoteRunner> = {}): RemoteRunner => ({
    id: 5,
    name: d.name,
    status: "online",
    busy: false,
    labels: ["self-hosted", "macOS", ...d.labels],
    ...over,
  });
  const input = (
    remotes: RemoteRunner[],
    over: Partial<PlanInput> = {},
    service = "active",
  ): PlanInput => ({
    machineId: "m1",
    desired: [d],
    registrations: [],
    local: new Map([
      [d.path, { path: d.path, configured: true, service, version: "2.329.0", agentName: d.name }],
    ]),
    github: new Map([[scopeKey(org), new Map(remotes.map((r) => [r.name.toLowerCase(), r]))]]),
    policies: new Map([[scopeKey(org), { ok: true }]]),
    machineError: null,
    githubErrors: new Map(),
    migrations: [migration],
    ...over,
  });
  const retire = (i: PlanInput) => planMachine(i).filter((x) => x.action === "retire");

  test("retires it once a pool runner is online, idle, labeled and running", () => {
    const [item] = retire(input([old(), standIn()]));
    expect(item).toMatchObject({ runnerName: "old-mac", blocked: false });
    expect(item?.reason).toContain(d.name);
  });

  test("waits while the replacement isn't installed, online, idle, labeled or running", () => {
    for (const i of [
      input([old()]),
      input([old(), standIn({ status: "offline" })]),
      input([old(), standIn({ busy: true })]),
      input([old(), standIn({ labels: ["self-hosted"] })]),
      input([old(), standIn()], {}, "inactive"),
    ])
      expect(retire(i).map((x) => [x.blocked, x.reason.startsWith("Waiting for")])).toEqual([
        [true, true],
      ]);
  });

  test("never retires a busy runner, or one whose labels the pool lacks", () => {
    expect(retire(input([old({ busy: true }), standIn()]))[0]?.blocked).toBe(true);
    const [item] = retire(input([old({ labels: ["self-hosted", "xcode", "GPU"] }), standIn()]));
    expect(item?.blocked).toBe(true);
    expect(item?.reason).toContain("gpu");
  });

  test("blocks when the forge can't be read or the pool has no runner there", () => {
    const unread = retire(
      input([old(), standIn()], { githubErrors: new Map([[scopeKey(org), "timeout"]]) }),
    );
    expect(unread.map((x) => x.blocked)).toEqual([true]);
    expect(retire(input([old()], { desired: [] }))[0]?.reason).toContain("has no runner");
  });

  test("a runner already gone from the forge needs nothing, and other machines' migrations wait", () => {
    expect(retire(input([standIn()]))).toEqual([]);
    expect(
      retire(input([old(), standIn()], { migrations: [{ ...migration, machineId: "m2" }] })),
    ).toEqual([]);
  });

  test("the dashboard's guide follows the same rules from the forge's last read", () => {
    const view = (name: string, activity: RunnerView["activity"], labels: string[]) =>
      ({
        key: name,
        name,
        scope: org,
        activity,
        stale: false,
        labels: ["self-hosted", ...labels],
      }) as RunnerView;
    const states = (runners: RunnerView[]) =>
      migrationViews([migration], [p], [d], runners).map((v) => v.state);
    expect(states([])).toEqual(["gone"]);
    expect(states([view("old-mac", "idle", ["xcode"])])).toEqual(["waiting"]);
    expect(states([view("old-mac", "idle", ["gpu"]), view(d.name, "idle", d.labels)])).toEqual([
      "labels",
    ]);
    expect(states([view("old-mac", "busy", []), view(d.name, "idle", d.labels)])).toEqual(["busy"]);
    expect(states([view("old-mac", "idle", []), view(d.name, "busy", d.labels)])).toEqual([
      "waiting",
    ]);
    expect(states([view("old-mac", "idle", []), view(d.name, "idle", d.labels)])).toEqual([
      "ready",
    ]);
    expect(migrationViews([migration], [p], [], [view("old-mac", "idle", [])])[0]?.state).toBe(
      "noReplacement",
    );
  });
});

describe("Forgejo runners", () => {
  const user: Scope = { forgeId: "fj", kind: "user", target: "frankie" };
  const forges = new Map([["fj", "forgejo" as const]]);
  const linux = new Map<string, { name: string; os: OsFamily | null }>([
    ["l1", { name: "Box", os: "linux" }],
  ]);

  test("one runner per slot for a whole account, in its own directory, with the pool's mode", () => {
    const runners = desiredRunners(
      [
        pool({
          scopes: [user, org],
          machines: [{ machineId: "l1", slots: 1 }],
          forgejoMode: { kind: "docker", image: "node:22" },
        }),
      ],
      linux,
      forges,
    );
    expect(runners.map((r) => [r.runnerKind, r.path, r.forgejoMode?.kind ?? null])).toEqual([
      ["forgejo", "~/runyard-runners/mac/forgejo-frankie/01", "docker"],
      ["actions", "~/runyard-runners/mac/01", null],
    ]);
  });

  test("blocks Forgejo runners on machines other than Linux", () => {
    const [d] = desiredRunners(
      [pool({ scopes: [user], machines: [{ machineId: "m1", slots: 1 }] })],
      machines,
      forges,
    ) as [DesiredRunner];
    const items = planMachine({
      machineId: "m1",
      desired: [d],
      registrations: [],
      local: new Map(),
      github: new Map(),
      policies: new Map([[scopeKey(user), { ok: true }]]),
      machineError: null,
      githubErrors: new Map(),
    });
    expect(items.map((i) => [i.action, i.blocked])).toEqual([["unsupportedPlatform", true]]);
  });
});

describe("installing a pool's tools", () => {
  const readiness = (have: string[], homebrew = false): Readiness => ({
    items: have.map((id) => ({
      id,
      tier: "required",
      title: id,
      status: "ok",
      value: "",
      detail: "",
    })),
    capabilities: [],
    homebrew,
  });
  const plan = (
    os: OsFamily,
    r: Readiness | null,
    profiles: ToolProfile[] = ["essentials", "docker"],
  ) =>
    planMachine({
      machineId: "m1",
      desired: [],
      registrations: [],
      local: new Map(),
      github: new Map(),
      policies: new Map(),
      machineError: null,
      githubErrors: new Map(),
      tools: { wanted: profileTools(profiles), os, readiness: r, scope: org },
    }).map((i) => [i.action, i.blocked, i.tools]);

  test("Linux installs only what's missing; nothing when all is there", () => {
    expect(plan("linux", readiness(["tool-git", "tool-curl", "tool-tar", "docker"]))).toEqual([
      ["installTools", false, ["unzip", "zip", "xz", "zstd", "jq", "gpg"]],
    ]);
    const all = profileTools(["essentials"]).map((t) => `tool-${t}`);
    expect(plan("linux", readiness([...all, "docker"]))).toEqual([]);
  });

  test("waits for a check, and never guesses on Windows", () => {
    expect(plan("linux", null)).toEqual([
      ["installTools", true, profileTools(["essentials", "docker"])],
    ]);
    expect(plan("windows", readiness([]))[0]?.[1]).toBe(true);
  });

  test("a Mac installs with Homebrew, and leaves the Command Line Tools and Docker to a person", () => {
    expect(
      plan("macos", readiness(["tool-curl", "tool-tar"], true), ["essentials", "build", "docker"]),
    ).toEqual([
      ["installTools", false, ["unzip", "zip", "xz", "zstd", "jq", "gpg", "python3"]],
      ["installTools", true, ["git", "cc", "make"]],
      ["installTools", true, ["docker"]],
    ]);
    const noBrew = plan("macos", readiness(["tool-git", "tool-curl", "tool-tar"]), ["essentials"]);
    expect(noBrew).toEqual([["installTools", true, ["unzip", "zip", "xz", "zstd", "jq", "gpg"]]]);
  });

  test("tools come before the runners, and the fingerprint covers them", () => {
    const [d] = desiredRunners([pool({ machines: [{ machineId: "m1", slots: 1 }] })], machines) as [
      DesiredRunner,
    ];
    const input = (wanted: ToolProfile[]): PlanInput => ({
      machineId: "m1",
      desired: [d],
      registrations: [],
      local: new Map(),
      github: new Map(),
      policies: new Map([[scopeKey(org), { ok: true }]]),
      machineError: null,
      githubErrors: new Map(),
      tools: {
        wanted: profileTools(wanted),
        os: "macos",
        readiness: readiness([], true),
        scope: org,
      },
    });
    expect(planMachine(input(["essentials"])).map((i) => i.action)[0]).toBe("installTools");
    expect(planFingerprint(planMachine(input(["essentials"])))).not.toBe(
      planFingerprint(planMachine(input(["essentials", "build"]))),
    );
  });
});
