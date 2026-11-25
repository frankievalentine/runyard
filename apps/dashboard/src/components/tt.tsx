import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

/*
 * Timetable's page pieces, from the design artifact: the page head, panels with their small
 * uppercase header, rows, chips, buttons and the plain table. Pages ported from the design build on
 * these so every page reads as one product.
 */

/**
 * Desktop: a page's head (title, line under it, back link) stays at the top while the page scrolls
 * under it. It reaches up over the page's top padding (--page-pt, set by the layout) so its
 * background covers that band and the title stays level with the sidebar. Phones scroll it away,
 * since there it would take too much of the screen.
 */
export const stickyHead =
  "lg:sticky lg:top-0 lg:z-20 lg:-mt-[var(--page-pt)] lg:bg-tt-paper lg:pt-[var(--page-pt)]";

/** A page's head: an optional back link, the condensed title, a line under it, and its actions. */
export function PageHead({
  title,
  lede,
  back,
  sign,
  status,
  actions,
}: {
  title: ReactNode;
  lede?: ReactNode;
  /** Where the back link goes, and its label: `{ to: "/machines", label: "Machines" }`. */
  back?: { to: string; label: string };
  /** A platform sign or icon before the title. */
  sign?: ReactNode;
  /** A chip beside the title. */
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={`mb-[18px] ${stickyHead} lg:mb-0 lg:pb-[18px]`}>
      {back && (
        <Link
          to={back.to}
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-tt-ink-2 hover:text-tt-ink"
        >
          <span aria-hidden>‹</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {sign}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[34px] leading-none font-extrabold tracking-[-.005em] break-words [font-stretch:78%]">
                {title}
              </h1>
              {status}
            </div>
            {lede && <p className="mt-1.5 text-[14px] text-tt-ink-2">{lede}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A white panel with the design's small uppercase header; `dark` is a board panel. */
export function Panel({
  title,
  meta,
  action,
  dark,
  id,
  className = "",
  children,
}: {
  title?: ReactNode;
  /** Quiet text at the header's right, like "7 need attention". */
  meta?: ReactNode;
  action?: ReactNode;
  dark?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`min-w-0 rounded-xl border ${
        dark
          ? "border-tt-board-edge bg-tt-board text-tt-flap"
          : "border-tt-rule bg-tt-card text-tt-ink"
      } ${className}`}
    >
      {(title || meta || action) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
          {title && (
            <h2
              className={`text-[13px] font-extrabold tracking-[.06em] uppercase ${dark ? "text-tt-signal" : ""}`}
            >
              {title}
            </h2>
          )}
          <span className="ml-auto flex items-center gap-3">
            {meta && (
              <span className={`text-[12.5px] ${dark ? "text-[#8b9099]" : "text-tt-ink-3"}`}>
                {meta}
              </span>
            )}
            {action}
          </span>
        </header>
      )}
      {children}
    </section>
  );
}

/** A row in a panel: a line above it, content, and room at the end for status or an action. */
export function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 border-t border-tt-rule px-4 py-[11px] ${className}`}>
      {children}
    </div>
  );
}

export type ChipTone = "neutral" | "ok" | "warn" | "error" | "busy" | "plain";

/** The design's status chip: a dot and a word or two. */
export function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  const colors: Record<ChipTone, [string, string]> = {
    neutral: ["bg-tt-hover text-tt-ink-2", "bg-tt-off"],
    ok: ["bg-tt-hover text-tt-ink-2", "bg-tt-ok"],
    warn: ["bg-tt-warn-bg text-tt-warn-ink", "bg-[#e3a800]"],
    error: ["bg-tt-bad-bg text-tt-bad-ink", "bg-tt-bad"],
    busy: ["bg-tt-busy-bg text-tt-busy-ink", "bg-tt-loco"],
    plain: ["bg-tt-hover text-tt-ink-2", ""],
  };
  const [box, dot] = colors[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[5px] px-2 py-[5px] text-[11.5px] leading-none font-semibold whitespace-nowrap ${box}`}
    >
      {dot && <i className={`size-[7px] rounded-full ${dot}`} aria-hidden />}
      {children}
    </span>
  );
}

/** A machine's platform sign: its number on the Board, dark, dimmed when offline, red on error. */
export function Sign({
  n,
  tone = "normal",
  large,
}: {
  n: number;
  tone?: "normal" | "dim" | "error";
  large?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`grid flex-none place-items-center font-extrabold leading-none [font-stretch:85%] ${
        large ? "size-[52px] rounded-lg text-[28px]" : "size-[30px] rounded-[5px] text-[16px]"
      } ${
        tone === "error"
          ? "bg-tt-bad text-white"
          : tone === "dim"
            ? "bg-[#6f7680] text-white"
            : "bg-tt-inv text-tt-on-inv"
      }`}
    >
      {n}
    </span>
  );
}

const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border px-3.5 py-[9px] text-[13.5px] font-semibold whitespace-nowrap disabled:cursor-default disabled:opacity-45";

/** The design's buttons: `primary` (ink), `secondary` (outlined), `signal` (yellow), `danger`. */
export const ttButton = {
  primary: `${button} border-tt-inv bg-tt-inv text-tt-on-inv hover:opacity-90`,
  secondary: `${button} border-tt-rule-2 bg-tt-card text-tt-ink hover:border-tt-ink-3`,
  signal: `${button} border-tt-signal bg-tt-signal text-tt-on-signal hover:opacity-90`,
  danger: `${button} border-tt-rule-2 bg-tt-card text-tt-bad hover:border-tt-bad`,
} as const;

/** Smaller buttons, for actions inside rows. */
export const ttRowButton = {
  secondary: `${ttButton.secondary} !px-3 !py-[6px] !text-[12.5px]`,
  primary: `${ttButton.primary} !px-3 !py-[6px] !text-[12.5px]`,
  danger: `${ttButton.danger} !px-3 !py-[6px] !text-[12.5px]`,
} as const;

/** A button in one of the design's styles. */
export function TtButton({
  variant = "secondary",
  className = "",
  ...button
}: { variant?: keyof typeof ttButton } & ComponentProps<"button">) {
  return <button type="button" className={`${ttButton[variant]} ${className}`} {...button} />;
}

/** The design's plain table: uppercase headers over a heavy rule, hairlines between rows. */
export const ttTable = {
  table: "w-full border-collapse text-[13.5px]",
  th: "border-b-2 border-tt-ink px-3.5 py-3 text-left text-[10.5px] leading-none font-bold tracking-[.1em] whitespace-nowrap text-tt-ink-3 uppercase",
  td: "border-b border-tt-rule px-3.5 py-3 align-middle",
} as const;

/** Label and value pairs down a panel, like the design's facts. */
export function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 px-4 pb-3 text-[13px]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="border-t border-tt-rule py-2 text-tt-ink-3">{k}</dt>
          <dd className="m-0 min-w-0 border-t border-tt-rule py-2 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
