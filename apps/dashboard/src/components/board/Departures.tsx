import { departures, type Departure, type DepartureTone, type YardView } from "@runyard/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatDollars, formatElapsed } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import { DialogButtons, TtDialog } from "../ConfirmDialog.tsx";
import { Lab } from "../pool/bits.tsx";
import { forgesConnected } from "../runners.tsx";
import { Facts, ttButton } from "../tt.tsx";
import { SplitFlap } from "./SplitFlap.tsx";

const FLAP_TONE: Record<DepartureTone, "moving" | "signal" | "go" | "flap"> = {
  moving: "moving",
  held: "signal",
  boarding: "go",
  neutral: "flap",
};

/** The design's columns, in cells: time, job, repository, platform and status. */
const COLS = { time: 5, job: 15, repo: 16, platform: 9, status: 19 } as const;
const CELLS = COLS.time + COLS.job + COLS.repo + COLS.platform + COLS.status;
/** The wait and cost column, wide enough for its heading. */
const WAIT_W = 76;
/** Row padding, the five gaps between columns, and the wait and cost column. */
const FIXED = 40 + 5 * 12 + WAIT_W;
/** Phone rows: how many show before "Show all", and the status flaps' size (14px cells, 1px gaps). */
const PHONE_ROWS = 5;
const PHONE_PITCH = 15;

function hhmm(ms: number): string {
  return ms
    ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : "--:--";
}

/**
 * The cells' size for the board's width: the design's 12px cells when there's room, smaller ones
 * on a narrower desktop so every column still fits, and two-line rows below 720px. For those, also
 * how many status cells span a row.
 */
function useCellSize(phone: boolean): [React.RefObject<HTMLElement | null>, number | null, number] {
  const ref = useRef<HTMLElement>(null);
  const [cell, setCell] = useState<number | null>(phone ? null : 12);
  const [status, setStatus] = useState(20);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      // Row padding is 24px; the last cell has no gap after it.
      setStatus(Math.max(14, Math.min(24, Math.floor((w - 24 + 1) / PHONE_PITCH))));
      if (phone || w < 720) return setCell(null);
      setCell(Math.max(8, Math.min(12, Math.floor((w - FIXED) / CELLS) - 1)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone]);
  return [ref, cell, status];
}

/**
 * The Board's departure board, as in the Timetable design: running jobs, then (past a dashed
 * line) jobs waiting for a runner, on split-flap rows that flip in when the board appears. A
 * running job's status counts up; the last column is how long a job has waited, or what its
 * on-demand VM has cost so far. A running job opens its runner; a waiting one opens Jobs.
 */
export function Departures({ view, phone = false }: { view: YardView; phone?: boolean }) {
  const rows = departures(view);
  const [ref, cell, statusCells] = useCellSize(phone);
  const [all, setAll] = useState(false);
  // Phones open a tapped row in a bottom sheet; desktop rows go straight to the runner or Jobs.
  const [sheet, setSheet] = useState<string | null>(null);
  const now = useNow();
  const navigate = useNavigate();
  const running = rows.filter((r) => r.kind === "running").length;
  const open = (d: Departure) =>
    void (d.runnerKey
      ? navigate({ to: "/runners/$key", params: { key: d.runnerKey } })
      : navigate({ to: "/queue" }));
  const sign = (d: Departure) =>
    d.kind === "running" && d.at ? `${d.sign} ${formatElapsed(now - d.at)}` : d.sign;
  const waitOrCost = (d: Departure) => {
    if (d.kind === "waiting") return formatElapsed(now - d.at);
    const dollars = d.runnerKey ? view.boatVms[d.runnerKey]?.dollars : undefined;
    return dollars != null ? formatDollars(dollars) : "";
  };
  const rowsLayout = cell === null;
  const size: CSSProperties = rowsLayout
    ? ({ "--flap-w": "14px", "--flap-h": "22px", "--flap-fs": "13.5px" } as CSSProperties)
    : ({
        "--flap-w": `${cell}px`,
        "--flap-h": `${cell * 2}px`,
        "--flap-fs": `${cell + 2}px`,
      } as CSSProperties);
  const width = (n: number) => `calc(${n} * (var(--flap-w) + var(--flap-g, 1px)) - 1px)`;

  return (
    <section
      ref={ref}
      aria-labelledby="departures-title"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-tt-board-edge bg-tt-board pb-1.5 text-tt-flap shadow-[0_1px_0_rgba(255,255,255,.05)_inset,0_18px_40px_-24px_rgba(0,0,0,.6)]"
      style={size}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pt-[18px] pb-1.5">
        <div className="min-w-0">
          <h2
            id="departures-title"
            className="text-[30px] leading-none font-extrabold tracking-[.01em] [font-stretch:75%]"
          >
            Departures
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#8b9099]">
            {rows.length === 0
              ? forgesConnected(view)
                ? "All quiet"
                : "No service yet"
              : `${running} on ${running === 1 ? "its" : "their"} way · ${rows.length - running} waiting`}
          </p>
        </div>
        {!rowsLayout && rows.length > 0 && (
          <ul className="flex gap-3.5 text-[11.5px] text-[#8b9099]">
            <li className="flex items-center gap-1.5">
              <i className="size-2 rounded-[2px] bg-tt-loco" />
              On its way
            </li>
            <li className="flex items-center gap-1.5">
              <i className="size-2 rounded-[2px] bg-tt-signal" />
              Held up
            </li>
            <li className="flex items-center gap-1.5">
              <i className="size-2 rounded-[2px] bg-[#6fe39b]" />
              Boarding or arrived
            </li>
          </ul>
        )}
      </header>

      {rows.length === 0 ? (
        // The design's empty board: what the board will show, on board rows of their own.
        <div className="mt-2">
          {(forgesConnected(view)
            ? [
                { text: "All quiet", tone: "dim" as const },
                { text: "No jobs running or waiting", tone: "dim" as const },
              ]
            : rowsLayout
              ? [
                  { text: "No departures yet", tone: "flap" as const },
                  { text: "Connect a forge", tone: "signal" as const },
                  { text: "to get started", tone: "signal" as const },
                ]
              : [
                  { text: "No departures yet", tone: "flap" as const },
                  { text: "Connect a forge to start", tone: "signal" as const },
                  { text: "Then add a machine and a pool", tone: "flap" as const },
                ]
          ).map((r, i) => (
            <div
              key={r.text}
              className={`flex items-center gap-3 border-t border-[#1a1c20] py-[5px] ${rowsLayout ? "px-3" : "px-5"}`}
            >
              {!rowsLayout && (
                <SplitFlap text={i === 0 ? "--:--" : ""} cells={5} delay={i * 0.08} />
              )}
              <SplitFlap
                text={r.text}
                cells={rowsLayout ? statusCells : 30}
                tone={r.tone}
                delay={i * 0.08 + 0.06}
              />
            </div>
          ))}
          <p className="px-5 pt-3 pb-2 text-[11.5px] text-[#9aa0a9] max-lg:px-3">
            Jobs appear here as they're queued and picked up by your runners.
          </p>
        </div>
      ) : rowsLayout ? (
        // Phones flip only what changes, the time and the status; the job, its repository and
        // platform are plain text, which stays readable at any width.
        <ul>
          {(all ? rows : rows.slice(0, PHONE_ROWS)).map((d, i) => (
            <li
              key={d.key}
              className={
                i > 0 && d.kind === "waiting" && rows[i - 1]!.kind === "running"
                  ? "border-t border-dashed border-[#343841]"
                  : "border-t border-[#1a1c20]"
              }
            >
              <button
                type="button"
                onClick={() => setSheet(d.key)}
                title={d.status}
                className="flex w-full flex-col gap-[7px] px-3 py-2.5 text-left hover:bg-tt-board-2"
              >
                <span className="flex items-center gap-2.5">
                  <SplitFlap text={hhmm(d.at)} cells={5} delay={i * 0.08} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[14.5px] leading-[1.2] font-bold">{d.job}</b>
                    <small className="block truncate text-[12px] leading-[1.3] text-[#8b9099]">
                      {d.repo}
                      {d.platform && (
                        <>
                          {" · "}
                          <span
                            className={
                              d.tone === "moving"
                                ? "text-tt-loco"
                                : d.tone === "boarding"
                                  ? "text-[#6fe39b]"
                                  : "text-[#c3c7cf]"
                            }
                          >
                            {d.platform}
                          </span>
                        </>
                      )}
                    </small>
                  </span>
                  <span className="flex-none self-start font-board text-[12px] leading-[1.2] font-medium text-[#8b9099] tabular">
                    {waitOrCost(d)}
                  </span>
                </span>
                <SplitFlap
                  text={sign(d)}
                  cells={statusCells}
                  tone={FLAP_TONE[d.tone]}
                  delay={i * 0.08 + 0.1}
                />
              </button>
            </li>
          ))}
          {rows.length > PHONE_ROWS && (
            <li className="border-t border-[#1a1c20]">
              <button
                type="button"
                onClick={() => setAll(!all)}
                aria-expanded={all}
                className="w-full px-3 py-[13px] text-left text-[13px] font-semibold hover:bg-tt-board-2"
              >
                {all ? (
                  "Show fewer"
                ) : (
                  <>
                    Show all {rows.length} departures{" "}
                    <span className="font-medium text-[#8b9099]">
                      · {rows.length - PHONE_ROWS} more
                    </span>
                  </>
                )}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <div>
          <div className="flex items-center gap-3 px-5 pt-2.5 pb-2 text-[10.5px] font-semibold tracking-[.1em] text-[#8b9099] uppercase">
            <span className="flex-none" style={{ width: width(COLS.time) }}>
              Time
            </span>
            <span className="flex-none" style={{ width: width(COLS.job) }}>
              Job
            </span>
            <span className="flex-none" style={{ width: width(COLS.repo) }}>
              Repository
            </span>
            <span className="flex-none" style={{ width: width(COLS.platform) }}>
              Platform
            </span>
            <span className="flex-none" style={{ width: width(COLS.status) }}>
              Status
            </span>
            <span
              className="ml-auto shrink-0 text-right whitespace-nowrap"
              style={{ width: WAIT_W }}
            >
              Wait · cost
            </span>
          </div>
          {rows.map((d, i) => {
            const tone = FLAP_TONE[d.tone];
            const base = i * 0.08;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => open(d)}
                title={d.status}
                className={`flex h-[calc(var(--flap-h)+10px)] w-full items-center gap-3 px-5 text-left hover:bg-tt-board-2 ${
                  i > 0 && d.kind === "waiting" && rows[i - 1]!.kind === "running"
                    ? "border-t border-dashed border-[#343841]"
                    : "border-t border-[#1a1c20]"
                }`}
              >
                <SplitFlap text={hhmm(d.at)} cells={COLS.time} delay={base} />
                <SplitFlap text={d.job} cells={COLS.job} delay={base + 0.06} />
                <SplitFlap text={d.repo} cells={COLS.repo} delay={base + 0.12} />
                <SplitFlap
                  text={d.platform}
                  cells={COLS.platform}
                  tone={tone}
                  delay={base + 0.18}
                />
                <SplitFlap text={sign(d)} cells={COLS.status} tone={tone} delay={base + 0.24} />
                <span
                  className="ml-auto shrink-0 text-right font-board text-[12px] font-medium text-[#8b9099] tabular"
                  style={{ width: WAIT_W }}
                >
                  {waitOrCost(d)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <DepartureSheet
        view={view}
        departure={rows.find((d) => d.key === sheet) ?? null}
        onClose={() => setSheet(null)}
        now={now}
        cost={(d) => waitOrCost(d)}
      />
      {rows.length > 0 && (
        <p className="px-5 pt-2.5 pb-2 text-[11.5px] text-[#9aa0a9]">
          Times are when a job started or was queued.{" "}
          {rowsLayout
            ? "Tap a row for details."
            : "Select a row to see its runner, or why it's waiting."}
        </p>
      )}
    </section>
  );
}

/**
 * A tapped departure on a phone, as a bottom sheet: a running job's runner, how long it has run and
 * what it has cost; a waiting job's labels and why it waits. It links on to the runner, its machine
 * or Jobs.
 */
function DepartureSheet({
  view,
  departure: d,
  onClose,
  now,
  cost,
}: {
  view: YardView;
  departure: Departure | null;
  onClose: () => void;
  now: number;
  cost: (d: Departure) => string;
}) {
  const runner = d?.runnerKey ? view.runners.find((r) => r.key === d.runnerKey) : undefined;
  const machine = runner?.machineId
    ? view.machines.find((m) => m.id === runner.machineId)
    : undefined;
  const notice =
    d?.tone === "held"
      ? "bg-tt-warn-bg text-tt-warn-ink"
      : d?.tone === "boarding"
        ? "bg-tt-ok-bg text-tt-ok-ink"
        : "bg-tt-hover text-tt-ink-2";
  return (
    <TtDialog open={d !== null} onOpenChange={(o) => !o && onClose()} title={d?.job ?? ""}>
      {d && (
        <>
          <p className="text-[14px] text-tt-ink-2">
            {d.repo}
            {d.platform && ` · ${d.platform}`}
          </p>
          {d.kind === "running" ? (
            <div className="-mx-4 mt-2">
              <Facts
                rows={[
                  ["Started", hhmm(d.at)],
                  ["Running for", d.at ? formatElapsed(now - d.at) : "Not reported"],
                  ["Runner", <span className="font-board">{runner?.name ?? d.platform}</span>],
                  ...(machine ? [["Machine", machine.name] as [string, string]] : []),
                  ...(cost(d) ? [["Cost so far", cost(d)] as [string, string]] : []),
                ]}
              />
            </div>
          ) : (
            <>
              {d.labels.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {d.labels.map((l) => (
                    <Lab key={l}>{l}</Lab>
                  ))}
                </div>
              )}
              <p className={`mt-3 rounded-lg px-3.5 py-2.5 text-[13.5px] font-semibold ${notice}`}>
                {d.status} · waiting {formatElapsed(now - d.at)}
              </p>
            </>
          )}
          <DialogButtons>
            {machine && (
              <Link
                to="/machines/$id"
                params={{ id: machine.id }}
                className={`${ttButton.secondary} max-sm:flex-1`}
              >
                Open {machine.name}
              </Link>
            )}
            {d.runnerKey ? (
              <Link
                to="/runners/$key"
                params={{ key: d.runnerKey }}
                className={`${ttButton.primary} max-sm:flex-1`}
              >
                Open runner
              </Link>
            ) : (
              <Link to="/queue" className={`${ttButton.primary} max-sm:flex-1`}>
                Open in Jobs
              </Link>
            )}
          </DialogButtons>
        </>
      )}
    </TtDialog>
  );
}
