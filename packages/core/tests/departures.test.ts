import { expect, test } from "vite-plus/test";
import { departures, type YardView } from "../src/index.ts";

const runner = (key: string, activity: string, job: object | null, over: object = {}) => ({
  key,
  name: key,
  activity,
  scopeLabel: "acme",
  onDemand: null,
  job,
  ...over,
});
const queued = (id: number, createdAt: number, eligible: string[], over: object = {}) => ({
  id,
  forge: "github",
  repo: "acme/app",
  name: `job-${id}`,
  labels: ["self-hosted", "linux"],
  createdAt,
  onDemand: null,
  eligible,
  ...over,
});
const view = (runners: unknown[], jobs: unknown[], boat: unknown = null) =>
  ({
    runners,
    machines: [],
    boat,
    queue: { jobs, complete: true, at: 0 },
    pools: { pools: [], dispatches: [], desired: [], templateRecords: [] },
  }) as unknown as YardView;

test("running jobs come first, longest running first, then waiting jobs, longest waiting first", () => {
  const rows = departures(
    view(
      [
        runner("r2", "busy", { name: "e2e", repo: "acme/web", startedAt: 200, labels: [] }),
        runner("r1", "busy", { name: "build", repo: "acme/app", startedAt: 100, labels: [] }),
        runner("r3", "idle", null),
        // A Forgejo runner whose job the forge didn't name.
        runner("rack-01", "busy", null, { scopeLabel: "yard-club" }),
      ],
      [queued(2, 50, []), queued(1, 20, ["r3"])],
    ),
  );
  expect(rows.map((r) => [r.kind, r.job, r.platform, r.status, r.sign, r.tone])).toEqual([
    ["running", "Job details unavailable", "rack-01", "On its way", "On its way", "moving"],
    ["running", "build", "r1", "On its way", "On its way", "moving"],
    ["running", "e2e", "r2", "On its way", "On its way", "moving"],
    ["waiting", "job-1", "r3", "1 idle runner matches", "Boarding · 1 match", "neutral"],
    ["waiting", "job-2", "", "No matching runner online", "No linux runner", "held"],
  ]);
});

test("on-demand jobs say where they'll start, or what holds them", () => {
  const boat = {
    limits: { atConcurrencyLimit: false, atStartLimit: false, maxActiveSandboxes: 4 },
  };
  const job = queued(1, 10, [], { onDemand: "boat.dev" });
  expect(departures(view([], [job], boat))[0]).toMatchObject({
    status: "Starts on boat.dev",
    sign: "Starts on boat.dev",
    platform: "boat.dev",
    tone: "neutral",
  });
  const full = { limits: { ...boat.limits, atConcurrencyLimit: true } };
  expect(departures(view([], [job], full))[0]).toMatchObject({
    status: "Waiting: boat.dev is at 4 VMs",
    tone: "held",
  });
});

test("matching runners that are all busy hold a job up", () => {
  const rows = departures(
    view(
      [runner("r1", "busy", { name: "build", repo: "acme/app", startedAt: 1, labels: [] })],
      [queued(1, 5, ["r1"])],
    ),
  );
  expect(rows[1]).toMatchObject({
    status: "1 matching, all busy",
    sign: "Waiting · all busy",
    tone: "held",
  });
});
