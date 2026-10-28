import type { ReactNode } from "react";
import type { Tone } from "../lib/status.ts";

export const toneVar: Record<Tone, string> = {
  busy: "var(--busy)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  muted: "var(--muted)",
  info: "var(--info)",
};

export function StatusDot({
  tone,
  hollow,
  size = 8,
}: {
  tone: Tone;
  hollow?: boolean;
  size?: number;
}) {
  const color = toneVar[tone];
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: hollow ? "transparent" : color,
        boxShadow: hollow ? `inset 0 0 0 1.5px ${color}` : undefined,
      }}
    />
  );
}

export function Pill({
  tone,
  children,
  hollow,
}: {
  tone: Tone;
  children: ReactNode;
  hollow?: boolean;
}) {
  const color = toneVar[tone];
  return (
    <span
      className="inline-flex h-[20px] shrink-0 items-center gap-1.5 rounded-[6px] border px-1.5 text-[12px] font-medium whitespace-nowrap"
      style={{
        color: tone === "ok" ? "var(--ok-ink)" : color,
        borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      <StatusDot tone={tone} hollow={hollow} size={6} />
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel min-w-0 ${className}`}>{children}</div>;
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 min-w-0">
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {action && <div className="ml-auto min-w-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function ErrorText({ error, className = "" }: { error: unknown; className?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className={`text-[12px] break-words text-bad select-text ${className}`}>
      {message}
    </p>
  );
}
