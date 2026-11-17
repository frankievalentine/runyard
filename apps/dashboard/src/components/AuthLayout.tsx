import { useId, type ReactNode } from "react";
import { SplitFlap } from "./board/SplitFlap.tsx";
import { Logomark } from "./Logomark.tsx";

export type BoardLine = { text: string; tone?: "flap" | "signal" | "moving" | "go" | "dim" };

/**
 * Timetable's sign-in and claim screens: a departure board beside the form on desktop, one flap
 * line above it on phones. The board says where you are and what this screen is for; it never shows
 * yard data, which needs a session.
 */
export function AuthLayout({ board, children }: { board: BoardLine[]; children: ReactNode }) {
  const host = window.location.host;
  return (
    <div className="flex min-h-full bg-tt-paper font-ui text-tt-ink">
      <aside
        aria-hidden
        className="hidden w-[46%] max-w-[640px] flex-col justify-between bg-tt-board px-10 py-9 text-tt-flap lg:flex"
        style={
          { "--flap-w": "15px", "--flap-h": "30px", "--flap-fs": "16px" } as React.CSSProperties
        }
      >
        <div className="flex items-center gap-3">
          <Logomark size={40} />
          <span>
            <span className="block text-[18px] font-extrabold [font-stretch:85%]">Runyard</span>
            <span className="block text-[12.5px] text-[#9aa0a9]">{host}</span>
          </span>
        </div>
        <div>
          <p className="mb-4 text-[34px] leading-none font-extrabold tracking-[.01em] [font-stretch:75%]">
            Departures
          </p>
          <div className="flex flex-col gap-1.5">
            {board.map((line, i) => (
              <SplitFlap key={i} text={line.text} cells={26} tone={line.tone ?? "flap"} />
            ))}
          </div>
        </div>
        <p className="text-[12px] text-[#9aa0a9]">
          CI runners for GitHub and Forgejo, on your machines and boat.dev.
        </p>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col items-center px-5 py-8 lg:justify-center">
        <div
          className="mb-8 flex w-full max-w-[400px] flex-col gap-4 lg:hidden"
          style={
            { "--flap-w": "11px", "--flap-h": "22px", "--flap-fs": "12px" } as React.CSSProperties
          }
        >
          <div className="flex items-center gap-3">
            <Logomark size={36} />
            <span>
              <span className="block text-[17px] font-extrabold [font-stretch:85%]">Runyard</span>
              <span className="block text-[12px] text-tt-ink-3">{host}</span>
            </span>
          </div>
          {board[0] && (
            <div aria-hidden className="overflow-hidden rounded-lg bg-tt-board px-3 py-2.5">
              <SplitFlap text={board[0].text} cells={24} tone={board[0].tone ?? "flap"} />
            </div>
          )}
        </div>
        <div className="w-full max-w-[400px]">{children}</div>
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
