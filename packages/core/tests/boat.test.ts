import { describe, expect, test } from "vite-plus/test";
import {
  boatJobId,
  boatVmsByRunner,
  deriveBoat,
  type BoatObservation,
  type BoatSandbox,
  type RunnerView,
} from "../src/index.ts";

const NOW = 10_000_000;
const sandbox = (over: Partial<BoatSandbox> = {}): BoatSandbox => ({
  id: "bx_23456789",
  name: "ci-app-301",
  state: "running",
  type: "default",
  vcpu: 4,
  memoryGB: 8,
  createdAt: NOW - 60_000,
  dollars: 0.0006,
  ...over,
});
const obs = (sandboxes: BoatSandbox[], over: Partial<BoatObservation> = {}): BoatObservation => ({
  sandboxes: { at: NOW, value: sandboxes },
  limits: {
    at: NOW,
    value: {
      activeSandboxes: 2,
      maxActiveSandboxes: 100,
      startsThisMinute: { used: 3, limit: 12 },
      plan: "box_20",
    },
  },
  error: null,
  ...over,
});
const boatRunner = (jobId: number) =>
  ({ key: `k${jobId}`, onDemand: "boat", job: { id: jobId } }) as unknown as RunnerView;

describe("boat", () => {
  test("reads the job ID from boat's CI VM names", () => {
    expect(boatJobId("ci-acme-app-301")).toBe(301);
    expect(boatJobId("scratch")).toBeNull();
    expect(boatJobId("ci-app")).toBeNull();
  });

  test("matches running VMs to boat runners by job ID", () => {
    const view = deriveBoat(obs([sandbox()]), [boatRunner(301)], NOW);
    expect(view.running.map((v) => [v.id, v.jobId, v.size, v.dollars])).toEqual([
      ["bx_23456789", 301, "4 vCPU, 8 GB", 0.0006],
    ]);
    expect(Object.fromEntries(boatVmsByRunner(view, [boatRunner(301)]))).toMatchObject({
      k301: { id: "bx_23456789" },
    });
    expect(view.leftover).toEqual([]);
  });

  test("left running: VMs outside CI, and CI VMs without a running job after the grace period", () => {
    const view = deriveBoat(
      obs([
        sandbox({ id: "bx_scratch2", name: "scratch", createdAt: NOW - 3_600_000 }),
        sandbox({ id: "bx_justnow", name: "ci-app-401", createdAt: NOW - 60_000 }),
        sandbox({ id: "bx_lingers", name: "ci-app-402", createdAt: NOW - 20 * 60_000 }),
        sandbox({ id: "bx_stopped", name: "old", state: "archived" }),
      ]),
      [],
      NOW,
    );
    expect(view.running.map((v) => v.id)).toEqual(["bx_scratch2", "bx_lingers", "bx_justnow"]);
    expect(view.leftover.map((v) => v.id)).toEqual(["bx_scratch2", "bx_lingers"]);
  });

  test("capacity flags, and stale data hides left-running VMs", () => {
    const full = deriveBoat(
      obs([], {
        limits: {
          at: NOW,
          value: {
            activeSandboxes: 2,
            maxActiveSandboxes: 2,
            startsThisMinute: { used: 12, limit: 12 },
            plan: "box_20",
          },
        },
      }),
      [],
      NOW,
    );
    expect(full.limits).toMatchObject({ atConcurrencyLimit: true, atStartLimit: true });
    const stale = deriveBoat(
      {
        ...obs([sandbox({ name: "scratch" })]),
        sandboxes: { at: NOW - 600_000, value: [sandbox({ name: "scratch" })] },
      },
      [],
      NOW,
    );
    expect(stale).toMatchObject({ stale: true, leftover: [] });
  });
});
