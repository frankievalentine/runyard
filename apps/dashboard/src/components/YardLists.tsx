import type { RunnerView, YardView } from "@runyard/core";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatDollars } from "../lib/format.ts";
import { runnerStatus } from "../lib/status.ts";
import { Icon } from "./icons.tsx";
import { Elapsed } from "./runners.tsx";
import { StatusDot } from "./ui.tsx";

/*
 * Lists the sidebar used to hold, now page sections: a titled panel of rows, a runner's row, and
 * boat.dev's one-job runners on Pools.
 */

const rowClass =
  "flex min-h-11 w-full min-w-0 items-center gap-3 border-t border-tt-rule px-4 py-2 text-left first:border-t-0 hover:bg-tt-hover";

/** A titled panel of rows, with an optional action (Add machine, New pool) at its right. */
export function ListPanel({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-tt-rule bg-tt-card">
      <header className="flex min-h-12 items-center gap-3 border-b border-tt-rule px-4">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {count !== undefined && (
          <span className="rounded bg-tt-paper px-1.5 py-0.5 font-board text-[12px] font-bold text-tt-ink-2 tabular">
            {count}
          </span>
        )}
        <span className="ml-auto">{action}</span>
      </header>
      <div>{children}</div>
    </section>
  );
}

function Trailing({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-[12.5px] text-tt-ink-2 tabular">{children}</span>;
}

function Name({ label, sub }: { label: string; sub?: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-semibold">{label}</span>
      {sub && <span className="block truncate text-[12.5px] text-tt-ink-3">{sub}</span>}
    </span>
  );
}

/** A runner, under its machine or provider. */
export function RunnerRow({ r, showScope }: { r: RunnerView; showScope?: boolean }) {
  const status = runnerStatus(r);
  return (
    <Link
      to="/runners/$key"
      params={{ key: r.key }}
      className={`${rowClass} pl-10`}
      title={`${r.name} · ${r.scopeLabel}: ${status.label}`}
    >
      <StatusDot tone={status.tone} hollow={status.hollow} size={6} />
      <span className="min-w-0 flex-1 truncate font-board text-[12.5px]">
        {showScope ? `${r.name} · ${r.scopeLabel.split("/").at(-1)}` : r.name}
      </span>
      <Trailing>
        {r.job?.startedAt ? (
          <span className="text-tt-ink">
            {r.job.name} · <Elapsed since={r.job.startedAt} />
          </span>
        ) : (
          status.label
        )}
      </Trailing>
    </Link>
  );
}

/** boat.dev's on-demand runners, which exist only while working. Not connected and idle: nothing. */
export function OnDemandList({ view }: { view: YardView }) {
  const boatRunners = view.runners.filter((r) => r.onDemand === "boat.dev");
  if (!view.boat && !boatRunners.length) return null;
  const cost = boatRunners.reduce((sum, r) => sum + (view.boatVms[r.key]?.dollars ?? 0), 0);
  return (
    <ListPanel title="On demand" count={boatRunners.length}>
      <Link to="/boat" className={rowClass} title="boat.dev: jobs with runs-on: boat">
        <span className="text-tt-ink-3">
          <Icon name="runner" />
        </span>
        <Name label="boat.dev" sub="A fresh VM for each job labeled boat" />
        <Trailing>
          {boatRunners.length
            ? `${boatRunners.length} running${cost ? ` · ${formatDollars(cost)}` : ""}`
            : "Idle"}
        </Trailing>
        <Icon name="chevron" size={12} />
      </Link>
      {boatRunners.map((r) => (
        <RunnerRow key={r.key} r={r} showScope />
      ))}
    </ListPanel>
  );
}
