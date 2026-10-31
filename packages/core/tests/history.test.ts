import { expect, test } from "vite-plus/test";
import {
  countJobs,
  forgejoConclusion,
  isLost,
  jobResult,
  mergeJob,
  parseForgejoLines,
  parseHookLines,
  type JobObservation,
  type JobRecord,
} from "../src/index.ts";

const base = { forgeId: "gh", repo: "acme/app", runId: 7, runAttempt: 1 };
const obs = (over: Partial<JobObservation>): JobObservation => ({
  ...base,
  source: "webhook",
  ...over,
});

test("records from several sources merge: known values win, earliest start, latest end", () => {
  const started = mergeJob(
    undefined,
    obs({
      source: "hook",
      hook: "started",
      runnerName: "lxc-01",
      startedAt: 2_000,
      machineId: "m1",
    }),
    "j1",
  );
  expect(started).toMatchObject({ jobId: null, hook: "started", sources: ["hook"] });
  const named = mergeJob(
    started,
    obs({ jobId: 42, name: "check", startedAt: 1_500, conclusion: null }),
    "other",
  );
  expect(named).toMatchObject({
    id: "j1",
    jobId: 42,
    name: "check",
    runnerName: "lxc-01",
    machineId: "m1",
    startedAt: 1_500,
    sources: ["hook", "webhook"],
  });
  const done = mergeJob(named, obs({ source: "hook", hook: "completed", finishedAt: 9_000 }), "x");
  const finished = mergeJob(done, obs({ conclusion: "success", finishedAt: 8_000 }), "x");
  expect(finished).toMatchObject({ hook: "completed", finishedAt: 9_000, conclusion: "success" });
  // A late start line doesn't undo the end.
  expect(mergeJob(finished, obs({ source: "hook", hook: "started" }), "x").hook).toBe("completed");
});

test("a job whose runner never reported its end is lost, after a grace period", () => {
  const job = {
    ...base,
    id: "j",
    jobId: 1,
    name: "e2e",
    workflow: null,
    runnerName: "lxc-01",
    machineId: "m1",
    poolId: "p1",
    startedAt: 0,
    finishedAt: 10_000,
    conclusion: "failure",
    htmlUrl: null,
    test: false,
    hook: "started",
    sources: ["hook", "webhook"],
  } satisfies JobRecord;
  expect(isLost(job, 10_000 + 60_000)).toBe(false);
  expect(isLost(job, 10_000 + 6 * 60_000)).toBe(true);
  expect(jobResult(job, 10_000 + 6 * 60_000)).toBe("lost");
  expect(isLost({ ...job, hook: "completed" }, 10_000 + 6 * 60_000)).toBe(false);
  // Without hooks nothing says it was lost.
  expect(isLost({ ...job, hook: null }, 10_000 + 6 * 60_000)).toBe(false);
  expect(jobResult({ ...job, hook: null }, 0)).toBe("failed");
});

test("counts for the summary line", () => {
  const j = (conclusion: JobRecord["conclusion"], finishedAt: number | null) =>
    ({ conclusion, finishedAt, hook: null }) as JobRecord;
  expect(
    countJobs(
      [
        j("success", 1),
        j("success", 1),
        j("failure", 1),
        j("timed_out", 1),
        j("cancelled", 1),
        j(null, null),
        j(null, 1),
      ],
      0,
    ),
  ).toEqual({ passed: 2, failed: 2, cancelled: 1, running: 1, unknown: 1 });
});

test("hook log lines from Windows parse without their carriage returns", () => {
  expect(
    parseHookLines(
      "1800000000\tstarted\twin-01\tacme/app\t9001\t1\tCI\r\n1800000030\tcompleted\twin-01\tacme/app\t9001\t1\t\r\n",
    ),
  ).toMatchObject([
    { event: "started", workflow: "CI" },
    { event: "completed", workflow: null },
  ]);
});

test("hook log lines parse, and malformed ones are skipped", () => {
  expect(
    parseHookLines(
      [
        "1800000000\tstarted\tlxc-check-01\tacme/app\t9001\t2\tCI",
        "1800000030\tcompleted\tlxc-check-01\tacme/app\t9001\t2\t",
        "garbage",
        "1800000040\tstarted\t\tacme/app\t9002\t1\tCI",
        "1800000050\tbegun\tr\tacme/app\t9003\t1\tCI",
        "x\tstarted\tr\tacme/app\t9004\t1\tCI",
      ].join("\n"),
    ),
  ).toEqual([
    {
      at: 1_800_000_000_000,
      event: "started",
      runnerName: "lxc-check-01",
      repo: "acme/app",
      runId: 9001,
      runAttempt: 2,
      workflow: "CI",
    },
    {
      at: 1_800_000_030_000,
      event: "completed",
      runnerName: "lxc-check-01",
      repo: "acme/app",
      runId: 9001,
      runAttempt: 2,
      workflow: null,
    },
  ]);
});

test("Forgejo runners' log lines: the task, runner and repository, at the time logged", () => {
  expect(
    parseForgejoLines(
      [
        "2026-10-30T19:49:30Z\tbox-ci-01\t1\tfrankie/test",
        "not a time\tbox-ci-01\t2\tfrankie/test",
        "2026-10-30T19:49:31Z\tbox-ci-01\tx\tfrankie/test",
        "2026-10-30T19:49:32Z\t\t3\tfrankie/test",
      ].join("\n"),
    ),
  ).toEqual([
    {
      at: Date.parse("2026-10-30T19:49:30Z"),
      runnerName: "box-ci-01",
      taskId: 1,
      repo: "frankie/test",
    },
  ]);
  expect(forgejoConclusion("success")).toBe("success");
  expect(forgejoConclusion("running")).toBeNull();
});

test("a run not known yet (0, from a Forgejo log line) doesn't replace a known one", () => {
  const known = mergeJob(
    undefined,
    obs({ forgeId: "fj", jobId: 5, runId: 3, source: "api" }),
    "j1",
  );
  expect(
    mergeJob(known, obs({ forgeId: "fj", jobId: 5, runId: 0, source: "hook" }), "j2").runId,
  ).toBe(3);
});
