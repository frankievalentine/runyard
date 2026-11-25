import type { ComponentProps, ReactNode } from "react";

/*
 * Pieces Settings shares, from the Timetable design: its row icons, a row's title and line, the
 * small headers inside a panel, and dialogs in the design's style (bottom sheets on phones).
 */

const PATHS = {
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1" />
    </>
  ),
  cloud: <path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3M15 8l2 2" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  // A unit lower, so it lines up with a bold label's lowercase.
  plus: <path d="M12 6v14M5 13h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  update: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
} as const;

/** The design's 18px line icons. */
export function SIcon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "check" ? 2.6 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      {PATHS[name]}
    </svg>
  );
}

/** A row's bold title and the quiet line under it. */
export function RowText({
  title,
  detail,
  mono,
  className = "",
}: {
  title: ReactNode;
  detail?: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <span className={`min-w-0 flex-1 ${className}`}>
      <b className={`block truncate font-bold ${mono ? "font-mono text-[13px]" : ""}`}>{title}</b>
      {detail && <small className="block text-[12px] text-tt-ink-3">{detail}</small>}
    </span>
  );
}

/** A small uppercase header inside a panel, like the design's Passkeys and Theme. */
export function Kvh({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-4 pt-3 pb-1 text-[10.5px] leading-none font-bold tracking-[.1em] text-tt-ink-3 uppercase">
      {children}
    </h3>
  );
}

/** Quiet text in a panel, like the design's `.empty`. */
export function Note({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`px-4 pb-3.5 text-[12.5px] text-tt-ink-2 ${className}`}>{children}</p>;
}

/** Text with `backticks` shown as code, for setup checks' fixes. */
export function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((part, i) =>
        i % 2 ? (
          <code
            key={i}
            className="rounded-[4px] bg-tt-paper px-[5px] py-0.5 font-mono text-[11.5px] break-words text-tt-ink"
          >
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export { ttRowButton as rowButton } from "../tt.tsx";

/** A labeled field in the design's style; extra props go to the <input>. */
export function TtField({
  label,
  hint,
  ...input
}: { label: string; hint?: ReactNode } & ComponentProps<"input">) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-tt-ink-2">{label}</span>
      <input
        className="h-10 w-full rounded-lg border border-tt-rule-2 bg-tt-card px-3 text-[14px] text-tt-ink outline-none focus:border-tt-ink"
        {...input}
      />
      {hint && <span className="text-[12px] text-tt-ink-3">{hint}</span>}
    </label>
  );
}

/** A select in the design's style. */
export const ttSelect =
  "input !h-10 !rounded-lg !border-tt-rule-2 !bg-tt-card !text-[14px] focus:!border-tt-ink focus:!shadow-none";

/** A notice in the design's warning or error colors. */
export function Notice({
  tone,
  title,
  children,
}: {
  tone: "warn" | "bad";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "bad" ? "alert" : undefined}
      className={`mb-[18px] rounded-xl px-4 py-3 text-[13px] ${tone === "bad" ? "bg-tt-bad-bg text-tt-bad-ink" : "bg-tt-warn-bg text-tt-warn-ink"}`}
    >
      <b className="block font-bold">{title}</b>
      {children}
    </div>
  );
}

export { DialogButtons, ConfirmDialog as TtConfirm, TtDialog } from "../ConfirmDialog.tsx";
