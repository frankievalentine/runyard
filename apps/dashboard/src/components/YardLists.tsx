import { pendingChanges, type RunnerView, type YardView } from "@runyard/core";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatDollars } from "../lib/format.ts";
import { unassignedGroups } from "../lib/nav.ts";
import {
  machineStatus,
  machineSummary,
  machineTooltip,
  osLabel,
  runnerStatus,
} from "../lib/status.ts";
import { Icon } from "./icons.tsx";
import { Elapsed } from "./runners.tsx";
import { StatusDot } from "./ui.tsx";

/*
 * The lists the sidebar used to hold, as page sections: machines with their runners and tailnet
 * devices on Machines; pools and boat.dev on Pools. `filtered` is `view` narrowed by the page's filter.
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

/** Every machine, each followed by its runners. */
export function MachineList({
  view,
  filtered,
  admin,
  searching,
}: {
  view: YardView;
  filtered: YardView;
  admin: boolean;
  searching: boolean;
}) {
  const byMachine = new Map<string, RunnerView[]>();
  for (const r of filtered.runners) {
    if (r.machineId) byMachine.set(r.machineId, [...(byMachine.get(r.machineId) ?? []), r]);
  }
  return (
    <ListPanel
      title="Machines"
      count={filtered.machines.length}
      action={
        admin && (
          <Link
            to="/machines/add"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-tt-inv px-3 text-[13px] font-semibold text-tt-on-inv hover:opacity-90"
          >
            <Icon name="plus" size={13} />
            Add machine
          </Link>
        )
      }
    >
      {view.machines.length === 0 && !searching && (
        <p className="px-4 py-4 text-tt-ink-2">
          {admin
            ? "No machines yet. Add one to get started."
            : "An admin hasn't added machines yet."}
        </p>
      )}
      {filtered.machines.map((m) => {
        const status = machineStatus(m);
        const own = byMachine.get(m.id) ?? [];
        const busy = own.filter((r) => r.activity === "busy").length;
        const idle = own.filter((r) => r.activity === "idle").length;
        const summary =
          m.connection.state === "offline" || own.length === 0
            ? machineSummary(m)
            : busy
              ? `${busy} of ${own.length} working`
              : idle
                ? `${idle} idle`
                : machineSummary(m);
        // A busy machine keeps showing its work; an idle one shows changes waiting for review.
        const waiting = busy ? 0 : pendingChanges(view, m.id).length;
        return (
          <div key={m.id} className="border-t border-tt-rule first:border-t-0">
            <Link
              to="/machines/$id"
              params={{ id: m.id }}
              className={rowClass}
              title={machineTooltip(m)}
            >
              <StatusDot
                tone={busy && m.connection.state === "connected" ? "busy" : status.tone}
                hollow={status.hollow}
              />
              <Name label={m.name} sub={m.description || (m.os ? osLabel[m.os] : m.sshTarget)} />
              <Trailing>
                {waiting ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-tt-ink">
                    <span className="size-1.5 rounded-full bg-tt-loco" aria-hidden />
                    {waiting === 1 ? "1 change to review" : `${waiting} changes to review`}
                  </span>
                ) : (
                  summary
                )}
              </Trailing>
              <Icon name="chevron" size={12} />
            </Link>
            {own.map((r) => (
              <RunnerRow
                key={r.key}
                r={r}
                // Per-repository runners share a name; the scope tells them apart.
                showScope={own.filter((o) => o.name === r.name).length > 1}
              />
            ))}
          </div>
        );
      })}
    </ListPanel>
  );
}

/** Runners not on a machine Runyard knows, grouped by account. Empty: renders nothing. */
export function UnassignedList({ filtered }: { filtered: YardView }) {
  const groups = unassignedGroups(filtered.runners);
  if (!groups.length) return null;
  return (
    <ListPanel
      title="Runners Runyard doesn't manage"
      count={groups.reduce((n, g) => n + g.runners.length, 0)}
    >
      <p className="px-4 pt-3 pb-2 text-[12.5px] text-tt-ink-2">
        Open one to choose the machine it runs on, then move it into a pool if you'd like Runyard to
        take it over.
      </p>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="border-t border-tt-rule px-4 pt-2 pb-1 text-[11.5px] font-semibold tracking-wide text-tt-ink-3 uppercase">
            {g.label}
          </div>
          {g.runners.map((r) => (
            <RunnerRow
              key={r.key}
              r={r}
              showScope={g.runners.filter((o) => o.name === r.name).length > 1}
            />
          ))}
        </div>
      ))}
    </ListPanel>
  );
}

/** Tailnet devices not yet added, and the link to ignored ones. Empty: renders nothing. */
export function TailnetList({ filtered }: { filtered: YardView }) {
  if (!filtered.discovered.length && !filtered.ignored.length) return null;
  return (
    <ListPanel title="On your tailnet" count={filtered.discovered.length}>
      {filtered.discovered.map((p) => (
        <Link
          key={p.nodeId}
          to="/peers/$nodeId"
          params={{ nodeId: p.nodeId }}
          className={rowClass}
          title={`${p.name}\n${p.address}\nOn your tailnet, not added to Runyard`}
        >
          <StatusDot tone={p.online ? "ok" : "muted"} hollow />
          <Name label={p.name} sub={p.address} />
          <Trailing>{p.online ? osLabel[p.os] : "Offline"}</Trailing>
          <Icon name="chevron" size={12} />
        </Link>
      ))}
      {filtered.ignored.length > 0 && (
        <Link to="/ignored" className={rowClass}>
          <span className="text-tt-ink-3">
            <Icon name="eye-off" />
          </span>
          <Name label="Ignored" />
          <Trailing>{filtered.ignored.length}</Trailing>
          <Icon name="chevron" size={12} />
        </Link>
      )}
    </ListPanel>
  );
}

/** Every pool, with how many of its runners exist (or what's running, on demand). */
export function PoolList({ view, admin }: { view: YardView; admin: boolean }) {
  return (
    <ListPanel
      title="Pools"
      count={view.pools.pools.length}
      action={
        admin &&
        (view.machines.length === 0 ? (
          <span
            className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-tt-rule-2 px-3 text-[13px] font-semibold text-tt-ink-3"
            title="Add a machine first"
            aria-disabled="true"
          >
            <Icon name="plus" size={13} />
            New pool · add a machine first
          </span>
        ) : (
          <Link
            to="/pools/new"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-tt-inv px-3 text-[13px] font-semibold text-tt-on-inv hover:opacity-90"
          >
            <Icon name="plus" size={13} />
            New pool
          </Link>
        ))
      }
    >
      {view.pools.pools.length === 0 && (
        <p className="px-4 py-4 text-tt-ink-2">
          {admin
            ? "No pools yet. A pool turns labels, machines and repositories into runners."
            : "An admin hasn't created pools yet."}
        </p>
      )}
      {view.pools.pools.map((p) => {
        const desired = view.pools.desired.filter((d) => d.poolId === p.id);
        const existing = desired.filter((d) =>
          view.runners.some(
            (r) => r.machineId === d.machineId && r.name.toLowerCase() === d.name.toLowerCase(),
          ),
        ).length;
        const running = view.pools.dispatches.filter(
          (d) => d.poolId === p.id && (d.state === "starting" || d.state === "running"),
        ).length;
        return (
          <Link key={p.id} to="/pools/$id" params={{ id: p.id }} className={rowClass}>
            <span className="text-tt-ink-3">
              <Icon name="plan" />
            </span>
            <Name label={p.name} sub={p.mode === "onDemand" ? "One runner per job" : "Always on"} />
            <Trailing>
              {p.mode === "onDemand"
                ? p.paused
                  ? "Paused"
                  : running
                    ? `${running} running`
                    : "Idle"
                : `${existing} of ${desired.length} runners`}
            </Trailing>
            <Icon name="chevron" size={12} />
          </Link>
        );
      })}
    </ListPanel>
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
