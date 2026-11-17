import type { YardView } from "@runyard/core";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { SplitFlap } from "../../components/board/SplitFlap.tsx";
import { Icon } from "../../components/icons.tsx";
import { MachinesCards, MachinesTable } from "../../components/machine/MachinesTable.tsx";
import { Chip, PageHead, Panel, Row, ttButton, ttRowButton } from "../../components/tt.tsx";
import { filterYard, unassignedGroups } from "../../lib/nav.ts";
import { sessionQuery } from "../../lib/queries.ts";
import { osLabel } from "../../lib/status.ts";
import { useYard } from "../../lib/yard.ts";

export const Route = createFileRoute("/_app/machines/")({
  component: Machines,
});

const LEDE =
  "Every platform in the yard. Runyard checks them over SSH every minute and changes nothing without a review.";

/** More machines than this, and the page offers a filter. */
const FILTER_FROM = 6;

/**
 * Machines, as in the Timetable design: a table of every machine with its readings (a card list on
 * phones), then runners outside pools and tailnet devices not added yet, side by side.
 */
function Machines() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterYard(view, query), [view, query]);
  const searching = query.trim() !== "";
  const empty = view.machines.length === 0;
  return (
    <div>
      <PageHead
        title="Machines"
        lede={<span className="max-lg:hidden">{LEDE}</span>}
        actions={
          <>
            {view.machines.length > FILTER_FROM && <Filter query={query} setQuery={setQuery} />}
            {admin && !empty && (
              <Link to="/machines/add" className={ttButton.primary}>
                <Icon name="plus" size={14} />
                Add machine
              </Link>
            )}
          </>
        }
      />
      {empty ? (
        <Panel>
          <Empty
            flap="No machines yet"
            title={admin ? "Add your first machine" : "No machines yet"}
            body={
              admin
                ? "Runyard connects over SSH or Tailscale, checks the machine is ready to build, and changes nothing until you review it."
                : "An admin hasn't added machines yet."
            }
          >
            {admin && (
              <Link to="/machines/add" className={ttButton.primary}>
                <Icon name="plus" size={14} />
                Add machine
              </Link>
            )}
          </Empty>
        </Panel>
      ) : searching && !filtered.machines.length ? (
        <Panel>
          <p className="px-4 py-4 text-tt-ink-2">No machine matches “{query}”.</p>
        </Panel>
      ) : (
        <>
          <div className="max-lg:hidden">
            <MachinesTable view={view} machines={filtered.machines} />
          </div>
          <div className="lg:hidden">
            <MachinesCards view={view} machines={filtered.machines} />
          </div>
        </>
      )}
      <Extras view={filtered} admin={admin} />
    </div>
  );
}

function Filter({ query, setQuery }: { query: string; setQuery: (q: string) => void }) {
  return (
    <label className="relative block w-full sm:w-60">
      <span className="sr-only">Filter machines and runners</span>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tt-ink-3">
        <Icon name="search" />
      </span>
      <input
        className="input !h-[38px] !rounded-lg !border-tt-rule-2 !bg-tt-card !pl-8 text-[13px]"
        placeholder="Filter by name, address, OS or label"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
      />
    </label>
  );
}

/** Runners not in a pool, and tailnet devices not added: two columns on desktop. */
function Extras({ view, admin }: { view: YardView; admin: boolean }) {
  const unassigned = unassignedGroups(view.runners).flatMap((g) => g.runners);
  const tailnet = view.discovered.length > 0 || view.ignored.length > 0;
  if (!unassigned.length && !tailnet) return null;
  return (
    <div
      className={`mt-3 grid grid-cols-1 items-start gap-3 lg:mt-[18px] lg:gap-[18px] ${
        unassigned.length && tailnet ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" : ""
      }`}
    >
      {unassigned.length > 0 && (
        <Panel title="Runners not in a pool" meta={unassigned.length}>
          {unassigned.map((r) => (
            <Row key={r.key}>
              <span className="text-tt-ink-3">
                <Icon name="runner" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-mono text-[13px] font-bold">{r.name}</b>
                <small className="block truncate text-[12px] text-tt-ink-3">
                  {[r.forge === "forgejo" ? "Forgejo" : "GitHub", r.scopeLabel, r.labels.join(", ")]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <Chip tone={r.status === "online" ? "ok" : "neutral"}>
                {r.status === "online" ? "Online" : "Offline"}
              </Chip>
              {/* The runner's page chooses its machine, then moves it into a pool. */}
              <Link to="/runners/$key" params={{ key: r.key }} className={ttRowButton.secondary}>
                {admin ? "Take over" : "Open"}
              </Link>
            </Row>
          ))}
        </Panel>
      )}
      {tailnet && (
        <Panel title="On your tailnet, not added" meta={view.discovered.length}>
          {view.discovered.map((p) => (
            <Row key={p.nodeId}>
              <span className="text-tt-ink-3">
                <Icon name="machine" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-bold">{p.name}</b>
                <small className="block truncate text-[12px] text-tt-ink-3">
                  {p.address} · {osLabel[p.os]} · {p.online ? "online" : "offline"}
                </small>
              </span>
              <Link
                to="/peers/$nodeId"
                params={{ nodeId: p.nodeId }}
                className={admin ? ttRowButton.primary : ttRowButton.secondary}
              >
                {admin ? "Add" : "Open"}
              </Link>
            </Row>
          ))}
          {view.ignored.length > 0 && (
            <Row>
              <span className="text-tt-ink-3">
                <Icon name="eye-off" />
              </span>
              <span className="min-w-0 flex-1 text-[13px] text-tt-ink-2">
                {view.ignored.length} ignored {view.ignored.length === 1 ? "device" : "devices"}
              </span>
              <Link to="/ignored" className={ttRowButton.secondary}>
                Show
              </Link>
            </Row>
          )}
        </Panel>
      )}
    </div>
  );
}

/** The design's empty state: a short line of flaps, a title, a sentence and what to do. */
function Empty({
  flap,
  title,
  body,
  children,
}: {
  flap: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex max-w-[660px] flex-col items-start gap-2.5 px-6 pt-[26px] pb-7 max-lg:px-4 max-lg:pt-5 max-lg:pb-[22px]">
      <div
        className="rounded-md bg-tt-board p-1.5"
        style={{ "--flap-w": "14px", "--flap-h": "26px", "--flap-fs": "15px" } as CSSProperties}
      >
        <SplitFlap text={flap} cells={flap.length} tone="signal" />
      </div>
      <h3 className="text-[18px] leading-tight font-extrabold">{title}</h3>
      <p className="text-[14px] text-tt-ink-2">{body}</p>
      {children && <div className="mt-1 flex flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  );
}
