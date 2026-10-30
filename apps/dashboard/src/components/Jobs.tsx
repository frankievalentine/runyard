import { jobResult, type JobCounts, type JobRecord } from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, call } from "../api.ts";
import { formatElapsed, timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import type { Tone } from "../lib/status.ts";
import { useYard } from "../lib/yard.ts";
import { Terminal } from "./Terminal.tsx";
import { Card, EmptyLine, ErrorText, Pill, Section } from "./ui.tsx";

type Filter = { machine?: string; pool?: string; runner?: string };
type JobsResponse = { days: number; counts: JobCounts; jobs: JobRecord[]; now: number };

export const JOB_RESULT: Record<ReturnType<typeof jobResult>, { tone: Tone; label: string }> = {
  passed: { tone: "ok", label: "Passed" },
  failed: { tone: "bad", label: "Failed" },
  cancelled: { tone: "muted", label: "Cancelled" },
  running: { tone: "busy", label: "Running" },
  unknown: { tone: "muted", label: "Result pending" },
  lost: { tone: "bad", label: "Runner lost" },
};

/** "41 passed · 2 failed · 1 cancelled", leaving out what's zero. */
export function countsLine(c: JobCounts): string {
  const parts = [
    c.passed && `${c.passed} passed`,
    c.failed && `${c.failed} failed`,
    c.cancelled && `${c.cancelled} cancelled`,
    c.running && `${c.running} running`,
    c.unknown && `${c.unknown} pending`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No jobs";
}

/** Run history's last 7 days for a machine, pool or runner, refreshed every 30 seconds. */
export function useJobs(filter: Filter, failures = false) {
  return useQuery({
    queryKey: ["jobs", filter, failures],
    queryFn: async () =>
      (await call(
        api.jobs.$get({ query: { ...filter, days: "7", ...(failures ? { failures: "1" } : {}) } }),
      )) as unknown as JobsResponse,
    refetchInterval: 30_000,
  });
}

/**
 * Run history for a machine, pool or runner: the last 7 days' counts and the
 * newest jobs, each with its result, how long it took and its log.
 */
export function Jobs({ filter, showMachine }: { filter: Filter; showMachine?: boolean }) {
  const [failures, setFailures] = useState(false);
  const [shown, setShown] = useState(10);
  const jobs = useJobs(filter, failures);
  const counts = jobs.data?.counts;
  return (
    <Section
      title="Jobs"
      action={
        <div className="flex items-center gap-3 text-[12px] text-ink-2">
          {counts && <span>Last 7 days: {countsLine(counts)}</span>}
          {counts && counts.failed > 0 && (
            <button
              type="button"
              onClick={() => setFailures(!failures)}
              className="font-medium text-accent hover:underline"
            >
              {failures ? "Show all" : "Failures only"}
            </button>
          )}
        </div>
      }
    >
      <Card className="overflow-hidden">
        {jobs.error && <ErrorText className="px-4 py-3" error={jobs.error} />}
        {jobs.data?.jobs.length === 0 && (
          <EmptyLine>
            {failures ? (
              "No failures in the last 7 days."
            ) : (
              <>
                No jobs in the last 7 days.
                <span className="mt-0.5 block text-[12px]">
                  Jobs appear here as they run, from webhooks or from the runners' hooks.
                </span>
              </>
            )}
          </EmptyLine>
        )}
        <ul className="divide-y divide-line">
          {jobs.data?.jobs.slice(0, shown).map((j) => (
            <JobRow key={j.id} job={j} showMachine={showMachine} />
          ))}
        </ul>
        {jobs.data && jobs.data.jobs.length > shown && (
          <button
            type="button"
            onClick={() => setShown(shown + 20)}
            className="w-full border-t border-line px-4 py-2 text-left text-[12.5px] font-medium text-accent hover:bg-hover"
          >
            Show {Math.min(20, jobs.data.jobs.length - shown)} more
          </button>
        )}
      </Card>
    </Section>
  );
}

function JobRow({ job, showMachine }: { job: JobRecord; showMachine?: boolean }) {
  const view = useYard();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const result = JOB_RESULT[jobResult(job, now)];
  const runner = job.runnerName
    ? view.runners.find((r) => r.name.toLowerCase() === job.runnerName!.toLowerCase())
    : undefined;
  const machine = showMachine ? view.machines.find((m) => m.id === job.machineId) : undefined;
  // Forgejo serves job logs from version 16; its jobs link to the run instead.
  const forgejo = view.forgejo.connections.some((c) => c.forgeId === job.forgeId);
  const took =
    job.startedAt && job.finishedAt
      ? `took ${formatElapsed(job.finishedAt - job.startedAt)}`
      : job.startedAt
        ? `for ${formatElapsed(now - job.startedAt)}`
        : null;
  const when = job.finishedAt ?? job.startedAt;
  const log = useQuery({
    queryKey: ["job-log", job.id],
    queryFn: async () =>
      (await call(api.jobs[":id"].log.$get({ param: { id: job.id } }))) as { log: string },
    enabled: open,
    retry: false,
  });
  return (
    <li className="px-4 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Pill tone={result.tone}>{result.label}</Pill>
        {job.htmlUrl ? (
          <a
            href={job.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium hover:underline"
          >
            {job.name ?? job.workflow ?? "Job"}
          </a>
        ) : (
          <span className="font-medium">{job.name ?? job.workflow ?? "Job"}</span>
        )}
        {job.test && (
          <Pill tone="info" hollow>
            Test
          </Pill>
        )}
        <span className="ml-auto text-[12px] text-ink-2 tabular">
          {[took, when ? timeAgo(when, now) : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-2">
        {[
          job.workflow && job.name && job.workflow !== job.name ? job.workflow : null,
          job.repo,
          job.runnerName &&
            (runner ? (
              <Link
                key="runner"
                to="/runners/$key"
                params={{ key: runner.key }}
                className="font-mono hover:text-ink hover:underline"
              >
                {job.runnerName}
              </Link>
            ) : (
              <span key="runner" className="font-mono">
                {job.runnerName}
              </span>
            )),
          machine && (
            <Link
              key="machine"
              to="/machines/$id"
              params={{ id: machine.id }}
              className="hover:text-ink hover:underline"
            >
              {machine.name}
            </Link>
          ),
        ]
          .filter(Boolean)
          .map((part, i) => (
            <span key={i} className="inline-flex items-center gap-x-2">
              {i > 0 && (
                <span aria-hidden className="text-ink-3">
                  ·
                </span>
              )}
              {part}
            </span>
          ))}
        {forgejo && job.htmlUrl && (
          <a
            href={job.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto font-medium text-accent hover:underline"
          >
            Open on Forgejo
          </a>
        )}
        {!forgejo && job.jobId !== null && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="ml-auto font-medium text-accent hover:underline"
          >
            {open ? "Hide log" : "Show log"}
          </button>
        )}
      </div>
      {jobResult(job, now) === "lost" && (
        <p className="mt-1 text-[12px] text-bad">
          The runner started this job but never finished it: the machine or the runner stopped
          mid-job. That's the machine's problem, not the job's.
        </p>
      )}
      {open && log.isPending && (
        <div className="mt-1 text-[12px] text-ink-3">Fetching it from GitHub…</div>
      )}
      {open && log.error && <ErrorText className="mt-1" error={log.error} />}
      {open && log.data && <Terminal text={log.data.log} running={false} />}
    </li>
  );
}
