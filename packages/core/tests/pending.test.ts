import { expect, test } from "vite-plus/test";
import {
  deriveIssues,
  emptyGithubView,
  pendingChanges,
  type DesiredRunner,
  type MachineView,
  type MigrationView,
  type Pool,
  type Registration,
  type RunnerView,
  type YardView,
} from "../src/index.ts";

const scope = { forgeId: "gh1", kind: "repo" as const, target: "acme/app" };

const machine: MachineView = {
  id: "m1",
  name: "lxc",
  description: "",
  sshTarget: "runyard@lxc",
  transport: "openssh",
  runyardKeyOnly: true,
  os: "linux",
  tailnet: null,
  connection: { state: "connected", checkedAt: 0 },
  health: null,
  diagnostics: null,
  readiness: null,
  alerts: [],
  maintenanceUntil: null,
};

const pool: Pool = {
  id: "p1",
  name: "check",
  labels: ["check"],
  machines: [{ machineId: "m1", slots: 1 }],
  scopes: [scope],
  forgejoMode: { kind: "host" },
  mode: "persistent",
  paused: false,
  toolProfiles: [],
  cleanup: "workspace",
};

const desired: DesiredRunner = {
  key: "d1",
  poolId: "p1",
  poolName: "check",
  machineId: "m1",
  scope,
  slot: 1,
  name: "lxc-check-01",
  path: "/home/runyard/runyard-runners/check/acme-app/lxc-check-01",
  labels: ["check", "runyard"],
  serviceMode: "systemd",
  runnerKind: "actions",
  cleanup: "workspace",
};

const registration: Registration = {
  key: "d1",
  machineId: "m1",
  runnerName: "lxc-check-01",
  scope,
  path: desired.path,
  serviceMode: "systemd",
  runnerKind: "actions",
  cleanup: "workspace",
  history: true,
};

const runner = (over: Partial<RunnerView> = {}): RunnerView => ({
  key: "r1",
  id: 1,
  name: "lxc-check-01",
  forge: "github",
  forgeId: "gh1",
  scope,
  scopeLabel: "acme/app",
  status: "online",
  labels: ["self-hosted", "linux", "x64", "check", "runyard"],
  os: "Linux",
  version: null,
  ephemeral: false,
  activity: "idle",
  asOf: 0,
  stale: false,
  job: null,
  machineId: "m1",
  onDemand: null,
  listed: true,
  ...over,
});

const app = (runnersError: string | null = null): YardView["github"]["apps"][number] =>
  ({
    forgeId: "gh1",
    error: null,
    installations: [{ runnersAt: 0, runnersError }],
  }) as unknown as YardView["github"]["apps"][number];

const view = (over: {
  machines?: MachineView[];
  pools?: Pool[];
  desired?: DesiredRunner[];
  registrations?: Registration[];
  runners?: RunnerView[];
  migrations?: MigrationView[];
  apps?: YardView["github"]["apps"];
}): YardView => ({
  generatedAt: 0,
  tailnet: { name: null, at: null, stale: true, error: null },
  machines: over.machines ?? [machine],
  discovered: [],
  ignored: [],
  alerts: [],
  github: { ...emptyGithubView, apps: over.apps ?? [app()] },
  forgejo: { connections: [], runners: [], queue: { jobs: [], complete: true, at: null } },
  runners: over.runners ?? [runner()],
  queue: { jobs: [], complete: true, at: null },
  summary: { runners: 0, busy: 0, idle: 0, offline: 0, unknown: 0 },
  boat: null,
  boatVms: {},
  assignedRunners: [],
  pools: {
    pools: over.pools ?? [pool],
    desired: over.desired ?? [desired],
    collisions: [],
    registrations: over.registrations ?? [registration],
    templates: [],
    templateRecords: [],
    dispatches: [],
    migrations: over.migrations ?? [],
  },
});

test("nothing waits when the records match the pools", () => {
  expect(pendingChanges(view({}), "m1")).toEqual([]);
});

test("a runner the pool wants but Runyard hasn't installed", () => {
  expect(pendingChanges(view({ registrations: [], runners: [] }), "m1")).toEqual([
    "Install lxc-check-01",
  ]);
});

test("a runner Runyard recorded that the forge doesn't list", () => {
  expect(pendingChanges(view({ runners: [] }), "m1")).toEqual(["Install lxc-check-01"]);
  // A failed read says nothing about what's missing.
  expect(pendingChanges(view({ runners: [], apps: [app("Bad credentials")] }), "m1")).toEqual([]);
});

test("a pool edit to cleanup, once Runyard knows what it set up", () => {
  const edited = { ...desired, cleanup: "docker" as const };
  expect(pendingChanges(view({ desired: [edited] }), "m1")).toEqual([
    "Set job hooks on lxc-check-01",
  ]);
  // Installed before Runyard recorded it: unknown, so no guess.
  expect(
    pendingChanges(
      view({ desired: [edited], registrations: [{ ...registration, cleanup: null }] }),
      "m1",
    ),
  ).toEqual([]);
});

test("a runner set up before run history needs its job hooks", () => {
  expect(
    pendingChanges(view({ registrations: [{ ...registration, history: null }] }), "m1"),
  ).toEqual(["Set job hooks on lxc-check-01"]);
});

test("labels that differ on the forge, ignoring the ones GitHub adds", () => {
  expect(
    pendingChanges(view({ desired: [{ ...desired, labels: ["check", "runyard", "gpu"] }] }), "m1"),
  ).toEqual(["Update labels on lxc-check-01"]);
  // Stale forge data isn't trusted for this.
  expect(
    pendingChanges(
      view({
        desired: [{ ...desired, labels: ["check", "runyard", "gpu"] }],
        runners: [runner({ stale: true })],
      }),
      "m1",
    ),
  ).toEqual([]);
});

test("a runner no pool wants any more", () => {
  expect(pendingChanges(view({ pools: [], desired: [] }), "m1")).toEqual(["Remove lxc-check-01"]);
});

test("tools its pools ask for that the last check didn't find", () => {
  const readiness = {
    items: [{ id: "tool-jq", status: "missing", value: "Not found" }],
    capabilities: [],
    homebrew: false,
  } as unknown as MachineView["readiness"];
  expect(
    pendingChanges(
      view({
        machines: [{ ...machine, readiness }],
        pools: [{ ...pool, toolProfiles: ["essentials"] }],
      }),
      "m1",
    )[0],
  ).toMatch(/^Install git, curl, .*jq/);
});

test("a takeover ready to retire", () => {
  const migration = {
    machineId: "m1",
    runnerName: "manual-01",
    state: "ready",
  } as unknown as MigrationView;
  expect(pendingChanges(view({ migrations: [migration] }), "m1")).toEqual(["Retire manual-01"]);
});

test("says nothing for a machine Runyard can't reach", () => {
  const offline = { ...machine, connection: { state: "unknown" } } as unknown as MachineView;
  expect(pendingChanges(view({ machines: [offline], registrations: [] }), "m1")).toEqual([]);
});

test("Needs attention names a machine's waiting changes and links to them", () => {
  const issue = deriveIssues(view({ registrations: [], runners: [] })).find(
    (i) => i.id === "m1:changes",
  );
  expect(issue).toMatchObject({
    title: "lxc: a change waiting",
    detail: "Install lxc-check-01. Review its changes, then run them.",
    machineId: "m1",
    hash: "changes",
  });
});

test("Needs attention points at runners Runyard doesn't manage until their machine is chosen", () => {
  const manual = runner({ key: "r2", name: "manual-01", machineId: null });
  expect(
    deriveIssues(view({ runners: [runner(), manual] })).find((i) => i.id === "runners:unmanaged"),
  ).toMatchObject({ title: "manual-01: not managed by Runyard", runnerKey: "r2" });
  expect(
    deriveIssues(view({ runners: [runner(), { ...manual, machineId: "m1" }] })).some(
      (i) => i.id === "runners:unmanaged",
    ),
  ).toBe(false);
  // One-job runners, from Runyard or an on-demand service, aren't meant to be managed.
  expect(
    deriveIssues(
      view({
        runners: [runner(), { ...manual, ephemeral: true }, { ...manual, onDemand: "boat" }],
      }),
    ).some((i) => i.id === "runners:unmanaged"),
  ).toBe(false);
});
