import gsap from "gsap";
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { CopyValue, useCopy } from "../CopyValue.tsx";

/*
 * The machine page's and Add machine's pieces from the Timetable design: the notice bar, the stat
 * strip with its bars, folded sections, key and value lines, the dark command block and fields.
 */

export const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** A wide notice under the head: yellow for something to look at, red when it's failing. */
export function NoticeBar({
  tone = "warn",
  children,
  action,
}: {
  tone?: "warn" | "error";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={`mb-4 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[10px] px-4 py-3 text-[14px] font-semibold ${
        tone === "error" ? "bg-tt-bad text-white" : "bg-tt-signal text-tt-on-signal"
      }`}
    >
      <WarnIcon />
      <div className="min-w-0 flex-1 basis-[240px]">{children}</div>
      {action}
    </div>
  );
}

/** A button on the notice bar: card-colored, so it reads on yellow and on red. */
export const noticeButton =
  "inline-flex items-center rounded-lg bg-tt-card px-3.5 py-[9px] text-[13.5px] font-semibold whitespace-nowrap text-tt-ink hover:opacity-90 disabled:opacity-60";

export function WarnIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

/** The strip of six readings under the head: three across on a phone. */
export function Stats({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The bars grow in once, as in the design.
  useLayoutEffect(() => {
    const bars = ref.current?.querySelectorAll("[data-bar]");
    if (!bars?.length || reducedMotion()) return;
    const tween = gsap.from(bars, {
      scaleX: 0,
      duration: 0.9,
      ease: "power3.out",
      stagger: 0.08,
      delay: 0.15,
    });
    return () => {
      tween.revert();
    };
  }, []);
  return (
    <div
      ref={ref}
      className="mb-[18px] grid grid-cols-3 rounded-xl border border-tt-rule bg-tt-card lg:grid-cols-6 [&>*+*]:border-l [&>*+*]:border-tt-rule max-lg:[&>*:nth-child(4)]:border-l-0 max-lg:[&>*:nth-child(n+4)]:border-t"
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  bar,
  warn,
  stale,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** 0 to 1; no bar when undefined. */
  bar?: number | null;
  warn?: boolean;
  stale?: boolean;
}) {
  return (
    <div className={`min-w-0 p-3 lg:px-4 lg:py-3.5 ${stale ? "opacity-60" : ""}`}>
      <small className="block text-[10.5px] leading-none font-bold tracking-[.1em] text-tt-ink-3 uppercase">
        {label}
      </small>
      <b className="mt-2 block truncate text-[20px] leading-[1.1] font-extrabold tabular-nums [font-stretch:80%] lg:text-[24px]">
        {value}
      </b>
      {bar != null && (
        <div className="mt-2 h-1 overflow-hidden rounded-sm bg-tt-rule">
          <i
            data-bar
            className={`block h-full origin-left ${warn ? "bg-[#e3a800]" : "bg-tt-ink"}`}
            style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }}
          />
        </div>
      )}
      {sub != null && (
        <em className="mt-1 block truncate text-[12px] text-tt-ink-3 not-italic">{sub}</em>
      )}
    </div>
  );
}

/** A folded section in a panel: a bold summary, a quiet note at its right, + and –. */
export function Det({
  summary,
  note,
  open,
  onToggle,
  id,
  className = "",
  children,
}: {
  summary: ReactNode;
  note?: ReactNode;
  /** Controlled when given. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      open={open}
      onToggle={(e) => onToggle?.((e.currentTarget as HTMLDetailsElement).open)}
      className={`group/det scroll-mt-4 border-t border-tt-rule ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-[13px] font-bold [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{summary}</span>
        {note != null && (
          <span className="ml-auto truncate text-[12.5px] font-medium text-tt-ink-3">{note}</span>
        )}
        <span
          aria-hidden
          className={`${note == null ? "ml-auto" : ""} w-3 flex-none text-center font-board text-[18px] leading-none font-semibold text-tt-ink-3`}
        >
          <span className="group-open/det:hidden">+</span>
          <span className="hidden group-open/det:inline">–</span>
        </span>
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}

/** A small uppercase heading over a group of lines. */
export function Kvh({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1 text-[10.5px] font-bold tracking-[.1em] text-tt-ink-3 uppercase">
      {children}
    </div>
  );
}

export type DotTone = "ok" | "warn" | "bad" | "unknown";

const dotColor: Record<DotTone, string> = {
  ok: "bg-tt-ok",
  warn: "bg-[#e3a800]",
  bad: "bg-tt-bad",
  unknown: "bg-tt-rule-2",
};

export function Dot({ tone, className = "" }: { tone: DotTone; className?: string }) {
  return (
    <i aria-hidden className={`size-2 flex-none rounded-full ${dotColor[tone]} ${className}`} />
  );
}

/** A label and its value on one line, with an optional status dot and what to do below. */
export function Kv({
  dot,
  label,
  value,
  children,
  dim,
}: {
  dot?: DotTone;
  label: ReactNode;
  value?: ReactNode;
  /** Below the line, indented: why, and the fix. */
  children?: ReactNode;
  dim?: boolean;
}) {
  return (
    <div className={dim ? "opacity-60" : undefined}>
      <div className="flex items-baseline gap-3 px-4 py-2 text-[13px]">
        {dot && <Dot tone={dot} className="self-center" />}
        <span className="min-w-0 flex-1 break-words text-tt-ink-2">{label}</span>
        {value != null && (
          <b className="min-w-0 text-right font-semibold break-words text-tt-ink">{value}</b>
        )}
      </div>
      {children && (
        <div
          className={`flex flex-col gap-1.5 pr-4 pb-2 text-[12px] text-tt-ink-3 ${dot ? "pl-9" : "pl-4"}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden
      // The glyph's back sheet reaches further left than its front one reaches right: 2px of
      // margin puts it in the button's optical center.
      className="ml-[2px]"
      width="15"
      height="15"
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
  );
}

/** A command on the board's black, with a copy button at its corner. */
export function CodeBlock({
  text,
  label = "Command",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const copy = useCopy(text, label);
  return (
    <div
      className={`relative rounded-[10px] border border-tt-board-edge bg-tt-board py-3.5 pr-[52px] pl-4 font-board text-[12.5px] leading-[1.6] break-all whitespace-pre-wrap text-tt-flap ${className}`}
    >
      <span className="select-all">{text}</span>
      <button
        type="button"
        className="absolute top-2 right-2 grid size-[34px] cursor-copy place-items-center rounded-lg bg-[#26292f] text-[#c7cbd2] hover:text-white"
        title="Copy"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={copy}
      >
        <CopyIcon />
      </button>
    </div>
  );
}

/** A small command inline in a line, on the paper color. */
export function InlineCode({ text, label = "Command" }: { text: string; label?: string }) {
  return (
    <CopyValue
      value={text}
      label={label}
      className="w-fit max-w-full rounded bg-tt-paper px-1.5 py-0.5 font-board text-[11.5px] break-all text-tt-ink-2"
    />
  );
}

export const fieldInput =
  "w-full rounded-lg border-[1.5px] border-tt-rule-2 bg-tt-card px-3 py-2.5 text-[14px] font-medium text-tt-ink outline-none focus:border-tt-ink";

/** A labeled field, as in the design's forms. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 content-start gap-1.5">
      <span className="text-[12px] font-bold text-tt-ink-2">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-tt-ink-3">{hint}</span>}
    </label>
  );
}

export function Input({ className = "", ...input }: ComponentProps<"input">) {
  return <input className={`${fieldInput} ${className}`} {...input} />;
}

export function Select({ className = "", ...select }: ComponentProps<"select">) {
  return <select className={`${fieldInput} ${className}`} {...select} />;
}

/** The design's toggle: a checkbox with a line beside it. */
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-start gap-2 text-[13px] font-semibold text-tt-ink-2">
      <input
        type="checkbox"
        className="mt-[3px] accent-tt-ink"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

/** A spinning-free wait: a pulsing yellow dot. */
export function Pulse() {
  return (
    <span aria-hidden className="size-2.5 flex-none animate-pulse rounded-full bg-[#e3a800]" />
  );
}

/** Errors in the Timetable colors. */
export function TtError({ error, className = "" }: { error: unknown; className?: string }) {
  if (!error) return null;
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Something failed.";
  return (
    <p role="alert" className={`text-[12.5px] font-medium break-words text-tt-bad ${className}`}>
      {text}
    </p>
  );
}
