import { expect, test } from "vite-plus/test";
import { deriveIssues, emptyGithubView, type YardView, type MachineView } from "../../src/index.ts";

const machine = (over: Partial<MachineView>): MachineView => ({
  id: "m1",
  name: "Mini",
  description: "",
  sshTarget: "ci@mini",
  transport: "openssh",
  os: "macos",
  tailnet: null,
  connection: { state: "connected", checkedAt: 0 },
  health: null,
  diagnostics: {
    asOf: 0,
    stale: false,
    checks: [
      {
        id: "power-sleep",
        group: "power",
        title: "Sleep on AC power",
        status: "warn",
        value: "After 10 minutes",
        detail: "d",
      },
      {
        id: "disk-space",
        group: "system",
        title: "Disk space",
        status: "warn",
        value: "Less than 10% free",
        detail: "d",
      },
      {
        id: "architecture",
        group: "system",
        title: "Architecture",
        status: "info",
        value: "arm64",
        detail: "d",
      },
    ],
  },
  alerts: [],
  maintenanceUntil: null,
  ...over,
});

const view = (machines: MachineView[], error: string | null = null): YardView => ({
  generatedAt: 0,
  tailnet: { name: null, at: null, stale: true, error },
  machines,
  discovered: [],
  ignored: [],
  alerts: machines.flatMap((m) => m.alerts),
  github: emptyGithubView,
  forgejo: { connections: [], runners: [], queue: { jobs: [], complete: true, at: null } },
  runners: [],
  queue: { jobs: [], complete: true, at: null },
  summary: { runners: 0, busy: 0, idle: 0, offline: 0, unknown: 0 },
  boat: null,
  boatVms: {},
  assignedRunners: [],
  pools: {
    pools: [],
    desired: [],
    collisions: [],
    registrations: [],
    templates: [],
    templateRecords: [],
    dispatches: [],
    migrations: [],
  },
});

test("lists warnings, SSH failures and a tailnet problem", () => {
  const issues = deriveIssues(
    view(
      [
        machine({}),
        machine({
          id: "m2",
          name: "Box",
          connection: { state: "error", detail: "Permission denied" },
        }),
      ],
      "down",
    ),
  );
  expect(issues.map((i) => i.id)).toEqual(["tailnet", "m1:power-sleep", "m1:disk-space", "m2:ssh"]);
  expect(issues[1]).toMatchObject({
    title: "Mini: Sleep on AC power",
    detail: "After 10 minutes. d",
  });
});

test("an active disk alert replaces the disk warning; stale diagnostics aren't current", () => {
  const alert = {
    id: "m1:disk",
    machineId: "m1",
    machineName: "Mini",
    kind: "lowDisk" as const,
    since: 0,
    detail: "",
    stale: false,
    muted: false,
  };
  expect(deriveIssues(view([machine({ alerts: [alert] })])).map((i) => i.id)).toEqual([
    "m1:power-sleep",
  ]);
  const stale = machine({ diagnostics: { ...machine({}).diagnostics!, stale: true } });
  expect(deriveIssues(view([stale]))).toEqual([]);
});

test("boat.dev VMs left running need a look", () => {
  const vm = {
    id: "bx_1",
    name: "scratch",
    type: "large",
    size: null,
    createdAt: 0,
    dollars: 1.874,
    jobId: null,
  };
  const withBoat = {
    ...view([]),
    boat: { at: 1, stale: false, error: null, limits: null, running: [vm], leftover: [vm] },
  } as unknown as YardView;
  expect(deriveIssues(withBoat).find((i) => i.id === "boat:leftover")).toMatchObject({
    title: "1 boat.dev VM running outside CI",
    page: "boat",
    detail: expect.stringContaining("scratch: $1.87 so far"),
  });
});

test("a Mac in a pool needs automatic login for the runners' user", () => {
  const login = (value: string) =>
    machine({
      diagnostics: {
        asOf: 0,
        stale: false,
        checks: [
          {
            id: "login-auto",
            group: "power",
            title: "Automatic login",
            status: "info",
            value,
            detail: "d",
          },
        ],
      },
    });
  const inPool = (m: MachineView): YardView => {
    const v = view([m]);
    v.pools.pools = [
      {
        id: "p1",
        name: "mac",
        labels: [],
        machines: [{ machineId: "m1", slots: 1 }],
        scopes: [],
        forgejoMode: { kind: "host" },
        mode: "persistent",
        paused: false,
      },
    ];
    return v;
  };
  const macIssue = (v: YardView) => deriveIssues(v).find((i) => i.id === "m1:mac-login");
  expect(macIssue(inPool(login("Off")))?.detail).toContain("automatic login is off");
  expect(macIssue(inPool(login("As admin")))?.detail).toContain(
    "is for admin, but the runners run as ci",
  );
  expect(macIssue(inPool(login("As ci")))).toBeUndefined();
  // Not in a pool: nothing runs there, so nothing to warn about.
  expect(macIssue(view([login("Off")]))).toBeUndefined();
});
