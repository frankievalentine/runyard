import type { ReactNode } from "react";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import type { Tone } from "../lib/status.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Icon } from "./icons.tsx";

/** Primitives ported from aarondfrancis/fleet's dashboard (src/components/ui.tsx, Table.tsx, details/shared.tsx). */

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
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 min-w-0">
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {count !== undefined && (
          <span className="font-mono text-[12px] text-ink-2 tabular">{count}</span>
        )}
        {action && <div className="ml-auto min-w-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  status,
  actions,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start gap-3">
      {icon && (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-ink-2 shadow-xs">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-semibold tracking-tight break-words">{title}</h1>
          {status}
        </div>
        {subtitle && <div className="mt-1 text-[13px] break-words text-ink-2">{subtitle}</div>}
      </div>
      {actions && (
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
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
  aside,
  value,
  sub,
  tone,
  hollow,
  stale,
  children,
}: {
  label: string;
  /** Shown opposite the label, such as how old stale data is. */
  aside?: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  hollow?: boolean;
  stale?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-ink-2">{label}</span>
        {aside}
      </div>
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
  return <div className="px-3.5 py-3 text-[12.5px] text-ink-3">{children}</div>;
}

export function ErrorText({ error, className = "" }: { error: unknown; className?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className={`text-[12px] break-words text-bad select-text ${className}`}>
      {message}
    </p>
  );
}

export const calloutSurface = {
  bad: "border-bad/30 bg-bad/5",
  warn: "border-warn/30 bg-warn/5",
} as const;

/** A notice on a page: something that went wrong or needs a look. */
export function Callout({
  tone,
  title,
  children,
  className = "mt-4",
}: {
  tone: "bad" | "warn";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={`flex items-start gap-2.5 px-4 py-3 text-[12.5px] ${calloutSurface[tone]} ${className}`}
    >
      <span className={`mt-px shrink-0 ${tone === "bad" ? "text-bad" : "text-warn"}`}>
        <Icon name="alert" />
      </span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && (
          <div className={`break-words text-ink-2 ${title ? "mt-0.5" : ""}`}>{children}</div>
        )}
      </div>
    </Card>
  );
}

/** A relative age that ticks by itself, so its parent doesn't re-render every second. */
export function TimeAgo({ at }: { at: number | null }) {
  const now = useNow();
  return <>{timeAgo(at, now)}</>;
}

export type KeyValueRow = [label: string, value: ReactNode, copyValue?: string];

export function KeyValuePanel({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: KeyValueRow[];
  footer?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-sunken/40 px-4 py-2 text-[12px] font-medium text-ink-2">
        {title}
      </div>
      <dl className="divide-y divide-line">
        {rows.map(([label, value, copyValue]) => (
          <div
            key={label}
            className="grid grid-cols-[minmax(70px,35%)_1fr] items-baseline gap-3 px-4 py-2 text-[13px]"
          >
            <dt className="text-ink-2">{label}</dt>
            <dd
              className="min-w-0 truncate text-ink"
              title={copyValue ?? (typeof value === "string" ? value : undefined)}
            >
              {copyValue ? (
                <CopyValue value={copyValue} label={label} truncate>
                  {value}
                </CopyValue>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {footer && (
        <div className="border-t border-line px-4 py-2 text-[12px] text-ink-2">{footer}</div>
      )}
    </Card>
  );
}

export type Column = { label: string; className?: string };

/** A table whose rows each open a page, with a column for the hover chevron. */
export function LinkTable({
  columns,
  minWidth,
  children,
}: {
  columns: Column[];
  minWidth: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-x-auto">
      <table className={`w-full text-[13px] ${minWidth}`}>
        <thead className="border-b border-line bg-sunken/40 text-left text-[12px] text-ink-2">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.label}
                scope="col"
                className={`py-2 font-medium ${c.className ?? (i === 0 ? "px-4" : "px-3")}`}
              >
                {c.label}
              </th>
            ))}
            <th scope="col" className="w-8">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </Card>
  );
}

/** A row that opens its page from anywhere on it; `opener` is its keyboard-reachable button. */
export function LinkRow({
  onOpen,
  opener,
  title,
  children,
}: {
  onOpen: () => void;
  opener: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  return (
    <tr className="group cursor-pointer hover:bg-hover" onClick={onOpen}>
      <td className="px-4 py-2.5">
        <button
          className="flex max-w-[240px] items-center gap-2.5 text-left"
          title={title}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {opener}
        </button>
      </td>
      {children}
      <td className="px-2 text-ink-3">
        <span className="opacity-0 group-hover:opacity-100">
          <Icon name="chevron" />
        </span>
      </td>
    </tr>
  );
}

export function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`h-3 w-1.5 rounded-[2px] ${color}`} />
      {children}
    </span>
  );
}

/** A page's heading inside a layout that already has the page title, such as Settings. */
export function SubHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A link back to the parent tab, such as Connections. */
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mt-6 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        {back && <div className="mb-3 text-[12.5px]">{back}</div>}
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {subtitle && <div className="mt-1 max-w-2xl text-[13px] text-ink-2">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
