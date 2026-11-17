import { departures, type Departure, type DepartureTone, type YardView } from "@runyard/core";
import { useNavigate } from "@tanstack/react-router";
import { forgesConnected } from "../runners.tsx";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Elapsed } from "../runners.tsx";
import { SplitFlap } from "./SplitFlap.tsx";

const FLAP_TONE: Record<DepartureTone, "moving" | "signal" | "go" | "flap"> = {
  moving: "moving",
  held: "signal",
  boarding: "go",
  neutral: "flap",
};

/** Columns, in flap cells, for the width the board gets. */
const WIDE = { time: 5, job: 15, repo: 16, platform: 9, status: 19 };
const MEDIUM = { time: 5, job: 15, repo: 0, platform: 9, status: 19 };
type Layout = "wide" | "medium" | "rows";

function hhmm(ms: number): string {
  return ms
    ? new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : "--:--";
}

/** The board's own width decides its columns: all five, without the repository, or two-line rows. */
function useLayout(phone: boolean): [React.RefObject<HTMLElement | null>, Layout] {
  const ref = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<Layout>(phone ? "rows" : "wide");
  useEffect(() => {
    const el = ref.current;
    if (!el || phone) return;
    const fit = () => {
      const w = el.clientWidth;
      setLayout(w >= 1000 ? "wide" : w >= 720 ? "medium" : "rows");
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone]);
  return [ref, layout];
}

/**
 * The Board's departure board: running jobs, then jobs waiting for a runner, on split-flap rows.
 * A running job opens its runner; a waiting one opens the queue with its reasons.
 */
export function Departures({ view, phone = false }: { view: YardView; phone?: boolean }) {
  const rows = departures(view);
  const [ref, layout] = useLayout(phone);
  const navigate = useNavigate();
  const running = rows.filter((r) => r.kind === "running").length;
  const open = (d: Departure) =>
    void (d.runnerKey
      ? navigate({ to: "/runners/$key", params: { key: d.runnerKey } })
      : navigate({ to: "/queue" }));
  const cols = layout === "wide" ? WIDE : MEDIUM;
  const size: CSSProperties =
    layout === "rows"
      ? ({ "--flap-w": "13px", "--flap-h": "22px", "--flap-fs": "12.5px" } as CSSProperties)
      : ({ "--flap-w": "12px", "--flap-h": "24px", "--flap-fs": "13px" } as CSSProperties);

  return (
    <section
      ref={ref}
      aria-labelledby="departures-title"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-tt-board-edge bg-tt-board pb-2 text-tt-flap"
      style={size}
    >
      <header className="flex flex-wrap items-end gap-x-6 gap-y-2 px-5 pt-[18px] pb-2">
        <div className="min-w-0 flex-1">
          <h2
            id="departures-title"
            className="text-[30px] leading-none font-extrabold tracking-[.01em] [font-stretch:75%]"
          >
            Departures
          </h2>
          <p className="mt-1 text-[12.5px] text-[#8b9099]">
            {running} on {running === 1 ? "its" : "their"} way · {rows.length - running} waiting
          </p>
        </div>
        {layout !== "rows" && (
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
              Boarding
            </li>
          </ul>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col gap-1.5 px-5 py-3">
          {forgesConnected(view) ? (
            <>
              <SplitFlap text="All quiet" cells={layout === "rows" ? 20 : 26} tone="dim" />
              <SplitFlap
                text="No jobs running or waiting"
                cells={layout === "rows" ? 20 : 26}
                tone="dim"
              />
            </>
          ) : (
            <>
              <SplitFlap text="No departures yet" cells={layout === "rows" ? 20 : 30} />
              <SplitFlap
                text="Connect a forge to start"
                cells={layout === "rows" ? 20 : 30}
                tone="signal"
              />
              {layout !== "rows" && (
                <SplitFlap text="Then add a machine and a pool" cells={30} tone="dim" />
              )}
            </>
          )}
          <p className="mt-2 text-[12px] text-[#9aa0a9]">
            Jobs appear here as they're queued and picked up by your runners.
          </p>
        </div>
      ) : layout === "rows" ? (
        <ul>
          {rows.map((d) => (
            <li key={d.key} className="border-t border-[#1a1c20]">
              <button
                type="button"
                onClick={() => open(d)}
                className="flex w-full flex-col gap-1.5 px-4 py-2.5 text-left hover:bg-tt-board-2"
              >
                <span className="flex items-center gap-2.5">
                  <SplitFlap text={hhmm(d.at)} cells={5} />
                  <SplitFlap text={d.job} cells={14} />
                  <span className="ml-auto font-board text-[12px] text-[#8b9099] tabular">
                    {d.at ? <Elapsed since={d.at} /> : null}
                  </span>
                </span>
                <span className="flex items-center gap-2.5">
                  <SplitFlap text={d.status} cells={20} tone={FLAP_TONE[d.tone]} />
                </span>
                <span className="truncate text-[12px] text-[#9aa0a9]">
                  {d.repo}
                  {d.platform ? ` · ${d.platform}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <div className="flex gap-3 px-5 pt-2.5 pb-2 text-[10.5px] font-semibold tracking-[.1em] text-[#8b9099] uppercase">
            <span style={{ width: `calc(${cols.time} * (var(--flap-w) + 2px))` }}>Time</span>
            <span style={{ width: `calc(${cols.job} * (var(--flap-w) + 2px))` }}>Job</span>
            {cols.repo > 0 && (
              <span style={{ width: `calc(${cols.repo} * (var(--flap-w) + 2px))` }}>
                Repository
              </span>
            )}
            <span style={{ width: `calc(${cols.platform} * (var(--flap-w) + 2px))` }}>
              Platform
            </span>
            <span>Status</span>
          </div>
          {rows.map((d, i) => (
            <button
              key={d.key}
              type="button"
              onClick={() => open(d)}
              title={`${d.job} · ${d.repo}${d.platform ? ` · ${d.platform}` : ""}`}
              className={`flex h-[calc(var(--flap-h)+10px)] w-full items-center gap-3 px-5 text-left hover:bg-tt-board-2 ${
                i > 0 && d.kind === "waiting" && rows[i - 1]!.kind === "running"
                  ? "border-t border-dashed border-[#343841]"
                  : "border-t border-[#1a1c20]"
              }`}
            >
              <SplitFlap text={hhmm(d.at)} cells={cols.time} />
              <SplitFlap text={d.job} cells={cols.job} />
              {cols.repo > 0 && <SplitFlap text={d.repo} cells={cols.repo} tone="dim" />}
              <SplitFlap text={d.platform} cells={cols.platform} tone="dim" />
              <SplitFlap text={d.status} cells={cols.status} tone={FLAP_TONE[d.tone]} />
              <span className="ml-auto w-12 shrink-0 text-right font-board text-[12px] text-[#8b9099] tabular">
                {d.at ? <Elapsed since={d.at} /> : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
