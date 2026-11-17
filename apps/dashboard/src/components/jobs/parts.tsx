import type { CSSProperties, ReactNode } from "react";
import { SplitFlap } from "../board/SplitFlap.tsx";

/*
 * Pieces of the Timetable design's Jobs page: the tab row that sits on its table, the count pills,
 * the result tags, phone rows and the empty state.
 */

export type TabDef<T extends string> = { key: T; label: string; count?: number };

/** The design's tabs: dark when selected, on a heavy rule the table panel hangs from. */
export function TabsRow<T extends string>({
  tabs,
  tab,
  onTab,
  end,
}: {
  tabs: TabDef<T>[];
  tab: T;
  onTab: (t: T) => void;
  /** Controls at the right end, like Failures only. */
  end?: ReactNode;
}) {
  return (
    <div
      role="tablist"
      aria-label="Jobs"
      className="flex items-end border-b-2 border-tt-ink max-lg:[scrollbar-width:none] max-lg:overflow-x-auto"
    >
      {tabs.map((t) => {
        const on = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onTab(t.key)}
            className={`inline-flex flex-none items-center gap-2 rounded-t-md px-4 py-2.5 text-[15px] font-bold whitespace-nowrap max-lg:px-3 max-lg:py-[9px] max-lg:text-[13px] ${
              on ? "bg-tt-inv text-tt-on-inv" : "text-tt-ink-2 hover:bg-tt-rule hover:text-tt-ink"
            }`}
          >
            {t.label}
            {t.count !== undefined && <Count n={t.count} on={on} />}
          </button>
        );
      })}
      {end && <span className="ml-auto flex-none pb-2 pl-3">{end}</span>}
    </div>
  );
}

/** A tab's count, as the design's rounded pill. */
function Count({ n, on }: { n: number; on: boolean }) {
  const tone = on
    ? n
      ? "bg-tt-signal text-tt-on-signal"
      : "bg-tt-on-inv/25 text-tt-on-inv"
    : n
      ? "bg-tt-inv text-tt-on-inv"
      : "bg-tt-rule text-tt-ink-2";
  return (
    <span
      aria-label={`${n} ${n === 1 ? "job" : "jobs"}`}
      className={`inline-grid h-5 min-w-6 place-items-center rounded-[10px] px-[7px] font-board text-[12px] leading-none font-bold tabular ${tone}`}
    >
      {n}
    </span>
  );
}

/** The design's checkbox toggle, like Failures only. */
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold whitespace-nowrap text-tt-ink-2">
      <input
        type="checkbox"
        className="size-4 accent-[var(--tt-ink)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

export type Result = "passed" | "failed" | "cancelled" | "running" | "unknown" | "lost";

const RESULT: Record<Result, [string, string]> = {
  passed: ["passed", "bg-tt-ok-bg text-tt-ok-ink"],
  failed: ["failed", "bg-tt-bad-bg text-tt-bad-ink"],
  cancelled: ["cancelled", "bg-tt-paper text-tt-ink-2"],
  running: ["running", "bg-tt-busy-bg text-tt-busy-ink"],
  unknown: ["pending", "bg-tt-paper text-tt-ink-2"],
  lost: ["lost", "bg-tt-bad-bg text-tt-bad-ink"],
};

/** A job's result as the design's small upper-case tag. */
export function ResultTag({ result }: { result: Result }) {
  const [label, tone] = RESULT[result];
  return (
    <span
      className={`inline-block rounded-[4px] px-1.5 py-1 font-board text-[11px] leading-none font-bold tracking-[.04em] whitespace-nowrap uppercase ${tone}`}
    >
      {label}
    </span>
  );
}

/** Why a job waits, colored like the design: held up in amber, about to board in green. */
export const WHY_TONE = {
  held: "text-tt-warn-ink",
  boarding: "text-tt-ok-ink",
  moving: "text-tt-busy-ink",
  neutral: "text-tt-ink",
} as const;

/** A phone row: what leads, the bold title and its line, and what's at the end. */
export function MRow({
  lead,
  title,
  detail,
  end,
  onClick,
  expanded,
}: {
  lead?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  end?: ReactNode;
  onClick?: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="flex w-full items-center gap-3 border-t border-tt-rule px-3.5 py-[13px] text-left first:border-t-0 hover:bg-tt-hover"
    >
      {lead}
      <span className="min-w-0 flex-1">
        <b className="block truncate font-bold">{title}</b>
        {detail && <small className="block truncate text-[12px] text-tt-ink-3">{detail}</small>}
      </span>
      {end && <span className="flex-none text-right text-[12px] text-tt-ink-3 tabular">{end}</span>}
    </button>
  );
}

/** The design's empty state: a short line of flaps, a title, a sentence and what to do. */
export function JobsEmpty({
  flap,
  title,
  children,
  actions,
}: {
  flap: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
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
      <div className="text-[14px] text-tt-ink-2">{children}</div>
      {actions && <div className="mt-1 flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}
