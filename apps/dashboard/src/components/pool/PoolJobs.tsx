import { jobResult, type JobRecord } from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, call } from "../../api.ts";
import { formatElapsed, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { useYard } from "../../lib/yard.ts";
import { countsLine, useJobs } from "../Jobs.tsx";
import { Terminal } from "../Terminal.tsx";
import { Panel } from "../tt.tsx";
import { ErrorText } from "../ui.tsx";

/** The design's result tag: passed green, failed red, the rest quiet. */
const RESULT: Record<ReturnType<typeof jobResult>, [string, string]> = {
  passed: ["Passed", "bg-tt-ok-bg text-tt-ok-ink"],
  failed: ["Failed", "bg-tt-bad-bg text-tt-bad-ink"],
  cancelled: ["Cancelled", "bg-tt-paper text-tt-ink-2"],
  running: ["Running", "bg-tt-busy-bg text-tt-busy-ink"],
  unknown: ["Pending", "bg-tt-paper text-tt-ink-2"],
  lost: ["Lost", "bg-tt-bad-bg text-tt-bad-ink"],
};

export function ResultTag({ result }: { result: ReturnType<typeof jobResult> }) {
  const [label, tone] = RESULT[result];
  return (
    <span
      className={`inline-flex min-w-[68px] justify-center rounded-[4px] px-1.5 py-1 font-board text-[11px] leading-none font-bold tracking-[.04em] uppercase ${tone}`}
    >
      {label}
    </span>
  );
}

/** A pool's run history for the last 7 days, as the design's Jobs panel, with each job's log. */
export function PoolJobs({ poolId, showMachine }: { poolId: string; showMachine: boolean }) {
  const [failures, setFailures] = useState(false);
  const [shown, setShown] = useState(10);
  const jobs = useJobs({ pool: poolId }, failures);
  const counts = jobs.data?.counts;
  return (
    <Panel
      title="Jobs"
      meta={counts ? `Last 7 days: ${countsLine(counts)}` : "Last 7 days"}
      action={
        counts &&
        (counts.failed > 0 || failures) && (
          <button
            type="button"
            onClick={() => setFailures(!failures)}
            className="text-[12.5px] font-bold text-tt-ink-2 underline hover:text-tt-ink"
          >
            {failures ? "Show all" : "Failures only"}
          </button>
        )
      }
    >
      {jobs.error && <ErrorText className="px-4 pb-3" error={jobs.error} />}
      {jobs.data?.jobs.length === 0 && (
        <p className="px-4 pb-4 text-[13.5px] text-tt-ink-2">
          {failures ? "No failures in the last 7 days." : "No jobs in the last 7 days."}
          {!failures && (
            <span className="mt-0.5 block text-[12.5px] text-tt-ink-3">
              Jobs appear here as they run, from webhooks or from the runners' hooks.
            </span>
          )}
        </p>
      )}
      {jobs.data?.jobs.slice(0, shown).map((j) => (
        <JobRow key={j.id} job={j} showMachine={showMachine} />
      ))}
      {jobs.data && jobs.data.jobs.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + 20)}
          className="w-full border-t border-tt-rule px-4 py-2.5 text-left text-[12.5px] font-semibold text-tt-ink-2 hover:text-tt-ink"
        >
          Show {Math.min(20, jobs.data.jobs.length - shown)} more
        </button>
      )}
    </Panel>
  );
}

function JobRow({ job, showMachine }: { job: JobRecord; showMachine: boolean }) {
  const view = useYard();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const result = jobResult(job, now);
  const runner = job.runnerName
    ? view.runners.find((r) => r.name.toLowerCase() === job.runnerName!.toLowerCase())
    : undefined;
  const machine = showMachine ? view.machines.find((m) => m.id === job.machineId) : undefined;
  // Forgejo serves job logs from version 16; before that, its jobs link to the run instead.
  const conn = view.forgejo.connections.find((c) => c.forgeId === job.forgeId);
  const forgejo = conn !== undefined;
  const logs = !forgejo || Number(/^v?(\d+)\./.exec(conn.version ?? "")?.[1]) >= 16;
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
  const title = job.name ?? job.workflow ?? "Job";
  const link = "font-semibold text-tt-ink-2 underline hover:text-tt-ink";
  return (
    <div className="border-t border-tt-rule px-4 py-[11px]">
      <div className="flex items-start gap-3">
        <span className="pt-0.5">
          <ResultTag result={result} />
        </span>
        <span className="min-w-0 flex-1">
          {job.htmlUrl ? (
            <a
              href={job.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate font-bold hover:underline"
            >
              {title}
            </a>
          ) : (
            <b className="block truncate font-bold">{title}</b>
          )}
          <small className="block text-[12px] break-words text-tt-ink-3">
            {[job.workflow && job.name && job.workflow !== job.name ? job.workflow : null, job.repo]
              .filter(Boolean)
              .join(" · ")}
            {job.runnerName && (
              <>
                {" · "}
                {runner ? (
                  <Link
                    to="/runners/$key"
                    params={{ key: runner.key }}
                    className="font-board hover:text-tt-ink hover:underline"
                  >
                    {job.runnerName}
                  </Link>
                ) : (
                  <span className="font-board">{job.runnerName}</span>
                )}
              </>
            )}
            {machine && <> on {machine.name}</>}
            {job.test && " · Test job"}
          </small>
        </span>
        <span className="shrink-0 text-right text-[12.5px] text-tt-ink-3 tabular-nums">
          {[took, when ? timeAgo(when, now) : null].filter(Boolean).join(" · ")}
          <span className="mt-0.5 block text-[12px]">
            {!logs && job.htmlUrl && (
              <a href={job.htmlUrl} target="_blank" rel="noreferrer" className={link}>
                Open on Forgejo
              </a>
            )}
            {logs && job.jobId !== null && (
              <button type="button" onClick={() => setOpen(!open)} className={link}>
                {open ? "Hide log" : "Show log"}
              </button>
            )}
          </span>
        </span>
      </div>
      {result === "lost" && (
        <p className="mt-1 text-[12.5px] text-tt-bad-ink">
          The runner started this job but never finished it: the machine or the runner stopped
          mid-job. That's the machine's problem, not the job's.
        </p>
      )}
      {open && log.isPending && (
        <div className="mt-1 text-[12px] text-tt-ink-3">
          Fetching it from {forgejo ? "Forgejo" : "GitHub"}…
        </div>
      )}
      {open && log.error && <ErrorText className="mt-1" error={log.error} />}
      {open && log.data && <Terminal text={log.data.log} running={false} />}
    </div>
  );
}
