import { describe, expect, test } from "bun:test";
import { HOUR_MS, JOB_RETENTION_MS, type HourCount, type JobObservation } from "@runyard/core";
import { openDatabase } from "../db/index.ts";
import { jobHours } from "../db/schema.ts";
import { setup } from "../pools/test-helpers.ts";
import { jobHoursSince, pruneJobs, recordJob } from "./store.ts";

const DAY = 24 * HOUR_MS;
const hour = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS;

/** A finished job, recorded as of `at`. */
function finished(
  db: ReturnType<typeof openDatabase>,
  at: number,
  conclusion: "success" | "failure" | "cancelled",
  runId: number,
) {
  const o: JobObservation = {
    source: "webhook",
    forgeId: "gh",
    repo: "acme/app",
    runId,
    runAttempt: 1,
    jobId: runId,
    name: "build",
    startedAt: at - 60_000,
    finishedAt: at,
    conclusion,
  };
  recordJob(db, o, at);
}

const total = (hours: HourCount[]) =>
  hours.reduce(
    (t, h) => ({
      jobs: t.jobs + h.jobs,
      failed: t.failed + h.failed,
      cancelled: t.cancelled + h.cancelled,
    }),
    { jobs: 0, failed: 0, cancelled: 0 },
  );

describe("traffic calendar", () => {
  test("pruning moves a job's count into its hour, so it's counted once before and after", () => {
    const db = openDatabase(":memory:");
    const now = Date.UTC(2026, 10, 16, 12);
    const old = now - JOB_RETENTION_MS - 2 * DAY;
    finished(db, old, "success", 1);
    finished(db, old + 10 * 60_000, "failure", 2);
    finished(db, now - DAY, "cancelled", 3);

    const before = jobHoursSince(db, now - 60 * DAY, now);
    expect(before.stored).toEqual([]);
    expect(total(before.live)).toEqual({ jobs: 3, failed: 1, cancelled: 1 });

    pruneJobs(db, now);
    const after = jobHoursSince(db, now - 60 * DAY, now);
    expect(after.stored).toEqual([{ hour: hour(old), jobs: 2, failed: 1, cancelled: 0 }]);
    expect(total(after.live)).toEqual({ jobs: 1, failed: 0, cancelled: 1 });
    expect(after.earliest).toBe(hour(old));

    // Pruning again adds nothing: the jobs are gone from the record.
    pruneJobs(db, now);
    expect(jobHoursSince(db, now - 60 * DAY, now).stored[0]?.jobs).toBe(2);
  });

  test("hours older than 53 weeks are dropped", () => {
    const db = openDatabase(":memory:");
    const now = Date.UTC(2026, 10, 16, 12);
    db.insert(jobHours)
      .values([
        { hour: hour(now - 54 * 7 * DAY), jobs: 4, failed: 0, cancelled: 0 },
        { hour: hour(now - 52 * 7 * DAY), jobs: 5, failed: 1, cancelled: 0 },
      ])
      .run();
    pruneJobs(db, now);
    expect(jobHoursSince(db, 0, now).stored.map((h) => h.jobs)).toEqual([5]);
  });

  test("the endpoint returns stored and live hours together, for up to 53 weeks", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    const now = Date.now();
    finished(s.deps.db, now - 2 * HOUR_MS, "success", 11);
    s.deps.db
      .insert(jobHours)
      .values({ hour: hour(now - 40 * DAY), jobs: 7, failed: 2, cancelled: 1 })
      .run();
    const res = await s.call<{ weeks: number; hours: HourCount[]; earliest: number }>(
      "GET",
      "/api/jobs/calendar?weeks=99",
    );
    expect(res.weeks).toBe(53);
    expect(total(res.hours)).toEqual({ jobs: 8, failed: 2, cancelled: 1 });
    expect(res.earliest).toBe(hour(now - 40 * DAY));
  });
});
