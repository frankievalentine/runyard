import { describe, expect, test } from "vite-plus/test";
import {
  connection,
  deriveYard,
  findPeer,
  newMachineState,
  type MachineConfig,
  type MachineObservation,
  type MachineReport,
  type TailnetPeer,
} from "../../src/index.ts";

const peer = (over: Partial<TailnetPeer>): TailnetPeer => ({
  nodeId: "n1",
  hostname: "mini",
  dnsName: "mini.tail1.ts.net",
  os: "macOS",
  ips: ["100.64.0.2"],
  online: true,
  lastSeen: null,
  tags: [],
  sshHostKeys: [],
  ...over,
});

const machine = (over: Partial<MachineConfig> = {}): MachineConfig => ({
  id: "m1",
  name: "Mini",
  description: "",
  sshTarget: "ci@mini.tail1.ts.net",
  transport: "openssh",
  expectedOs: null,
  tailscaleNodeId: null,
  runyardKeyOnly: false,
  ...over,
});

const report: MachineReport = {
  os: "macos",
  osVersion: "15.6",
  cpuPercent: 10,
  loadAverage: [1, 1, 1],
  logicalCores: 8,
  memoryTotalBytes: 100,
  memoryAvailableBytes: 50,
  uptimeSecs: 60,
  bootId: "B1",
  disks: [{ mountPoint: "/", totalBytes: 100, availableBytes: 50 }],
  diagnostics: { identity: "ci" },
  warnings: [],
};

describe("connection", () => {
  const ok: MachineObservation = { report: { at: 0, value: report }, error: null };
  test("follows aarondfrancis/fleet's rules", () => {
    expect(connection(undefined, undefined, 0)).toEqual({ state: "pending" });
    expect(connection(peer({ online: false, lastSeen: 5 }), ok, 0)).toEqual({
      state: "offline",
      lastSeen: 5,
    });
    expect(connection(undefined, ok, 150_000)).toEqual({ state: "connected", checkedAt: 0 });
    expect(connection(undefined, ok, 150_001)).toMatchObject({
      state: "stale",
      reason: "No recent SSH check.",
    });
    expect(
      connection(undefined, { ...ok, error: { at: 1, value: "Permission denied" } }, 2),
    ).toMatchObject({
      state: "stale",
      reason: "Permission denied",
    });
    expect(
      connection(undefined, { report: null, error: { at: 1, value: "Timed out" } }, 2),
    ).toEqual({
      state: "error",
      detail: "Timed out",
    });
  });
});

describe("findPeer", () => {
  test("links by node ID, then by the SSH target's host", () => {
    const peers = [
      peer({}),
      peer({ nodeId: "n2", hostname: "box", dnsName: "box.tail1.ts.net", ips: ["100.64.0.3"] }),
    ];
    expect(findPeer(machine({ tailscaleNodeId: "n2" }), peers)?.nodeId).toBe("n2");
    expect(findPeer(machine({ sshTarget: "ci@MINI.tail1.ts.net" }), peers)?.nodeId).toBe("n1");
    expect(findPeer(machine({ sshTarget: "100.64.0.3" }), peers)?.nodeId).toBe("n2");
    expect(findPeer(machine({ sshTarget: "box" }), peers)?.nodeId).toBe("n2");
    expect(findPeer(machine({ sshTarget: "build.example.com" }), peers)).toBeUndefined();
  });
});

describe("deriveYard", () => {
  test("splits peers into machines, discovered and ignored", () => {
    const view = deriveYard({
      machines: [machine()],
      observations: new Map([["m1", { report: { at: 0, value: report }, error: null }]]),
      tailnet: {
        at: 0,
        error: null,
        snapshot: {
          selfNodeId: "self",
          tailnetName: "example",
          peers: [
            peer({}),
            peer({ nodeId: "self", hostname: "control" }),
            peer({ nodeId: "n3", hostname: "linux", os: "linux", sshHostKeys: ["k"] }),
            peer({ nodeId: "n4", hostname: "phone", os: "iOS" }),
            peer({ nodeId: "n5", hostname: "old", os: "windows" }),
          ],
        },
      },
      ignoredNodeIds: new Set(["n5"]),
      states: new Map(),
      now: 1000,
    });
    expect(view.machines[0]).toMatchObject({ id: "m1", os: "macos", tailnet: { nodeId: "n1" } });
    expect(view.machines[0]?.connection).toEqual({ state: "connected", checkedAt: 0 });
    expect(view.machines[0]?.diagnostics?.checks.length).toBeGreaterThan(0);
    expect(view.discovered.map((p) => [p.name, p.tailscaleSsh])).toEqual([["linux", true]]);
    expect(view.ignored.map((p) => p.name)).toEqual(["old"]);
    expect(view.tailnet).toEqual({ name: "example", at: 0, stale: false, error: null });
  });

  test("health becomes stale after a failed check or 150 seconds", () => {
    const base = {
      machines: [machine()],
      tailnet: { at: null, snapshot: null, error: "down" },
      ignoredNodeIds: new Set<string>(),
      states: new Map(),
    };
    const failed = deriveYard({
      ...base,
      observations: new Map([
        ["m1", { report: { at: 0, value: report }, error: { at: 5, value: "x" } }],
      ]),
      now: 10,
    });
    expect(failed.machines[0]?.health?.stale).toBe(true);
    const old = deriveYard({
      ...base,
      observations: new Map([["m1", { report: { at: 0, value: report }, error: null }]]),
      now: 150_001,
    });
    expect(old.machines[0]?.health?.stale).toBe(true);
    expect(old.tailnet.stale).toBe(true);
  });

  test("collects alerts from monitoring state", () => {
    const state = newMachineState("Mini");
    state.offlineAlert = 0;
    const view = deriveYard({
      machines: [machine()],
      observations: new Map(),
      tailnet: {
        at: 100,
        snapshot: { selfNodeId: null, tailnetName: null, peers: [peer({ online: false })] },
        error: null,
      },
      ignoredNodeIds: new Set(),
      states: new Map([["m1", state]]),
      now: 100,
    });
    expect(view.alerts).toMatchObject([{ id: "m1:offline", kind: "offline", stale: false }]);
  });
});
