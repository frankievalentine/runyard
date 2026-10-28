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

export function StatStrip({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  return (
    <Card
      className={`grid gap-px overflow-hidden bg-line [&>*]:bg-card ${cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 lg:grid-cols-4"}`}
    >
      {children}
    </Card>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  hollow,
  stale,
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  hollow?: boolean;
  stale?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <span className="truncate text-[12px] font-medium text-ink-2">{label}</span>
      <div className={`flex min-w-0 items-center gap-2 ${stale ? "opacity-45" : ""}`}>
        {tone && <StatusDot tone={tone} hollow={hollow} />}
        <span className="truncate text-[20px] font-semibold tracking-tight tabular">{value}</span>
      </div>
      {children}
      {sub && <div className="truncate text-[12px] text-ink-2">{sub}</div>}
    </div>
  );
}

/** Usage bar: amber from 70% used, red from 85%. Callers show no bar for missing data. */
export function Meter({ fraction, stale }: { fraction: number; stale?: boolean }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  const color = pct >= 85 ? "var(--bad)" : pct >= 70 ? "var(--warn)" : "var(--meter)";
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-sunken"
      style={{ opacity: stale ? 0.45 : 1 }}
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-[12.5px] text-ink-2">{children}</p>;
}

/** A notice on a page: something that went wrong or needs a look. */
export function Callout({
  tone,
  title,
  children,
}: {
  tone: "bad" | "warn";
  title?: ReactNode;
  children?: ReactNode;
}) {
  const surface = tone === "bad" ? "border-bad/30 bg-bad/5" : "border-warn/30 bg-warn/5";
  return (
    <Card className={`mt-4 px-4 py-3 text-[12.5px] ${surface}`}>
      {title && (
        <div className={`font-medium ${tone === "bad" ? "text-bad" : "text-warn"}`}>{title}</div>
      )}
      {children && <div className="mt-0.5 text-ink-2 select-text">{children}</div>}
    </Card>
  );
}
