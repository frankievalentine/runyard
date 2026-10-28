import type { FleetView } from "@runyard/core";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { navKey, type NavItem } from "../lib/nav.ts";
import { machineStatus, machineSummary, machineTooltip, osLabel } from "../lib/status.ts";
import { AccountMenu } from "./AccountMenu.tsx";
import { Icon } from "./icons.tsx";
import { EmptyLine, StatusDot, TimeAgo } from "./ui.tsx";

/** fleet's sidebar: overview, filter, machines, other machines and ignored. `filtered` is `view` narrowed by the query. */
export function Sidebar({
  view,
  filtered,
  query,
  setQuery,
  otherOpen,
  setOtherOpen,
  selected,
  admin,
  demo,
}: {
  view: FleetView;
  filtered: FleetView;
  query: string;
  setQuery: (q: string) => void;
  otherOpen: boolean;
  setOtherOpen: (open: boolean) => void;
  selected: string;
  admin: boolean;
  demo: boolean;
}) {
  const searching = query.trim() !== "";
  const showOther = searching || otherOpen;
  const is = (item: NavItem) => navKey(item) === selected;

  return (
    <aside
      aria-label="Fleet navigation"
      className="flex h-full w-[256px] shrink-0 flex-col border-r border-line bg-sidebar"
    >
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-ink text-bg">
          <Icon name="server" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-semibold">Runyard</div>
          <div className="mt-0.5 truncate text-[11px] text-ink-2">
            {view.tailnet.name ? `${view.tailnet.name} · self-hosted` : "Self-hosted runners"}
          </div>
        </div>
      </div>
      <nav className="space-y-0.5 p-2" aria-label="Overview">
        <Row
          item={{ path: "/" }}
          selected={is({ path: "/" })}
          icon={<Icon name="grid" size={16} />}
          label="Fleet overview"
          trailing={view.machines.length}
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
          return (
            <Row
              key={m.id}
              item={item}
              selected={is(item)}
              icon={<StatusDot tone={status.tone} hollow={status.hollow} />}
              label={m.name}
              title={machineTooltip(m)}
              trailing={machineSummary(m)}
            />
          );
        })}
        {filtered.discovered.length > 0 && (
          <>
            <Heading
              title="Other machines"
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
                    label={p.name}
                    title={`${p.name}\n${p.address}`}
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

function Row({
  item,
  selected,
  icon,
  label,
  trailing,
  title,
}: {
  item: NavItem;
  selected: boolean;
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
  title?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className={`flex h-7 rounded-md ${selected ? "bg-selected" : "hover:bg-hover"}`}>
      <button
        data-nav={navKey(item)}
        type="button"
        title={title}
        aria-current={selected ? "page" : undefined}
        onClick={() => void navigate({ to: item.path, params: item.params })}
        className={`flex min-w-0 flex-1 items-center gap-2 pr-2 pl-2 text-left ${selected ? "font-medium" : ""}`}
      >
        {icon && (
          <span className="flex size-4 shrink-0 items-center justify-center text-ink-2">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
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

function Footer({ view, demo }: { view: FleetView; demo: boolean }) {
  const problem = Boolean(view.tailnet.error) || view.alerts.length > 0;
  const text = demo ? (
    "Demo · fictional machines"
  ) : view.tailnet.error ? (
    `Tailscale unavailable: ${view.tailnet.error}`
  ) : view.tailnet.at ? (
    <>
      Tailnet checked <TimeAgo at={view.tailnet.at} />
    </>
  ) : (
    "Checking Tailscale…"
  );
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-[11px] text-ink-2">
      <StatusDot tone={problem ? "warn" : "ok"} size={6} />
      <span className="min-w-0 flex-1 truncate" title={typeof text === "string" ? text : undefined}>
        {text}
      </span>
      <AccountMenu />
    </div>
  );
}
