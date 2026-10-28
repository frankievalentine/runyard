import type { FleetView, JobView, QueuedJobView, RunnerView } from "@runyard/core";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useFleet } from "../lib/fleet.ts";
import { formatDollars, formatElapsed, plural } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { isBuiltinLabel, runnerStatus } from "../lib/status.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Icon } from "./icons.tsx";
import { Card, EmptyLine, Pill, StatusDot } from "./ui.tsx";

/** Ported from fleet's runner pieces (details/shared.tsx and QueueDetail.tsx). */

/** A steady timer that ticks by itself. */
export function Elapsed({ since }: { since: number }) {
  const now = useNow();
  return <>{formatElapsed(now - since)}</>;
}

/** A small tag: Forgejo (GitHub is the unmarked default), or an on-demand service such as boat. */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-[4px] border border-line px-1 text-[10.5px] font-medium text-ink-2">
      {children}
    </span>
  );
}

export function ForgeBadge() {
  return <Badge>Forgejo</Badge>;
}

/** A runner label as a small monospace chip, click to copy. */
export function Label({ children }: { children: string }) {
  return (
    <CopyValue
      value={children}
      label="Label"
      showIcon={false}
      className="h-[20px] max-w-full items-center rounded-[4px] border border-line bg-sunken/60 px-1.5 font-mono text-[11px] break-all text-ink-2"
    >
      {children}
    </CopyValue>
  );
}

export function GitHubLink({
  url,
  label,
  children,
}: {
  url: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className="shrink-0 text-ink-2 hover:text-accent"
    >
      {children}
    </a>
  );
}

/** One runner as a list row: status, what it's doing, and a steady timer. */
export function RunnerLine({ r }: { r: RunnerView }) {
  const navigate = useNavigate();
  const status = runnerStatus(r);
  const vm = useFleet().boatVms[r.key];
  const detail = r.job
    ? `${r.job.repo} · ${r.name}`
    : r.activity === "busy"
      ? "Job details unavailable"
      : r.labels.filter((l) => !isBuiltinLabel(l)).join(", ") || r.scopeLabel;
  return (
    <button
      type="button"
      className="flex min-h-[56px] w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-b-0 hover:bg-hover"
      onClick={() => void navigate({ to: "/runners/$key", params: { key: r.key } })}
    >
      <StatusDot tone={status.tone} hollow={status.hollow} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">
            {r.job?.workflowName ?? r.job?.name ?? r.name}
          </span>
          {r.forge === "forgejo" && <ForgeBadge />}
          {r.onDemand && <Badge>{r.onDemand}</Badge>}
        </div>
        <div className="truncate font-mono text-[12px] text-ink-2">{detail}</div>
      </div>
      {vm?.dollars != null && (
        <span
          className="shrink-0 text-[12px] text-ink-2 tabular"
          title={`${vm.type} boat VM, cost so far at list price`}
        >
          {formatDollars(vm.dollars)}
        </span>
      )}
      <span className="shrink-0 text-[12px] text-ink-2 tabular">
        {r.job?.startedAt ? <Elapsed since={r.job.startedAt} /> : status.label}
      </span>
      <span className="text-ink-3">
        <Icon name="chevron" size={11} />
      </span>
    </button>
  );
}

/** What an empty queue means: nothing waiting, or no job data yet. */
export function emptyQueueText(view: FleetView): string {
  if (!forgesConnected(view)) return "Connect GitHub or Forgejo to see queued jobs.";
  return view.queue.at ? "Nothing queued for self-hosted runners." : "Waiting for job data.";
}

/** Whether any forge is connected, so runner and queue sections have something to show. */
export function forgesConnected(view: FleetView): boolean {
  return view.github.apps.length > 0 || view.forgejo.connections.length > 0;
}

export function QueueList({
  view,
  limit,
  compact,
}: {
  view: FleetView;
  limit?: number;
  compact?: boolean;
}) {
  const jobs = limit ? view.queue.jobs.slice(0, limit) : view.queue.jobs;
  return (
    <Card className="overflow-hidden">
      {jobs.length === 0 ? (
        <EmptyLine>
          <span className="flex items-center gap-2.5">
            <Icon name="inbox" size={16} />
            {emptyQueueText(view)}
          </span>
        </EmptyLine>
      ) : (
        jobs.map((job) => <QueuedJob key={job.id} job={job} view={view} compact={compact} />)
      )}
      {limit && view.queue.jobs.length > limit && (
        <EmptyLine>and {view.queue.jobs.length - limit} more in Queued jobs</EmptyLine>
      )}
    </Card>
  );
}

function QueuedJob({
  job,
  view,
  compact,
}: {
  job: QueuedJobView;
  view: FleetView;
  compact?: boolean;
}) {
  const eligible = view.runners.filter((r) => job.eligible.includes(r.key));
  const limits = job.onDemand === "boat" ? view.boat?.limits : null;
  const idle = eligible.filter((r) => r.activity === "idle").length;
  return (
    <div
      className={`flex min-h-[56px] gap-3 border-b border-line px-4 py-3 last:border-b-0 ${compact ? "flex-col" : "flex-wrap items-center"}`}
    >
      <div className="min-w-0 flex-1">
        <JobTitle job={job} />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {job.labels.map((l) => (
            <Label key={l}>{l}</Label>
          ))}
        </div>
      </div>
      <div
        className={`flex shrink-0 gap-2 ${compact ? "flex-wrap items-center" : "flex-col items-end"}`}
      >
        {limits?.atConcurrencyLimit ? (
          <Pill tone="warn">Waiting: boat is at {limits.maxActiveSandboxes} VMs</Pill>
        ) : limits?.atStartLimit ? (
          <Pill tone="warn">Waiting for boat's start limit</Pill>
        ) : job.onDemand ? (
          // The service starts a VM for the job; no runner exists until then.
          <Pill tone="info">Starts on {job.onDemand}</Pill>
        ) : eligible.length === 0 ? (
          <Pill tone="warn">No matching runner online</Pill>
        ) : idle > 0 ? (
          <Pill tone="ok">{plural(idle, "idle runner")} match</Pill>
        ) : (
          <Pill tone="busy">{eligible.length} matching, all working</Pill>
        )}
        <span className="text-[11px] text-ink-2 tabular">
          waiting <Elapsed since={job.createdAt} />
        </span>
      </div>
    </div>
  );
}

export function JobTitle({ job }: { job: JobView }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={job.name}>
          {job.name}
        </span>
        {job.forge === "forgejo" && <ForgeBadge />}
        {job.onDemand && <Badge>{job.onDemand}</Badge>}
        {job.htmlUrl && (
          <GitHubLink url={job.htmlUrl} label={`Open ${job.name} on GitHub`}>
            <Icon name="external" size={12} />
          </GitHubLink>
        )}
      </div>
      <div className="mt-0.5 truncate font-mono text-[12px] text-ink-2">
        {job.workflowName && <>{job.workflowName} · </>}
        <CopyValue value={job.repo} label="Repository" />
        {job.headBranch && <> · {job.headBranch}</>}
      </div>
    </>
  );
}

/** fleet's cells in the machine table: one small block per runner. */
export function RunnerCells({ runners }: { runners: RunnerView[] }) {
  return (
    <span
      className="flex flex-wrap items-center gap-0.5"
      role="img"
      aria-label={runners.map((r) => `${r.name}: ${runnerStatus(r).label}`).join(", ")}
    >
      {runners.map((r) => {
        const status = runnerStatus(r);
        const color = `var(--${status.tone === "busy" ? "busy" : status.tone})`;
        const outlined = status.hollow || r.activity === "offline";
        return (
          <span
            key={r.key}
            title={`${r.name}: ${status.label}`}
            className="h-3.5 w-2 rounded-[2px]"
            style={{
              background: outlined ? undefined : color,
              border: outlined ? `1px dashed ${color}` : undefined,
            }}
          />
        );
      })}
    </span>
  );
}
