import type { MachineView, Pool, YardView } from "@runyard/core";
import type { ReactNode } from "react";
import { runnerFor } from "../../lib/pools.ts";
import { CopyValue } from "../CopyValue.tsx";
import { Icon } from "../icons.tsx";
import { Chip, type ChipTone } from "../tt.tsx";

/*
 * Small pieces the Pools list, the pool page and New pool share, from the Timetable design.
 */

/** A pool's chip: on demand, paused, running or idle; persistent, how many of its runners exist. */
export function poolStatus(view: YardView, pool: Pool): { tone: ChipTone; label: string } {
  if (pool.mode === "onDemand") {
    if (pool.paused) return { tone: "warn", label: "Paused" };
    const running = view.pools.dispatches.filter(
      (d) => d.poolId === pool.id && (d.state === "starting" || d.state === "running"),
    ).length;
    return running ? { tone: "busy", label: `${running} running` } : { tone: "ok", label: "Idle" };
  }
  const desired = view.pools.desired.filter((d) => d.poolId === pool.id);
  const runners = desired.flatMap((d) => runnerFor(view, d) ?? []);
  if (desired.length === 0) return { tone: "neutral", label: "No runners" };
  if (runners.length < desired.length)
    return { tone: "warn", label: `${runners.length} of ${desired.length} runners` };
  if (runners.every((r) => r.activity === "offline")) return { tone: "error", label: "Offline" };
  return { tone: "ok", label: "Running" };
}

/** A machine's connection as a chip, like the design's machine state. */
export function machineChip(m: MachineView): ReactNode {
  switch (m.connection.state) {
    case "connected":
      return <Chip tone="ok">Online</Chip>;
    case "stale":
      return <Chip tone="warn">Stale</Chip>;
    case "offline":
      return <Chip>Offline</Chip>;
    case "error":
      return <Chip tone="error">SSH failed</Chip>;
    case "pending":
      return <Chip>Checking</Chip>;
  }
}

/** A label as the design's small mono tag. */
export function Lab({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[4px] border border-tt-rule-2 bg-tt-card px-[7px] py-1 font-board text-[11.5px] leading-none whitespace-nowrap text-tt-ink-2">
      {children}
    </span>
  );
}

/** The design's dark code box, with a copy button at its top right. */
export function CodeBox({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative rounded-[10px] bg-tt-board py-3.5 pr-[52px] pl-4 font-board text-[12.5px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap text-tt-flap">
      {text}
      <CopyValue
        value={text}
        label={label}
        showIcon={false}
        className="absolute top-2 right-2 size-[34px] justify-center rounded-[7px] bg-[#26292f] text-tt-flap hover:bg-[#33373e] hover:text-tt-flap"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="5" width="8" height="9" rx="1.5" />
          <path d="M10 5V3.5A1.5 1.5 0 0 0 8.5 2h-5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
        </svg>
      </CopyValue>
    </div>
  );
}

/** A form error in the design's words: a warning sign and a line. */
export function ErrLine({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-tt-bad-ink">
      <Icon name="alert" size={14} />
      {children}
    </p>
  );
}

/** A quiet note under a control. */
export function NpNote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mt-2 max-w-[70ch] text-[12.5px] text-tt-ink-3 ${className}`}>{children}</p>;
}

/** The design's yellow bar across the page, for what needs doing first. */
export function NoticeBar({
  tone = "warn",
  action,
  children,
}: {
  tone?: "warn" | "error";
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`mb-4 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[10px] px-4 py-3 font-semibold ${
        tone === "error" ? "bg-tt-bad-bg text-tt-bad-ink" : "bg-tt-signal text-tt-on-signal"
      }`}
    >
      <Icon name="alert" size={20} />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** The button style inside a notice bar: a white chip on the yellow. */
export const noticeButton =
  "inline-flex items-center justify-center rounded-lg bg-tt-card px-3.5 py-[9px] text-[13.5px] font-semibold whitespace-nowrap text-tt-ink hover:opacity-90";
