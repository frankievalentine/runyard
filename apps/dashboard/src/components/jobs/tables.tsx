import {
  departures,
  jobResult,
  waitingReasons,
  type JobRecord,
  type QueuedJobView,
  type RunnerView,
  type YardView,
} from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { api, call } from "../../api.ts";
import { formatDollars, formatElapsed, timeAgo } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { Icon } from "../icons.tsx";
import { Lab } from "../pool/bits.tsx";
import { Elapsed, Label } from "../runners.tsx";
import { Terminal } from "../Terminal.tsx";
import { TryAgain } from "../TryAgain.tsx";
import { Chip, ttRowButton, ttTable } from "../tt.tsx";
import { ErrorText } from "../ui.tsx";
import { MRow, ResultTag, WHY_TONE } from "./parts.tsx";

/*
 * The Jobs page's three tables from the Timetable design, each with its phone rows: jobs on their
 * way, jobs waiting and why, and the last 7 days.
 */

const forgeName = (f: "github" | "forgejo") => (f === "forgejo" ? "Forgejo" : "GitHub");
const row = "cursor-pointer [&:hover>td]:bg-tt-hover";
const num = `${ttTable.td} text-right tabular`;
const numHead = `${ttTable.th} !text-right`;

/** Jobs runners are working on: job, repository, forge, runner, how long, and boat.dev's cost. */
export function RunningTable({ view, running }: { view: YardView; running: RunnerView[] }) {
  const navigate = useNavigate();
  const open = (r: RunnerView) => void navigate({ to: "/runners/$key", params: { key: r.key } });
  const cost = (r: RunnerView) => {
    const d = view.boatVms[r.key]?.dollars;
    return d == null ? null : formatDollars(d);
  };
  return (
    <>
      <table className={`${ttTable.table} max-lg:hidden`}>
        <thead>
          <tr>
            <th className={ttTable.th}>Job</th>
            <th className={ttTable.th}>Repository</th>
            <th className={ttTable.th}>Forge</th>
            <th className={ttTable.th}>Runner</th>
            <th className={numHead}>Running for</th>
            <th className={numHead}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {running.map((r) => (
            <tr key={r.key} className={row} onClick={() => open(r)}>
              <td className={ttTable.td}>
                <Link
                  to="/runners/$key"
                  params={{ key: r.key }}
                  className="block font-bold"
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.job?.name ?? "Job details unavailable"}
                </Link>
                {r.job?.workflowName && (
                  <small className="block text-[12px] text-tt-ink-3">{r.job.workflowName}</small>
                )}
              </td>
              <td className={ttTable.td}>{r.job?.repo ?? r.scopeLabel}</td>
              <td className={ttTable.td}>{forgeName(r.forge)}</td>
              <td className={ttTable.td}>
                <span className="font-board text-[12.5px]">{r.name}</span>
                {r.onDemand && (
                  <>
                    {" "}
                    <Chip tone="plain">{r.onDemand}</Chip>
                  </>
                )}
              </td>
              <td className={`${num} font-board`}>
                {r.job?.startedAt ? <Elapsed since={r.job.startedAt} /> : "Working"}
              </td>
              <td className={num}>{cost(r) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="lg:hidden">
        {running.map((r) => (
          <MRow
            key={r.key}
            onClick={() => open(r)}
            lead={<Chip tone="busy">{forgeName(r.forge)}</Chip>}
            title={r.job?.name ?? "Job details unavailable"}
            detail={`${r.job?.repo ?? r.scopeLabel} · ${r.onDemand ? `${r.onDemand} · ${r.name}` : r.name}`}
            end={
              <>
                <b className="font-board text-tt-ink">
                  {r.job?.startedAt ? <Elapsed since={r.job.startedAt} /> : "Working"}
                </b>
                {cost(r) && (
                  <>
                    <br />
                    {cost(r)}
                  </>
                )}
              </>
            }
          />
        ))}
      </div>
    </>
  );
}

/** Jobs waiting for a runner: what they ask for and why they wait. A row opens its details. */
export function WaitingTable({ view }: { view: YardView }) {
  const [open, setOpen] = useState<string | null>(null);
  const why = new Map(departures(view).map((d) => [d.key, d]));
  const jobs = [...view.queue.jobs].sort((a, b) => a.createdAt - b.createdAt);
  const key = (j: QueuedJobView) => `wait:${j.forge}:${j.id}`;
  const toggle = (k: string) => setOpen(open === k ? null : k);
  return (
    <>
      <table className={`${ttTable.table} max-lg:hidden`}>
        <thead>
          <tr>
            <th className={ttTable.th}>Job</th>
            <th className={ttTable.th}>Repository</th>
            <th className={ttTable.th}>Asks for</th>
            <th className={ttTable.th}>Why it's waiting</th>
            <th className={numHead}>Waiting</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const k = key(j);
            const d = why.get(k);
            return (
              <Fragment key={k}>
                <tr className={row} onClick={() => toggle(k)}>
                  <td className={ttTable.td}>
                    <button
                      type="button"
                      aria-expanded={open === k}
                      className="block text-left font-bold"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(k);
                      }}
                    >
                      {j.name}
                    </button>
                    <small className="block text-[12px] text-tt-ink-3">
                      {[forgeName(j.forge), j.headBranch].filter(Boolean).join(" · ")}
                    </small>
                  </td>
                  <td className={ttTable.td}>{j.repo}</td>
                  <td className={ttTable.td}>
                    <span className="flex flex-wrap gap-1">
                      {j.labels.map((l) => (
                        <Lab key={l}>{l}</Lab>
                      ))}
                    </span>
                  </td>
                  <td className={`${ttTable.td} font-semibold ${WHY_TONE[d?.tone ?? "neutral"]}`}>
                    {d?.status}
                  </td>
                  <td className={`${num} font-board`}>
                    <Elapsed since={j.createdAt} />
                  </td>
                </tr>
                {open === k && (
                  <tr>
                    <td colSpan={5} className={`${ttTable.td} bg-tt-paper`}>
                      <WaitingDetail job={j} view={view} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="lg:hidden">
        {jobs.map((j) => {
          const k = key(j);
          const d = why.get(k);
          return (
            <div key={k} className="border-t border-tt-rule first:border-t-0">
              <MRow
                onClick={() => toggle(k)}
                expanded={open === k}
                title={j.name}
                detail={
                  <span className={`font-semibold ${WHY_TONE[d?.tone ?? "neutral"]}`}>
                    {d?.status}
                  </span>
                }
                end={
                  <>
                    waiting
                    <br />
                    <b className="font-board text-tt-ink">
                      <Elapsed since={j.createdAt} />
                    </b>
                  </>
                }
              />
              {open === k && (
                <div className="bg-tt-paper px-3.5 py-3">
                  <WaitingDetail job={j} view={view} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A waiting job opened: its labels to copy, why no runner takes it, and a link to it. */
function WaitingDetail({ job, view }: { job: QueuedJobView; view: YardView }) {
  const eligible = view.runners.filter((r) => job.eligible.includes(r.key));
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <p className="text-tt-ink-2">
        {[job.workflowName, job.repo, job.headBranch, forgeName(job.forge)]
          .filter(Boolean)
          .join(" · ")}
        {job.htmlUrl && (
          <>
            {" · "}
            <a
              href={job.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-tt-ink hover:underline"
            >
              Open on {forgeName(job.forge)} <Icon name="external" size={11} />
            </a>
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-1">
        {job.labels.map((l) => (
          <Label key={l}>{l}</Label>
        ))}
      </div>
      {!job.onDemand && eligible.length === 0 && (
        <ul className="flex flex-col gap-0.5 text-[12.5px] text-tt-ink-2">
          {waitingReasons(job, view).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {eligible.length > 0 && (
        <p className="text-[12.5px] text-tt-ink-2">
          Matching runners: {eligible.map((r) => r.name).join(", ")}
        </p>
      )}
      {!job.onDemand && <TryAgain job={job} view={view} />}
    </div>
  );
}

/** The last 7 days: result, job, repository, machine, runner, how long it took and when. */
export function HistoryTable({ view, jobs }: { view: YardView; jobs: JobRecord[] }) {
  const now = useNow();
  const navigate = useNavigate();
  const [log, setLog] = useState<string | null>(null);
  const machine = (j: JobRecord) => view.machines.find((m) => m.id === j.machineId);
  const open = (j: JobRecord) => {
    if (j.machineId && machine(j))
      void navigate({ to: "/machines/$id", params: { id: j.machineId } });
    else setLog(log === j.id ? null : j.id);
  };
  const took = (j: JobRecord) =>
    j.startedAt && j.finishedAt
      ? formatElapsed(j.finishedAt - j.startedAt)
      : j.startedAt
        ? formatElapsed(now - j.startedAt)
        : "—";
  const when = (j: JobRecord) => {
    const at = j.finishedAt ?? j.startedAt;
    return at ? timeAgo(at, now) : "—";
  };
  const name = (j: JobRecord) => j.name ?? j.workflow ?? "Job";
  return (
    <>
      <table className={`${ttTable.table} max-lg:hidden`}>
        <thead>
          <tr>
            <th className={ttTable.th}>Result</th>
            <th className={ttTable.th}>Job</th>
            <th className={ttTable.th}>Repository</th>
            <th className={ttTable.th}>Machine</th>
            <th className={ttTable.th}>Runner</th>
            <th className={numHead}>Took</th>
            <th className={numHead}>When</th>
            <th className={ttTable.th}>
              <span className="sr-only">Log</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <Fragment key={j.id}>
              <tr className={row} onClick={() => open(j)}>
                <td className={ttTable.td}>
                  <ResultTag result={jobResult(j, now)} />
                </td>
                <td className={ttTable.td}>
                  <b className="font-bold">{name(j)}</b>
                  {j.test && (
                    <>
                      {" "}
                      <Chip tone="plain">Test</Chip>
                    </>
                  )}
                </td>
                <td className={ttTable.td}>{j.repo}</td>
                <td className={ttTable.td}>{machine(j)?.name ?? "—"}</td>
                <td className={`${ttTable.td} font-board text-[12.5px]`}>{j.runnerName ?? "—"}</td>
                <td className={`${num} font-board`}>{took(j)}</td>
                <td className={num}>{when(j)}</td>
                <td className={`${ttTable.td} w-px text-right whitespace-nowrap`}>
                  <LogButton job={j} view={view} open={log === j.id} onToggle={setLog} />
                </td>
              </tr>
              {log === j.id && (
                <tr>
                  <td colSpan={8} className={`${ttTable.td} bg-tt-paper`}>
                    <JobLog job={j} view={view} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="lg:hidden">
        {jobs.map((j) => (
          <div key={j.id} className="border-t border-tt-rule first:border-t-0">
            <MRow
              onClick={() => setLog(log === j.id ? null : j.id)}
              expanded={log === j.id}
              lead={<ResultTag result={jobResult(j, now)} />}
              title={name(j)}
              detail={[j.repo, j.runnerName].filter(Boolean).join(" · ")}
              end={
                <>
                  {took(j)}
                  <br />
                  {when(j)}
                </>
              }
            />
            {log === j.id && (
              <div className="bg-tt-paper px-3.5 py-3">
                <JobLog job={j} view={view} />
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/** Whether a job's log can be read here: GitHub's always, Forgejo's from version 16. */
function logsFor(job: JobRecord, view: YardView) {
  const conn = view.forgejo.connections.find((c) => c.forgeId === job.forgeId);
  const forgejo = conn !== undefined;
  const logs = !forgejo || Number(/^v?(\d+)\./.exec(conn.version ?? "")?.[1]) >= 16;
  return { forgejo, logs };
}

function LogButton({
  job,
  view,
  open,
  onToggle,
}: {
  job: JobRecord;
  view: YardView;
  open: boolean;
  onToggle: (id: string | null) => void;
}) {
  const { logs } = logsFor(job, view);
  if (!logs && job.htmlUrl)
    return (
      <a
        href={job.htmlUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={ttRowButton.secondary}
      >
        Open on Forgejo
      </a>
    );
  if (!logs || job.jobId === null) return null;
  return (
    <button
      type="button"
      aria-expanded={open}
      className={ttRowButton.secondary}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(open ? null : job.id);
      }}
    >
      {open ? "Hide log" : "Log"}
    </button>
  );
}

/** A finished job's log, fetched from its forge when opened; a lost job says why. */
function JobLog({ job, view }: { job: JobRecord; view: YardView }) {
  const now = useNow();
  const { forgejo, logs } = logsFor(job, view);
  const machine = view.machines.find((m) => m.id === job.machineId);
  const log = useQuery({
    queryKey: ["job-log", job.id],
    queryFn: async () =>
      (await call(api.jobs[":id"].log.$get({ param: { id: job.id } }))) as { log: string },
    enabled: logs && job.jobId !== null,
    retry: false,
  });
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      <p className="text-tt-ink-2">
        {[job.workflow, job.repo, job.runnerName].filter(Boolean).join(" · ")}
        {machine && (
          <>
            {" · "}
            <Link
              to="/machines/$id"
              params={{ id: machine.id }}
              className="font-semibold text-tt-ink hover:underline"
            >
              {machine.name}
            </Link>
          </>
        )}
        {job.htmlUrl && (
          <>
            {" · "}
            <a
              href={job.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-tt-ink hover:underline"
            >
              Open on {forgejo ? "Forgejo" : "GitHub"} <Icon name="external" size={11} />
            </a>
          </>
        )}
      </p>
      {jobResult(job, now) === "lost" && (
        <p className="text-tt-bad-ink">
          The runner started this job but never finished it: the machine or the runner stopped
          mid-job. That's the machine's problem, not the job's.
        </p>
      )}
      {logs && job.jobId !== null && (
        <>
          {log.isPending && (
            <p className="text-tt-ink-3">Fetching it from {forgejo ? "Forgejo" : "GitHub"}…</p>
          )}
          {log.error && <ErrorText error={log.error} />}
          {log.data && <Terminal text={log.data.log} running={false} />}
        </>
      )}
    </div>
  );
}
