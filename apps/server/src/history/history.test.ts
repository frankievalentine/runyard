import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { JobCounts, JobRecord } from "@runyard/core";
import { inspectionScript } from "../machines/ssh.ts";
import { createMachine } from "../machines/store.ts";
import { setup, type Setup } from "../pools/test-helpers.ts";

type Jobs = { counts: JobCounts; jobs: JobRecord[] };

const sign = (secret: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

async function withWebhook() {
  const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
  s.fakeGithub.runs.set("acme/app", []);
  await s.raw("POST", `/api/webhooks/github/${s.forgeId}`, { url: "https://mini.tail1.ts.net/" });
  return { s, secret: s.fakeGithub.hook.secret! };
}

function deliver(s: Setup, secret: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return s.receiver.handle(
    new Request("http://127.0.0.1:7444/webhooks/github", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_job",
        "x-github-hook-installation-target-id": s.fakeGithub.appId,
        "x-github-delivery": crypto.randomUUID(),
        "x-hub-signature-256": sign(secret, body),
      },
    }),
  );
}

const job = (over: object) => ({
  id: 501,
  run_id: 77,
  run_attempt: 1,
  name: "build",
  workflow_name: "CI",
  runner_name: "mini-mac-01",
  labels: ["self-hosted", "runyard-mac"],
  status: "completed",
  conclusion: "success",
  started_at: "2026-10-29T10:00:00Z",
  completed_at: "2026-10-29T10:01:30Z",
  html_url: "https://github.test/acme/app/actions/runs/77/job/501",
  ...over,
});

describe("run history", () => {
  test("a signed workflow_job delivery is recorded with its runner and result", async () => {
    const { s, secret } = await withWebhook();
    expect(
      (
        await deliver(s, secret, {
          workflow_job: job({ status: "in_progress", conclusion: null }),
          repository: { full_name: "acme/app" },
        })
      ).status,
    ).toBe(202);
    expect((await s.call<Jobs>("GET", "/api/jobs")).counts.running).toBe(1);
    await deliver(s, secret, { workflow_job: job({}), repository: { full_name: "acme/app" } });
    const { jobs, counts } = await s.call<Jobs>("GET", "/api/jobs");
    expect(counts).toMatchObject({ passed: 1, running: 0 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      jobId: 501,
      name: "build",
      runnerName: "mini-mac-01",
      conclusion: "success",
      startedAt: Date.parse("2026-10-29T10:00:00Z"),
      finishedAt: Date.parse("2026-10-29T10:01:30Z"),
      sources: ["webhook"],
    });
    // A job on a GitHub-hosted runner isn't Runyard's to show.
    await deliver(s, secret, {
      workflow_job: job({ id: 502, labels: ["ubuntu-latest"], runner_name: "GitHub Actions 3" }),
      repository: { full_name: "acme/app" },
    });
    expect((await s.call<Jobs>("GET", "/api/jobs")).jobs).toHaveLength(1);
  });

  test("hook lines from a machine, then one GitHub read for the result and the log", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    const at = Date.parse("2026-10-29T10:00:00Z");
    s.history.fromHooks(s.machine.id, [
      {
        at,
        event: "started",
        runnerName: "mini-mac-01",
        repo: "acme/app",
        runId: 77,
        runAttempt: 1,
        workflow: "CI",
      },
      {
        at: at + 90_000,
        event: "completed",
        runnerName: "mini-mac-01",
        repo: "acme/app",
        runId: 77,
        runAttempt: 1,
        workflow: "CI",
      },
    ]);
    let { jobs, counts } = await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}`);
    expect(counts.unknown).toBe(1);
    expect(jobs[0]).toMatchObject({ jobId: null, hook: "completed", machineId: s.machine.id });

    s.fakeGithub.runs.set("acme/app", [
      {
        id: 77,
        status: "completed",
        jobs: [
          {
            id: 501,
            name: "build",
            status: "completed",
            conclusion: "failure",
            labels: ["self-hosted"],
            runner_name: "mini-mac-01",
            created_at: "2026-10-29T09:59:50Z",
            started_at: "2026-10-29T10:00:00Z",
            completed_at: "2026-10-29T10:01:30Z",
          },
        ],
      },
    ]);
    await s.history.fillResults([]);
    ({ jobs, counts } = await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}`));
    expect(counts).toMatchObject({ failed: 1, unknown: 0 });
    expect(jobs[0]).toMatchObject({
      jobId: 501,
      name: "build",
      conclusion: "failure",
      sources: ["api", "hook"],
    });
    expect(
      (await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}&failures=1`)).jobs,
    ).toHaveLength(1);

    s.fakeGithub.logs.set(501, "Run make\nerror: it broke\n");
    expect(await s.call<{ log: string }>("GET", `/api/jobs/${jobs[0]!.id}/log`)).toEqual({
      log: "Run make\nerror: it broke\n",
    });
    s.fakeGithub.logs.delete(501);
    expect((await s.raw("GET", `/api/jobs/${jobs[0]!.id}/log`)).status).toBe(404);
  });

  test("a job whose runner never reported its end counts as lost, a machine problem", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    const at = Date.parse("2026-10-29T10:00:00Z");
    s.history.fromHooks(s.machine.id, [
      {
        at,
        event: "started",
        runnerName: "mini-mac-01",
        repo: "acme/app",
        runId: 78,
        runAttempt: 1,
        workflow: "CI",
      },
    ]);
    s.fakeGithub.runs.set("acme/app", [
      {
        id: 78,
        status: "completed",
        jobs: [
          {
            id: 601,
            name: "e2e",
            status: "completed",
            conclusion: "failure",
            labels: ["self-hosted"],
            runner_name: "mini-mac-01",
            created_at: "2026-10-29T09:59:50Z",
            completed_at: "2026-10-29T10:20:00Z",
          },
        ],
      },
    ]);
    await s.history.fillResults([]);
    const { jobs } = await s.call<Jobs>("GET", `/api/jobs?machine=${s.machine.id}`);
    expect(jobs[0]).toMatchObject({ hook: "started", conclusion: "failure" });
  });

  test("the minute check asks only for log lines since the last one read", () => {
    expect(inspectionScript(false, [], 1_800_000_000)).toContain("RUNYARD_JOBS_SINCE=1800000000");
    expect(inspectionScript(false, [], 1_800_000_000)).toContain(".runyard-jobs.log");
    expect(inspectionScript(true, [], 1_800_000_000)).toContain("$RunyardJobsSince = 1800000000");
    expect(inspectionScript(true, [], 1)).toContain("Runyard\\runners\\.runyard-jobs.log");
  });

  test("a Windows machine's job log reaches run history through the minute check", async () => {
    const s = await setup({ account: "acme", type: "Organization", repos: ["acme/app"] });
    const at = Math.floor(Date.now() / 1000);
    s.fake.machines.set(
      "ci@win",
      [
        "RFM\tos\twindows",
        "RFM\tdisk\tC:\\\t100\t50",
        "RFM_END",
        "RFM\tdiag:complete\t1",
        `RFJ\t${at}\tstarted\twin-win-01\tacme/app\t91\t1\tCI`,
        `RFJ\t${at + 60}\tcompleted\twin-win-01\tacme/app\t91\t1\tCI`,
        "",
      ].join("\r\n"),
    );
    const win = createMachine(s.deps.db, {
      name: "Win",
      sshTarget: "ci@win",
      transport: "openssh",
      expectedOs: "windows",
    });
    await s.monitor.checkMachines();
    const { jobs } = await s.call<Jobs>("GET", `/api/jobs?machine=${win.id}`);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      runnerName: "win-win-01",
      repo: "acme/app",
      workflow: "CI",
      hook: "completed",
    });
  });
});
