import { describe, expect, test } from "vite-plus/test";
import {
  alerts,
  MAINTENANCE_MS,
  newMachineState,
  observe,
  type DiskStats,
  type MachineState,
  type Observed,
} from "../../src/index.ts";

const MIN = 60_000;
const GIB = 1_073_741_824;

function seen(over: Partial<Observed> = {}): Observed {
  return {
    name: "mini",
    tailnetOnline: true,
    connection: { state: "pending" },
    health: null,
    ...over,
  };
}

function health(asOf: number, disks: DiskStats[], bootId: string | null = "B1") {
  return { asOf, stale: false, bootId, disks };
}

const disk = (free: number, total = 100 * GIB, mountPoint = "/"): DiskStats => ({
  mountPoint,
  totalBytes: total,
  availableBytes: free * GIB,
});

/** Feeds a sequence of tailnet observations, one per `every` ms, returning every change. */
function tailnet(state: MachineState, steps: (boolean | null)[], every = 15_000, start = 0) {
  return steps.flatMap((online, i) => {
    const at = start + i * every;
    return observe(state, seen({ tailnetOnline: online ?? true }), online === null ? null : at, at);
  });
}

describe("offline alerts", () => {
  test("alert after three continuous minutes offline, then recover", () => {
    const state = newMachineState("mini");
    const changes = tailnet(state, [true, ...Array<boolean>(14).fill(false)]);
    expect(changes.map((c) => c.kind)).toEqual(["offline", "offlineAlert"]);
    expect(alerts(state, "m1", seen({ tailnetOnline: false }), true, 14 * 15_000)).toMatchObject([
      { kind: "offline", since: 15_000, stale: false },
    ]);
    const back = observe(state, seen({ tailnetOnline: true }), 15 * 15_000, 15 * 15_000);
    expect(back).toMatchObject([{ kind: "online", notify: true }]);
    expect(alerts(state, "m1", seen(), true, 15 * 15_000)).toEqual([]);
  });

  test("a gap in tailnet observations restarts the clock", () => {
    const state = newMachineState("mini");
    tailnet(state, [true, false, false, false]);
    // 90 seconds without a reading, then still offline: the earlier time doesn't count.
    const later = tailnet(state, Array<boolean>(10).fill(false), 15_000, 3 * 15_000 + 90_000);
    expect(later.some((c) => c.kind === "offlineAlert")).toBe(false);
  });

  test("a tailnet outage on the control machine never accrues offline time", () => {
    const state = newMachineState("mini");
    const changes = tailnet(state, [true, false, ...Array<null>(20).fill(null), false]);
    expect(changes.some((c) => c.kind === "offlineAlert")).toBe(false);
  });
});

describe("disk alerts", () => {
  test("alert after distinct low readings a minute apart, clear only with margin", () => {
    const state = newMachineState("mini");
    expect(observe(state, seen({ health: health(0, [disk(5)]) }), null, 0)).toEqual([]);
    const low = observe(state, seen({ health: health(MIN, [disk(5)]) }), null, MIN);
    expect(low).toMatchObject([{ kind: "lowDisk", notify: true }]);
    expect(low[0]?.detail).toBe("/: 5.0% free (5.0 GiB of 100.0 GiB).");
    // 11% is above the threshold but inside the recovery margin.
    expect(observe(state, seen({ health: health(2 * MIN, [disk(11)]) }), null, 2 * MIN)).toEqual(
      [],
    );
    expect(
      alerts(state, "m1", seen({ health: health(2 * MIN, [disk(11)]) }), true, 2 * MIN),
    ).toHaveLength(1);
    const ok = observe(state, seen({ health: health(3 * MIN, [disk(12)]) }), null, 3 * MIN);
    expect(ok).toMatchObject([{ kind: "diskRecovered" }]);
  });

  test("the same reading twice doesn't count as two samples", () => {
    const state = newMachineState("mini");
    observe(state, seen({ health: health(0, [disk(5)]) }), null, 0);
    expect(observe(state, seen({ health: health(0, [disk(5)]) }), null, 5 * MIN)).toEqual([]);
  });

  test("equal readings on several mounts share one alert line", () => {
    const state = newMachineState("mini");
    const disks = [
      disk(5, 100 * GIB, "/"),
      disk(5, 100 * GIB, "/System/Volumes/Data"),
      disk(1, 50 * GIB, "/Volumes/X"),
    ];
    observe(state, seen({ health: health(0, disks) }), null, 0);
    observe(state, seen({ health: health(MIN, disks) }), null, MIN);
    const [alert] = alerts(state, "m1", seen({ health: health(MIN, disks) }), true, MIN);
    expect(alert?.detail.split("\n")).toEqual([
      "/Volumes/X: 2.0% free (1.0 GiB of 50.0 GiB).",
      "/, /System/Volumes/Data: 5.0% free (5.0 GiB of 100.0 GiB).",
    ]);
  });
});

describe("other transitions", () => {
  test("a new boot session is a reboot; the first one isn't", () => {
    const state = newMachineState("mini");
    expect(observe(state, seen({ health: health(0, [], "B1") }), null, 0)).toEqual([]);
    expect(observe(state, seen({ health: health(MIN, [], "B2") }), null, MIN)).toMatchObject([
      { kind: "rebooted" },
    ]);
  });

  test("SSH availability changes are recorded, pending isn't a change", () => {
    const state = newMachineState("mini");
    observe(state, seen({ connection: { state: "connected", checkedAt: 0 } }), null, 0);
    observe(state, seen({ connection: { state: "pending" } }), null, 1);
    expect(
      observe(state, seen({ connection: { state: "error", detail: "x" } }), null, 2),
    ).toMatchObject([{ kind: "sshUnavailable" }]);
  });

  test("maintenance mutes new alerts and announces them once it ends", () => {
    const state = newMachineState("mini");
    state.maintenanceUntil = 10 * MIN;
    observe(state, seen({ health: health(0, [disk(5)]) }), null, 0);
    expect(observe(state, seen({ health: health(MIN, [disk(5)]) }), null, MIN)).toMatchObject([
      { kind: "lowDisk", notify: false },
    ]);
    expect(alerts(state, "m1", seen({ health: health(MIN, [disk(5)]) }), true, MIN)[0]?.muted).toBe(
      true,
    );
    const after = observe(
      state,
      seen({ health: health(MAINTENANCE_MS, [disk(5)]) }),
      null,
      MAINTENANCE_MS,
    );
    expect(after.map((c) => [c.kind, c.notify])).toEqual([
      ["maintenanceEnded", false],
      ["alertsResumed", true],
    ]);
  });
});
