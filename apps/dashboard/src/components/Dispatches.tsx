import { jobResult, type Dispatch, type JobRecord } from "@runyard/core";
import { JOB_RESULT } from "./Jobs.tsx";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, call } from "../api.ts";
import { sessionQuery } from "../lib/queries.ts";
import { formatElapsed, timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { useYard } from "../lib/yard.ts";
import { Icon } from "./icons.tsx";
import { Terminal } from "./Terminal.tsx";
import { Card, EmptyLine, ErrorText, StatusDot } from "./ui.tsx";

const DISPATCH_STATE = {
  starting: { tone: "busy", label: "Starting", hollow: true },
  running: { tone: "busy", label: "Running", hollow: false },
  done: { tone: "ok", label: "Finished", hollow: false },
  failed: { tone: "bad", label: "Failed", hollow: false },
} as const;

/** One-job runners the pool started, newest first, with how each ended. */
export function Dispatches({
  dispatches,
  jobs = [],
  showPool = false,
  empty = "None yet. A runner starts here when a matching job is queued and no idle runner can take it.",
}: {
  dispatches: Dispatch[];
  /** Run history's jobs, to show each runner's job and its result. */
  jobs?: JobRecord[];
  /** Name each runner's pool, where runners from several pools are listed. */
  showPool?: boolean;
  empty?: string;
}) {
  const view = useYard();
  const now = useNow();
  const session = useQuery(sessionQuery);
  const admin = session.data?.user?.role === "admin";
  if (dispatches.length === 0) {
    return (
      <Card>
        <EmptyLine>{empty}</EmptyLine>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {dispatches.map((d) => {
          // The job it ran, once run history has it: its result says more than "Finished".
          const job = jobs.find((j) => j.runnerName?.toLowerCase() === d.runnerName.toLowerCase());
          // Runyard notes this when the job was still queued after the runner ended.
          const state =
            d.state === "done" && d.detail?.includes("still waiting")
              ? ({ tone: "warn", label: "Ended early", hollow: false } as const)
              : job && d.state !== "failed"
                ? { ...JOB_RESULT[jobResult(job, now)], hollow: false }
                : DISPATCH_STATE[d.state];
          const runner = view.runners.find(
            (r) => r.scope.forgeId === d.scope.forgeId && r.name === d.runnerName,
          );
          const took = (d.endedAt ?? now) - d.startedAt;
          return (
            <li key={d.id} className="flex items-start gap-3 px-4 py-2.5 text-[12.5px]">
              {/* As tall as the first line, so the dot sits on it however many lines follow. */}
              <span className="flex h-[18px] shrink-0 items-center">
                <StatusDot tone={state.tone} hollow={state.hollow} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-[18px]">
                <div className="flex flex-wrap items-center justify-between gap-x-3">
                  <span className="flex min-w-0 items-center gap-2">
                    {runner ? (
                      <Link
                        to="/runners/$key"
                        params={{ key: runner.key }}
                        className="truncate font-mono font-medium hover:underline"
                      >
                        {d.runnerName}
                      </Link>
                    ) : (
                      <span className="truncate font-mono font-medium">{d.runnerName}</span>
                    )}
                    <span className={state.tone === "bad" ? "text-bad" : "text-ink-2"}>
                      {state.label}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-[11.5px] text-ink-3 tabular"
                    title={new Date(d.startedAt).toLocaleString()}
                  >
                    {timeAgo(d.startedAt, now)} · {d.endedAt ? "took" : "for"} {formatElapsed(took)}
                  </span>
                </div>
                <div className="text-ink-2">
                  {runner?.job ? (
                    <>
                      Running <span className="font-medium text-ink">{runner.job.name}</span> in{" "}
                      {runner.job.repo}
                    </>
                  ) : d.job ? (
                    <>
                      For <span className="font-medium text-ink">{d.job.name}</span>
                      {d.job.url && (
                        <a
                          href={d.job.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${d.job.name} on GitHub`}
                          className="ml-1 inline-flex translate-y-[2px] text-ink-3 hover:text-ink"
                        >
                          <Icon name="external" size={12} />
                        </a>
                      )}{" "}
                      in {d.job.repo}
                    </>
                  ) : (
                    <>
                      For job {d.jobId} in {d.scope.target}
                    </>
                  )}{" "}
                  · on {view.machines.find((m) => m.id === d.machineId)?.name ?? d.machineId}
                  {showPool && (
                    <>
                      {" "}
                      · pool{" "}
                      <Link
                        to="/pools/$id"
                        params={{ id: d.poolId }}
                        className="text-ink hover:underline"
                      >
                        {view.pools.pools.find((p) => p.id === d.poolId)?.name ?? "removed"}
                      </Link>
                    </>
                  )}
                </div>
                {d.detail && (
                  <div className={d.state === "failed" ? "text-bad" : "text-ink-2"}>{d.detail}</div>
                )}
                <Logs dispatch={d} job={job} admin={admin} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * A one-job runner's two logs: the runner's own, read from its machine (kept
 * after it exits, live while it runs; it explains a job that was lost), and
 * its job's, fetched from GitHub. Opened one at a time.
 */
function Logs({ dispatch, job, admin }: { dispatch: Dispatch; job?: JobRecord; admin: boolean }) {
  const [open, setOpen] = useState<"runner" | "job" | null>(null);
  const running = dispatch.state === "starting" || dispatch.state === "running";
  const runnerLog = useQuery({
    queryKey: ["dispatch-log", dispatch.id],
    queryFn: async () =>
      (await call(api.dispatches[":id"].log.$get({ param: { id: dispatch.id } }))) as {
        log: string;
      },
    enabled: open === "runner",
    retry: false,
    refetchInterval: open === "runner" && running ? 5000 : false,
  });
  const jobLog = useQuery({
    queryKey: ["job-log", job?.id],
    queryFn: async () =>
      (await call(api.jobs[":id"].log.$get({ param: { id: job!.id } }))) as { log: string },
    enabled: open === "job" && Boolean(job),
    retry: false,
  });
  const toggle = (which: "runner" | "job") => setOpen(open === which ? null : which);
  const log = open === "runner" ? runnerLog : jobLog;
  const button = "text-[12px] font-medium text-accent hover:underline";
  if (!admin && job?.jobId == null) return null;
  return (
    <div className="mt-1">
      <div className="flex gap-3">
        {admin && (
          <button type="button" onClick={() => toggle("runner")} className={button}>
            {open === "runner" ? "Hide runner log" : "Runner log"}
          </button>
        )}
        {job?.jobId != null && (
          <button type="button" onClick={() => toggle("job")} className={button}>
            {open === "job" ? "Hide job log" : "Job log"}
          </button>
        )}
      </div>
      {open && log.isPending && (
        <div className="mt-1 text-[12px] text-ink-3">
          {open === "runner" ? "Reading it from the machine…" : "Fetching it from GitHub…"}
        </div>
      )}
      {open && log.error && <ErrorText className="mt-1" error={log.error} />}
      {open && log.data && <Terminal text={log.data.log} running={open === "runner" && running} />}
    </div>
  );
}
