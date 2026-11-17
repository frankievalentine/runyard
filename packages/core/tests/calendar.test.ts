import { expect, test } from "vite-plus/test";
import {
  calendarWeeks,
  countByDay,
  countByHour,
  HOUR_MS,
  mergeHours,
  shadeOf,
  shadeThresholds,
  type JobRecord,
} from "../src/index.ts";

const T = Date.UTC(2026, 10, 16, 15, 0); // Mon 16 Nov 2026, 15:00 UTC
const job = (over: Partial<JobRecord>): JobRecord => ({
  id: crypto.randomUUID(),
  forgeId: "gh",
  repo: "acme/app",
  jobId: 1,
  runId: 1,
  runAttempt: 1,
  name: "build",
  workflow: "CI",
  runnerName: "r1",
  machineId: null,
  poolId: null,
  startedAt: T - 10 * 60_000,
  finishedAt: T + 5 * 60_000,
  conclusion: "success",
  htmlUrl: null,
  test: false,
  hook: null,
  sources: ["webhook"],
  ...over,
});

test("counts finished jobs by the hour they finished, with failures and cancellations", () => {
  const hours = countByHour(
    [
      job({}),
      job({ conclusion: "failure", finishedAt: T + 50 * 60_000 }),
      job({ conclusion: "cancelled", finishedAt: T + HOUR_MS + 1 }),
      job({ conclusion: "skipped", finishedAt: T + HOUR_MS + 2 }),
      // Still running: not counted.
      job({ conclusion: null, finishedAt: null }),
      // The runner never reported its end: a failure.
      job({ hook: "started", conclusion: "success", finishedAt: T - 2 * HOUR_MS }),
    ],
    T + 3 * HOUR_MS,
  );
  expect(hours).toEqual([
    { hour: T - 2 * HOUR_MS, jobs: 1, failed: 1, cancelled: 0 },
    { hour: T, jobs: 2, failed: 1, cancelled: 0 },
    { hour: T + HOUR_MS, jobs: 2, failed: 0, cancelled: 2 },
  ]);
});

test("adds rolled-up and live counts for the same hour", () => {
  expect(
    mergeHours(
      [{ hour: T, jobs: 3, failed: 1, cancelled: 0 }],
      [
        { hour: T, jobs: 2, failed: 0, cancelled: 1 },
        { hour: T - HOUR_MS, jobs: 1, failed: 0, cancelled: 0 },
      ],
    ),
  ).toEqual([
    { hour: T - HOUR_MS, jobs: 1, failed: 0, cancelled: 0 },
    { hour: T, jobs: 5, failed: 1, cancelled: 1 },
  ]);
});

test("groups hours into the viewer's days", () => {
  // A viewer eight hours behind UTC: 03:00 UTC on the 17th is still the 16th.
  const pacific = (ms: number) => new Date(ms - 8 * HOUR_MS).toISOString().slice(0, 10);
  const days = countByDay(
    [
      { hour: Date.UTC(2026, 10, 16, 20), jobs: 2, failed: 1, cancelled: 0 },
      { hour: Date.UTC(2026, 10, 17, 3), jobs: 3, failed: 0, cancelled: 1 },
      { hour: Date.UTC(2026, 10, 17, 9), jobs: 4, failed: 0, cancelled: 0 },
    ],
    pacific,
  );
  expect(Object.fromEntries(days)).toEqual({
    "2026-11-16": { jobs: 5, failed: 1, cancelled: 1 },
    "2026-11-17": { jobs: 4, failed: 0, cancelled: 0 },
  });
});

test("lays out weeks Sunday to Saturday, ending with today's week", () => {
  const weeks = calendarWeeks({ year: 2026, month: 11, day: 16 }, 3);
  expect(weeks).toHaveLength(3);
  expect(weeks[0]![0]).toBe("2026-11-01");
  expect(weeks[2]).toEqual(["2026-11-15", "2026-11-16", null, null, null, null, null]);
  // Across a month and year boundary.
  expect(calendarWeeks({ year: 2027, month: 1, day: 2 }, 1)[0]).toEqual([
    "2026-12-27",
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
  ]);
});

test("shades days by the quartiles of the busy ones", () => {
  const t = shadeThresholds([0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(t).toEqual([1, 3, 5, 7]);
  expect([0, 1, 2, 3, 5, 7, 99].map((n) => shadeOf(n, t))).toEqual([0, 1, 1, 2, 3, 4, 4]);
  // No jobs at all: everything empty.
  expect(shadeOf(0, shadeThresholds([0, 0]))).toBe(0);
});
