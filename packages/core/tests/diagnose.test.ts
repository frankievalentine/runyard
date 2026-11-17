import { describe, expect, test } from "vite-plus/test";
import {
  diagnoseJob,
  failingExcerpt,
  maskSecrets,
  type JobRecord,
  type MachineView,
} from "../src/index.ts";

const NOW = Date.UTC(2026, 10, 17, 12, 0);
const job = (over: Partial<JobRecord> = {}): JobRecord => ({
  id: "j1",
  forgeId: "gh",
  repo: "acme/app",
  jobId: 7,
  runId: 3,
  runAttempt: 1,
  name: "test",
  workflow: "ci",
  runnerName: "mini-1",
  machineId: "m1",
  poolId: "p1",
  startedAt: NOW - 20 * 60_000,
  finishedAt: NOW - 10 * 60_000,
  conclusion: "failure",
  htmlUrl: "https://github.com/acme/app/actions/runs/3/job/7",
  test: false,
  hook: null,
  sources: ["api"],
  ...over,
});

/** A GitHub job log: timestamped lines, a group per step, `##[error]` where it failed. */
const githubLog = (failing: string[]) =>
  [
    "##[group]Run actions/checkout@v7",
    "Syncing repository: acme/app",
    "##[endgroup]",
    "##[group]Run npm ci",
    "added 312 packages in 9s",
    "##[endgroup]",
    "##[group]Run npm run test",
    "> vitest run",
    ...failing,
    "##[error]Process completed with exit code 1.",
    "Post job cleanup.",
  ]
    .map((l, i) => `2026-11-17T11:50:${String(i % 60).padStart(2, "0")}.1234567Z ${l}`)
    .join("\n");

describe("a failed job's log", () => {
  test("is cut to the step that failed, without timestamps", () => {
    const e = failingExcerpt(githubLog(["FAIL src/app.test.ts > adds", "AssertionError: 1 !== 2"]));
    expect(e.step).toBe("npm run test");
    expect(e.lines[0]).toBe("##[group]Run npm run test");
    expect(e.lines).toContain("AssertionError: 1 !== 2");
    expect(e.lines).toContain("##[error]Process completed with exit code 1.");
    expect(e.lines.join("\n")).not.toContain("npm ci");
    expect(e.truncated).toBe(true);
  });

  test("keeps the end of a long step, where its errors are", () => {
    const noise = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const e = failingExcerpt(githubLog([...noise, "Error: boom"]), 50);
    expect(e.lines).toHaveLength(50);
    expect(e.lines).toContain("Error: boom");
    expect(e.lines).not.toContain("line 0");
  });

  test("finds forgejo-runner's failed step", () => {
    const log = [
      "⭐ Run Main actions/checkout",
      "  ✅  Success - Main actions/checkout",
      "⭐ Run Main make test",
      "| go test ./...",
      "| --- FAIL: TestAdd",
      "  ❌  Failure - Main make test",
      "exitcode '2': failure",
    ].join("\n");
    const e = failingExcerpt(log);
    expect(e.step).toBe("Main make test");
    expect(e.lines).toContain("| --- FAIL: TestAdd");
  });

  test("without an error marker, gives the last lines", () => {
    const e = failingExcerpt(Array.from({ length: 300 }, (_, i) => `l${i}`).join("\n"), 100);
    expect(e.step).toBeNull();
    expect(e.lines.at(-1)).toBe("l299");
    expect(e.lines).toHaveLength(100);
  });

  test("masks tokens and keys a job printed by mistake", () => {
    const { text, masked } = maskSecrets(
      [
        "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "Authorization: Bearer abc123def456ghi789",
        "AWS AKIAIOSFODNN7EXAMPLE",
        "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----",
        "runyard ryd_0123456789abcdefghij",
        "the build passed in 12s",
      ].join("\n"),
    );
    expect(masked).toBe(5);
    expect(text).not.toMatch(/ghp_|abc123def456|AKIA|b3BlbnNzaC1rZXk|ryd_0123/);
    expect(text).toContain("the build passed in 12s");
    expect(failingExcerpt("npm_abcdefghijklmnopqrstuvwxyz0123456789").masked).toBe(1);
  });
});

describe("diagnosing a failed job", () => {
  const machine = (over: Partial<MachineView> = {}) =>
    ({
      id: "m1",
      name: "Mini",
      connection: { state: "connected", checkedAt: NOW },
      alerts: [],
      readiness: null,
      ...over,
    }) as MachineView;

  test("a failing test is the code's", () => {
    const d = diagnoseJob({
      job: job(),
      now: NOW,
      machine: machine(),
      log: githubLog(["AssertionError: 1 !== 2"]),
    });
    expect(d.verdict).toBe("code");
    expect(d.machineNow).toEqual([]);
  });

  test("a full disk, a killed process or a vanished runner is the machine's", () => {
    for (const line of [
      "Error: ENOSPC: no space left on device, write",
      "Process exited with exit code 137",
      "The runner has received a shutdown signal.",
      "bash: line 1: make: command not found",
    ]) {
      const d = diagnoseJob({ job: job(), now: NOW, log: githubLog([line]) });
      expect(d.verdict, line).toBe("machine");
    }
    // A hook saw it start, and the forge finished it without the runner.
    const lost = job({ hook: "started", finishedAt: NOW - 60 * 60_000 });
    expect(diagnoseJob({ job: lost, now: NOW }).verdict).toBe("machine");
  });

  test("a job that passed on a rerun is flaky", () => {
    const d = diagnoseJob({
      job: job(),
      now: NOW,
      log: githubLog(["Error: socket hang up"]),
      passedOnRerun: true,
    });
    expect(d.verdict).toBe("flaky");
  });

  test("reports the machine's problems now beside the verdict", () => {
    const d = diagnoseJob({
      job: job(),
      now: NOW,
      machine: machine({
        connection: { state: "offline", lastSeen: NOW - 5 * 60_000 },
        alerts: [
          {
            id: "a",
            machineId: "m1",
            machineName: "Mini",
            kind: "lowDisk",
            since: NOW,
            detail: "4% of / free",
            stale: false,
            muted: false,
          },
        ],
      }),
      runner: { status: "offline" },
      log: githubLog(["AssertionError"]),
    });
    expect(d.verdict).toBe("code");
    expect(d.machineNow).toEqual([
      "Mini is offline.",
      "Mini: 4% of / free",
      "The runner mini-1 is offline.",
    ]);
  });

  test("a timeout or a missing log is unclear", () => {
    expect(diagnoseJob({ job: job({ conclusion: "timed_out" }), now: NOW }).verdict).toBe(
      "unknown",
    );
    const gone = diagnoseJob({ job: job(), now: NOW });
    expect(gone).toMatchObject({
      verdict: "unknown",
      reasons: ["The forge no longer has the log."],
    });
  });
});
