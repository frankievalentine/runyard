import { expect, test } from "vite-plus/test";
import {
  deriveIssues,
  emptyGithubView,
  type FleetView,
  type MachineView,
} from "../../src/index.ts";

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

const view = (machines: MachineView[], error: string | null = null): FleetView => ({
  generatedAt: 0,
  tailnet: { name: null, at: null, stale: true, error },
  machines,
  discovered: [],
  ignored: [],
  alerts: machines.flatMap((m) => m.alerts),
  github: emptyGithubView,
  pools: { pools: [], desired: [], collisions: [], registrations: [] },
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
