import { useQuery } from "@tanstack/react-query";
import { useId, type ReactNode } from "react";
import { healthQuery } from "../lib/queries.ts";
import { SplitFlap } from "./board/SplitFlap.tsx";
import { Logomark } from "./Logomark.tsx";

type Tone = "flap" | "signal" | "moving" | "go" | "dim";
/** One row of the sign-in board: a time, a job column and a status, as on the Board. */
export type BoardRow = { time?: string; job: string; status: string; tone?: Tone };

const ROWS = 4;
const COLS = { time: 5, job: 12, status: 16 } as const;

/** The time now, `HH:MM`, for a board row. */
export function boardTime(at = Date.now()): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Timetable's sign-in and claim screens, as in the design: on desktop a departure board beside the
 * form (Runyard, "Departures · this address", and four rows that flip when the screen's state
 * changes); on phones the board's first status as one flap line above the form. The rows say
 * what the screen is for, never yard data: that needs a session.
 */
export function AuthLayout({
  board,
  line,
  children,
}: {
  board: BoardRow[];
  /** The phone's one flap line, when it isn't the board's first status. */
  line?: { text: string; tone?: Tone };
  children: ReactNode;
}) {
  const host = window.location.host;
  const version = useQuery(healthQuery).data?.version;
  const rows = Array.from({ length: ROWS }, (_, i) => board[i] ?? { job: "", status: "" });
  const width = (n: number) => `calc(${n} * (var(--flap-w) + var(--flap-g, 1px)) - 1px)`;
  return (
    <div className="flex min-h-full bg-tt-paper font-ui text-tt-ink">
      <aside
        aria-hidden
        className="hidden w-[600px] flex-none flex-col gap-6 border-r border-tt-board-edge bg-tt-board px-10 pt-10 pb-8 text-tt-flap lg:flex"
        style={
          { "--flap-w": "14px", "--flap-h": "30px", "--flap-fs": "16px" } as React.CSSProperties
        }
      >
        <div className="flex items-center gap-3.5">
          <Logomark size={48} />
          <span>
            <b className="block text-[24px] leading-none font-extrabold tracking-[.01em] text-white [font-stretch:80%]">
              Runyard
            </b>
            <small className="mt-1 block text-[13px] text-[#a9aeb6]">{host}</small>
          </span>
        </div>
        <h2 className="mt-auto text-[44px] leading-none font-extrabold tracking-[.01em] [font-stretch:72%]">
          Departures <span className="text-tt-signal">·</span> {window.location.hostname}
        </h2>
        <div className="flex flex-col gap-2 border-t border-[#23262c] pt-4">
          <div className="flex gap-3 text-[10.5px] font-semibold tracking-[.1em] text-[#8b9099] uppercase">
            <span className="flex-none" style={{ width: width(COLS.time) }}>
              Time
            </span>
            <span className="flex-none" style={{ width: width(COLS.job) }}>
              Job
            </span>
            <span>Status</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="flex gap-3 border-b border-[#1a1c20] pb-2">
              <SplitFlap text={r.time ?? ""} cells={COLS.time} delay={i * 0.12} />
              <SplitFlap text={r.job} cells={COLS.job} delay={i * 0.12 + 0.05} />
              <SplitFlap
                text={r.status}
                cells={COLS.status}
                tone={r.tone ?? "flap"}
                delay={i * 0.12 + 0.1}
              />
            </div>
          ))}
        </div>
        <div className="mt-auto flex justify-between gap-3 text-[12.5px] text-[#a9aeb6]">
          <span>{host}</span>
          {version && <span>Runyard {version}</span>}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div
          className="flex flex-col gap-3 bg-tt-board px-[18px] pt-[max(12px,env(safe-area-inset-top,0px))] pb-4 text-tt-flap lg:hidden"
          style={
            { "--flap-w": "13px", "--flap-h": "24px", "--flap-fs": "14px" } as React.CSSProperties
          }
          aria-hidden
        >
          <div className="flex items-center gap-3">
            <Logomark size={36} />
            <span>
              <b className="block text-[20px] leading-none font-extrabold text-white [font-stretch:80%]">
                Runyard
              </b>
              <small className="mt-1 block text-[12px] text-[#a9aeb6]">{host}</small>
            </span>
          </div>
          <div className="overflow-hidden">
            <SplitFlap
              text={line?.text ?? rows.find((r) => r.status)?.status ?? ""}
              cells={22}
              tone={line?.tone ?? rows.find((r) => r.status)?.tone ?? "flap"}
            />
          </div>
        </div>
        {/* Phones: the form starts under the header and its last actions sit at the bottom. */}
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col px-[18px] pt-6 pb-[max(20px,env(safe-area-inset-bottom,0px))] lg:my-auto lg:flex-none lg:px-0 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

const field =
  "h-11 w-full rounded-lg border border-tt-rule-2 bg-tt-card px-3 text-[15px] text-tt-ink outline-none focus:border-tt-ink";

/** A labelled text input in the sign-in screens' style, its label and hint tied to it by id. */
export function AuthField({
  label,
  hint,
  ...input
}: {
  label: string;
  hint?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-tt-ink-2">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={field}
        {...input}
      />
      {hint && (
        <span id={`${id}-hint`} className="text-[12.5px] text-tt-ink-3">
          {hint}
        </span>
      )}
    </div>
  );
}

/** A screen's last actions: at the bottom of a phone's screen, under the form on desktop. */
export const authActions = "mt-auto flex flex-col gap-2.5 pt-6 lg:mt-2 lg:pt-0";

/** A form that fills the screen on phones, so its actions can sit at the bottom. */
export const authForm = "flex flex-1 flex-col gap-4";

/** The screens' line icons: a key for passkeys, the tailnet's nodes for Tailscale, a lock. */
export function AuthIcon({ name }: { name: "key" | "tailnet" | "lock" | "warn" }) {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      {name === "key" && (
        <>
          <circle cx="8" cy="15" r="4" />
          <path d="m11 12 9-9M17 6l3 3M15 8l2 2" />
        </>
      )}
      {name === "tailnet" && (
        <>
          <circle cx="5" cy="6" r="2" />
          <circle cx="19" cy="6" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M6.5 7.5 11 16.5M17.5 7.5 13 16.5M7 6h10" />
        </>
      )}
      {name === "lock" && (
        <>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </>
      )}
      {name === "warn" && (
        <>
          <path d="M12 3 2 20h20z" />
          <path d="M12 10v4M12 17h.01" />
        </>
      )}
    </svg>
  );
}

/** A quiet note with an icon, like the design's tailnet and passkey notes. */
export function AuthNote({
  icon,
  tone,
  children,
}: {
  icon: "tailnet" | "lock" | "warn";
  tone?: "warn";
  children: ReactNode;
}) {
  return (
    <p
      className={`flex gap-2.5 rounded-lg px-3.5 py-3 text-[13px] ${
        tone === "warn" ? "bg-tt-warn-bg text-tt-warn-ink" : "text-tt-ink-2"
      }`}
    >
      <span className="mt-0.5">
        <AuthIcon name={icon} />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The screens' heading, lede and eyebrow, as in the design. */
export const authTitle =
  "text-[38px] leading-none font-extrabold tracking-[-.005em] [font-stretch:76%]";
export const authLede = "mt-2.5 text-[15px] text-tt-ink-2";
export const authEyebrow = "mb-2 text-[11px] font-bold tracking-[.12em] text-tt-ink-3 uppercase";

export const authPrimary =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-tt-inv px-4 text-[15px] font-semibold text-tt-on-inv hover:opacity-90 disabled:opacity-50";
export const authSecondary =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-tt-rule-2 bg-tt-card px-4 text-[15px] font-semibold text-tt-ink hover:bg-tt-hover disabled:opacity-50";

/** An error or warning line under a form, in the screens' notice colors. */
export function AuthNotice({
  tone = "bad",
  children,
}: {
  tone?: "bad" | "warn" | "info";
  children: ReactNode;
}) {
  const colors =
    tone === "bad"
      ? "bg-tt-bad-bg text-tt-bad-ink"
      : tone === "warn"
        ? "bg-tt-warn-bg text-tt-warn-ink"
        : "bg-tt-hover text-tt-ink-2";
  return (
    <p
      role={tone === "bad" ? "alert" : undefined}
      className={`rounded-lg px-3 py-2.5 text-[13px] ${colors}`}
    >
      {children}
    </p>
  );
}
