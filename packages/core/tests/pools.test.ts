import { describe, expect, test } from "vite-plus/test";
import {
  desiredRunners,
  labelDrift,
  nameCollisions,
  planFingerprint,
  planMachine,
  scopeKey,
  type DesiredRunner,
  type OsFamily,
  type LocalRunner,
  type PlanInput,
  type Pool,
  type RemoteRunner,
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
