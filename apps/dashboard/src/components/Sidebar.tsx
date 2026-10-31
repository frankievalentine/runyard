import { pendingChanges, type YardView, type RunnerView } from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { healthQuery } from "../lib/queries.ts";
import type { ReactNode } from "react";
import { navKey, type NavItem } from "../lib/nav.ts";
import {
  machineStatus,
  machineSummary,
  machineTooltip,
  osLabel,
  runnerStatus,
} from "../lib/status.ts";
import { formatDollars } from "../lib/format.ts";
import { unassignedGroups } from "../lib/nav.ts";
import { Elapsed } from "./runners.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import { Logomark } from "./Logomark.tsx";
import { Icon } from "./icons.tsx";
import { EmptyLine, StatusDot, TimeAgo } from "./ui.tsx";

/**
 * aarondfrancis/fleet's sidebar: overview, filter, then machines (with their runners), pools,
 * on-demand runners, unassigned runners, tailnet devices and ignored.
 * `filtered` is `view` narrowed by the query.
 */
export function Sidebar({
  view,
  filtered,
  query,
  setQuery,
  otherOpen,
  setOtherOpen,
  runnersOpen,
  setRunnersOpen,
  selected,
  admin,
  demo,
}: {
  view: YardView;
  filtered: YardView;
  query: string;
  setQuery: (q: string) => void;
  otherOpen: boolean;
  setOtherOpen: (open: boolean) => void;
  runnersOpen: boolean;
  setRunnersOpen: (open: boolean) => void;
  selected: string;
  admin: boolean;
  demo: boolean;
}) {
  const searching = query.trim() !== "";
  const showOther = searching || otherOpen;
  const showRunners = searching || runnersOpen;
  const unassigned = unassignedGroups(filtered.runners);
  // boat.dev's one-job runners exist only while working; they nest under its row.
  const boatRunners = filtered.runners.filter((r) => r.onDemand === "boat.dev");
  const boatCost = boatRunners.reduce((sum, r) => sum + (view.boatVms[r.key]?.dollars ?? 0), 0);
  const byMachine = new Map<string, RunnerView[]>();
  for (const r of filtered.runners) {
    if (r.machineId) byMachine.set(r.machineId, [...(byMachine.get(r.machineId) ?? []), r]);
  }
  const is = (item: NavItem) => navKey(item) === selected;
  // Which Runyard this is: its tailnet name while it serves there, else the address in use.
  const tailnetHost = useQuery(healthQuery).data?.tailnetHost;
  const where = tailnetHost ? tailnetHost.replace(/\.ts\.net$/, "") : window.location.host;

  return (
    <aside
      aria-label="Yard navigation"
      className="flex h-full w-[256px] shrink-0 flex-col border-r border-line bg-sidebar"
    >
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
        <Logomark size={28} small />
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-semibold">Runyard</div>
          <div className="mt-0.5 truncate text-[11px] text-ink-2">{where}</div>
        </div>
      </div>
      <nav className="space-y-0.5 p-2" aria-label="Overview">
        <Row
          item={{ path: "/" }}
          selected={is({ path: "/" })}
          icon={<Icon name="grid" size={16} />}
          label="Yard overview"
          trailing={view.machines.length}
        />
        <Row
          item={{ path: "/queue" }}
          selected={is({ path: "/queue" })}
          icon={<Icon name="queue" size={16} />}
          label="Queued jobs"
          trailing={view.queue.jobs.length}
        />
      </nav>
      <div className="relative px-2 pb-2">
        <label className="relative block">
          <span className="sr-only">Filter</span>
          <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-2">
            <Icon name="search" />
          </span>
          <input
            className="input !h-7 !pr-7 !pl-7 text-[13px]"
            placeholder="Filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        {query && (
          <button
            aria-label="Clear filter"
            className="absolute top-0 right-2 flex h-7 w-7 items-center justify-center text-ink-2 hover:text-ink"
            onClick={() => setQuery("")}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      <nav className="scroll min-h-0 flex-1 px-2 pb-2" aria-label="Machines">
        <Heading
          title="Machines"
          count={filtered.machines.length}
          action={
            admin && (
              <Link
                to="/machines/add"
                aria-label="Add machines"
                title="Add machines"
                className="flex size-5 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink"
              >
                <Icon name="plus" size={13} />
              </Link>
            )
          }
        />
        {view.machines.length === 0 && !searching && (
          <EmptyLine>
            {admin
              ? "Add machines with + to see them here."
              : "An admin hasn't added machines yet."}
          </EmptyLine>
        )}
        {filtered.machines.map((m) => {
          const status = machineStatus(m);
          const item = { path: "/machines/$id", params: { id: m.id } };
          const own = byMachine.get(m.id) ?? [];
          const busy = own.filter((r) => r.activity === "busy").length;
          const idle = own.filter((r) => r.activity === "idle").length;
          // aarondfrancis/fleet's summary: runners when it has any, otherwise its own state.
          const summary =
            m.connection.state === "offline" || own.length === 0
              ? machineSummary(m)
              : busy
                ? `${busy}/${own.length} working`
                : idle
                  ? `${idle} idle`
                  : machineSummary(m);
          // Shown instead of an idle summary; a busy machine keeps showing its work.
          const waiting = busy ? 0 : pendingChanges(view, m.id).length;
          return (
            <div key={m.id}>
              <Row
                item={item}
                selected={is(item)}
                icon={
                  <StatusDot
                    tone={busy && m.connection.state === "connected" ? "busy" : status.tone}
                    hollow={status.hollow}
                  />
                }
                dot
                label={m.name}
                title={machineTooltip(m)}
                trailing={
                  waiting ? (
                    <span
                      className="inline-flex items-center gap-1.5 text-accent"
                      title={`${waiting === 1 ? "A change" : `${waiting} changes`} waiting to review`}
                    >
                      <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                      {waiting === 1 ? "1 change" : `${waiting} changes`}
                    </span>
                  ) : (
                    summary
                  )
                }
              />
              {own.map((r) => (
                <RunnerRow
                  key={r.key}
                  r={r}
                  selected={is({ path: "/runners/$key", params: { key: r.key } })}
                  nested
                  // Per-repository runners share a name; the scope tells them apart.
                  showScope={own.filter((o) => o.name === r.name).length > 1}
                />
              ))}
            </div>
          );
        })}
        {(view.pools.pools.length > 0 || admin) && (
          <Heading
            title="Pools"
            count={view.pools.pools.length}
            action={
              admin && (
                <Link
                  to="/pools/new"
                  aria-label="New pool"
                  title="New pool"
                  className="flex size-5 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <Icon name="plus" size={13} />
                </Link>
              )
            }
          />
        )}
        {view.pools.pools.map((p) => {
          const desired = view.pools.desired.filter((d) => d.poolId === p.id);
          const existing = desired.filter((d) =>
            view.runners.some(
              (r) => r.machineId === d.machineId && r.name.toLowerCase() === d.name.toLowerCase(),
            ),
          ).length;
          const item = { path: "/pools/$id", params: { id: p.id } };
          return (
            <Row
              key={p.id}
              item={item}
              selected={is(item)}
              icon={<Icon name="plan" />}
              label={p.name}
              trailing={
                p.mode === "onDemand"
                  ? p.paused
                    ? "Paused"
                    : (() => {
                        const n = view.pools.dispatches.filter(
                          (d) =>
                            d.poolId === p.id && (d.state === "starting" || d.state === "running"),
                        ).length;
                        return n ? `${n} running` : "On demand";
                      })()
                  : `${existing}/${desired.length}`
              }
            />
          );
        })}
        {(view.boat || boatRunners.length > 0) && (
          <>
            <Heading title="On demand" count={boatRunners.length} />
            <Row
              item={{ path: "/boat" }}
              selected={is({ path: "/boat" })}
              icon={<Icon name="runner" />}
              label="boat.dev"
              title="boat.dev: jobs with runs-on: boat"
              trailing={
                boatRunners.length
                  ? `${boatRunners.length} running${boatCost ? ` · ${formatDollars(boatCost)}` : ""}`
                  : view.boat
                    ? "Idle"
                    : ""
              }
            />
            {boatRunners.map((r) => (
              <RunnerRow
                key={r.key}
                r={r}
                nested
                underIcon
                showScope
                selected={is({ path: "/runners/$key", params: { key: r.key } })}
              />
            ))}
          </>
        )}
        {unassigned.length > 0 && (
          <>
            <Heading
              title="Unassigned runners"
              count={unassigned.reduce((n, g) => n + g.runners.length, 0)}
              open={showRunners}
              onToggle={() => setRunnersOpen(!runnersOpen)}
            />
            {showRunners &&
              unassigned.map((g) => (
                <div key={g.key}>
                  <div
                    className="truncate px-2 pt-1.5 pb-0.5 text-[11px] text-ink-3"
                    title={g.label}
                  >
                    {g.label}
                  </div>
                  {g.runners.map((r) => (
                    <RunnerRow
                      key={r.key}
                      r={r}
                      nested
                      // Per-repository runners share a name; the repository tells them apart.
                      showScope={g.runners.filter((o) => o.name === r.name).length > 1}
                      selected={is({ path: "/runners/$key", params: { key: r.key } })}
                    />
                  ))}
                </div>
              ))}
          </>
        )}
        {filtered.discovered.length > 0 && (
          <>
            <Heading
              title="Tailnet devices"
              count={filtered.discovered.length}
              open={showOther}
              onToggle={() => setOtherOpen(!otherOpen)}
            />
            {showOther &&
              filtered.discovered.map((p) => {
                const item = { path: "/peers/$nodeId", params: { nodeId: p.nodeId } };
                return (
                  <Row
                    key={p.nodeId}
                    item={item}
                    selected={is(item)}
                    icon={<StatusDot tone={p.online ? "ok" : "muted"} hollow />}
                    dot
                    label={p.name}
                    title={`${p.name}\n${p.address}\nOn your tailnet, not added to Runyard`}
                    trailing={p.online ? osLabel[p.os] : "Offline"}
                  />
                );
              })}
          </>
        )}
        {filtered.ignored.length > 0 && (
          <Row
            item={{ path: "/ignored" }}
            selected={is({ path: "/ignored" })}
            icon={<Icon name="eye-off" />}
            label="Ignored"
            trailing={filtered.ignored.length}
          />
        )}
        {searching &&
          !filtered.machines.length &&
          !filtered.discovered.length &&
          !filtered.ignored.length && <EmptyLine>No machines match “{query}”.</EmptyLine>}
      </nav>
      <Footer view={view} demo={demo} />
    </aside>
  );
}

/** A runner row, nested under its machine like aarondfrancis/fleet's tree. */
function RunnerRow({
  r,
  selected,
  nested,
  underIcon,
  showScope,
}: {
  r: RunnerView;
  selected: boolean;
  nested?: boolean;
  /** Nested under a row with an icon rather than a status dot: the line sits under the icon, and the
   * row steps in past the wider icon so its label stays 4px inside its parent's. */
  underIcon?: boolean;
  showScope?: boolean;
}) {
  const status = runnerStatus(r);
  return (
    <div className={nested ? `tree-child ${underIcon ? "under-icon pl-2" : ""}` : undefined}>
      <Row
        item={{ path: "/runners/$key", params: { key: r.key } }}
        selected={selected}
        indent={nested}
        label={showScope ? `${r.name} · ${r.scopeLabel.split("/").at(-1)}` : r.name}
        title={`${r.name} · ${r.scopeLabel}: ${status.label}`}
        trailing={
          <span
            className={`flex items-center gap-1.5 ${status.tone === "busy" ? "text-accent" : ""}`}
          >
            {r.job?.startedAt ? (
              <Elapsed since={r.job.startedAt} />
            ) : (
              <span className="sr-only">{status.label}</span>
            )}
            <StatusDot tone={status.tone} hollow={status.hollow} size={6} />
          </span>
        }
      />
    </div>
  );
}

function Row({
  item,
  selected,
  icon,
  label,
  trailing,
  title,
  indent,
  dot,
}: {
  item: NavItem;
  indent?: boolean;
  /** The icon is an 8px status dot: its slot is its own width, so the name sits close to it. */
  dot?: boolean;
  selected: boolean;
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
  title?: string;
}) {
  const navigate = useNavigate();
  return (
    <div
      className={`flex rounded-md ${indent ? "ml-5 h-6" : "h-7"} ${selected ? "bg-selected" : "hover:bg-hover"}`}
    >
      <button
        data-nav={navKey(item)}
        type="button"
        title={title}
        aria-current={selected ? "page" : undefined}
        onClick={() => void navigate({ to: item.path, params: item.params })}
        className={`flex min-w-0 flex-1 items-center gap-2 pr-2 pl-2 text-left ${selected ? "font-medium" : ""}`}
      >
        {icon && (
          <span
            className={`flex h-4 shrink-0 items-center justify-center text-ink-2 ${dot ? "w-2" : "w-4"}`}
          >
            {icon}
          </span>
        )}
        <span className={`min-w-0 flex-1 truncate ${indent ? "text-[12px]" : "text-[13px]"}`}>
          {label}
        </span>
        {trailing != null && (
          <span className="shrink-0 text-[11px] text-ink-2 tabular">{trailing}</span>
        )}
      </button>
    </div>
  );
}

function Heading({
  title,
  count,
  open,
  onToggle,
  action,
}: {
  title: string;
  count: number;
  open?: boolean;
  onToggle?: () => void;
  action?: ReactNode;
}) {
  const content = (
    <>
      <span className="truncate">{title}</span>
      <span className="ml-auto tabular">{count}</span>
      {onToggle && (
        <span style={{ transform: open ? "rotate(90deg)" : undefined }}>
          <Icon name="chevron" size={12} />
        </span>
      )}
    </>
  );
  const className =
    "flex h-7 min-w-0 flex-1 items-center gap-2 text-left text-[11px] font-medium tracking-wide text-ink-2 uppercase";
  return (
    <div className="mt-2 flex items-center gap-1 px-2">
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={open} className={className}>
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
      {action}
    </div>
  );
}

function Footer({ view, demo }: { view: YardView; demo: boolean }) {
  const apps = view.github.apps;
  const conns = view.forgejo.connections;
  const forgeError =
    apps.some((a) => a.error || a.installations.some((i) => i.runnersError)) ||
    // Forgejo refuses organization runners unless the user owns the organization, so
    // only a connection that fails outright counts here.
    conns.some((c) => c.error);
  const checked = [
    ...apps.flatMap((a) => a.installations.map((i) => i.runnersAt)),
    ...conns.flatMap((c) => c.scopes.map((s) => s.runnersAt)),
  ]
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)[0];
  const problem = Boolean(view.tailnet.error) || forgeError || view.alerts.length > 0;
  // aarondfrancis/fleet's footer: the state of the data sources, most pressing first. Details are on
  // the overview's Needs attention and Settings ▸ Connections.
  const text = demo ? (
    "Demo · fictional machines"
  ) : forgeError ? (
    <Link to="/settings/connections" className="hover:text-ink hover:underline">
      A forge can't be read
    </Link>
  ) : view.tailnet.error ? (
    "Tailscale unavailable"
  ) : checked ? (
    <>
      Runners checked <TimeAgo at={checked} />
    </>
  ) : apps.length || conns.length ? (
    "Waiting for the forges"
  ) : (
    <Link to="/settings/connections" className="hover:text-ink hover:underline">
      No forge connected
    </Link>
  );
  const noForge = !demo && apps.length === 0 && conns.length === 0;
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-[11px] text-ink-2">
      <StatusDot tone={problem ? "warn" : noForge ? "muted" : "ok"} hollow={noForge} size={6} />
      <span
        className="min-w-0 flex-1 truncate"
        title={
          !demo && !forgeError && view.tailnet.error
            ? view.tailnet.error
            : typeof text === "string"
              ? text
              : forgeError
                ? "Open Settings ▸ Connections to see which"
                : noForge
                  ? "Connect GitHub or Forgejo in Settings ▸ Connections"
                  : undefined
        }
      >
        {text}
      </span>
      <AccountMenu />
    </div>
  );
}
