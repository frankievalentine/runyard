import {
  deriveIssues,
  type Alert,
  type JobCounts,
  type YardView,
  type MachineView,
} from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { api, call } from "../api.ts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EVENTS_PAGE, eventsQuery, useYard } from "../lib/yard.ts";
import { formatBytes, formatClock, formatPercent, formatUptime, timeAgo } from "../lib/format.ts";
import { diskUsedFraction, memoryUsedFraction, primaryDisk } from "../lib/health.ts";
import { useNow } from "../lib/now.ts";
import {
  diagnosticSummary,
  eventStyle,
  machineStatus,
  machineTooltip,
  osLine,
} from "../lib/status.ts";
import { Button } from "./form.tsx";
import { Icon } from "./icons.tsx";
import { RunnerCells } from "./runners.tsx";
import {
  calloutSurface,
  Card,
  EmptyLine,
  ErrorText,
  LinkRow,
  LinkTable,
  Meter,
  Pill,
  Section,
  StatusDot,
} from "./ui.tsx";

/** Active alerts, with the machine named when listed across machines. Ported from aarondfrancis/fleet's Monitoring. */
export function ActiveAlerts({
  alerts,
  showMachine = false,
}: {
  alerts: Alert[];
  showMachine?: boolean;
}) {
  const now = useNow();
  const navigate = useNavigate();
  return (
    <Card className={`divide-y divide-warn/15 overflow-hidden ${calloutSurface.warn}`}>
      {alerts.map((alert) => (
        <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
          <span className="mt-0.5 text-warn">
            <Icon name="alert" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
              {showMachine && (
                <button
                  className="text-left hover:underline"
                  onClick={() =>
                    void navigate({ to: "/machines/$id", params: { id: alert.machineId } })
                  }
                >
                  {alert.machineName}
                </button>
              )}
              <span>{alert.kind === "offline" ? "Offline" : "Low disk space"}</span>
              {alert.muted && <Pill tone="muted">Maintenance</Pill>}
              {alert.stale && (
                <Pill tone="muted" hollow>
                  Stale
                </Pill>
              )}
            </div>
            <p className="mt-1 text-[12px] break-words whitespace-pre-line text-ink-2">
              {alert.detail}
            </p>
            <p
              className="mt-1 text-[11px] text-ink-3"
              title={new Date(alert.since).toLocaleString()}
            >
              Since {timeAgo(alert.since, now)}
            </p>
          </div>
        </div>
      ))}
    </Card>
  );
}

/** aarondfrancis/fleet's Needs attention: everything worth a look besides active alerts. */
export function Attention({ view }: { view: YardView }) {
  const navigate = useNavigate();
  const issues = deriveIssues(view);
  if (issues.length === 0) return null;
  return (
    <Section title="Needs attention" count={issues.length}>
      <Card className={`divide-y divide-warn/15 overflow-hidden ${calloutSurface.warn}`}>
        {issues.map((issue) => {
          const content = (
            <>
              <span className="text-warn">
                <Icon name="alert" size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{issue.title}</div>
                <div
                  className="mt-0.5 line-clamp-2 text-[13px] break-words text-ink-2"
                  title={issue.detail}
                >
                  {issue.detail}
                </div>
              </div>
              {(issue.machineId || issue.page || issue.runnerKey) && (
                <span className="text-ink-3">
                  <Icon name="chevron" size={11} />
                </span>
              )}
            </>
          );
          const className = "flex min-h-[40px] w-full items-center gap-3 px-4 py-3 text-left";
          const { machineId, runnerKey } = issue;
          return machineId || issue.page || runnerKey ? (
            <button
              key={issue.id}
              type="button"
              onClick={() =>
                void (machineId
                  ? navigate({ to: "/machines/$id", params: { id: machineId }, hash: issue.hash })
                  : runnerKey
                    ? navigate({ to: "/runners/$key", params: { key: runnerKey } })
                    : navigate({ to: "/boat" }))
              }
              className={`${className} hover:bg-warn/5`}
            >
              {content}
            </button>
          ) : (
            <div key={issue.id} className={className}>
              {content}
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

const COLUMNS = [
  { label: "Machine" },
  { label: "Runners", className: "w-32 px-3" },
  { label: "Jobs, 7 days", className: "w-32 px-3" },
  { label: "Diagnostics" },
  { label: "CPU", className: "w-28 px-3" },
  { label: "Memory", className: "w-28 px-3" },
  { label: "Disk free", className: "w-28 px-3" },
  { label: "Uptime", className: "hidden px-3 min-[1300px]:table-cell" },
];

/** Ported from aarondfrancis/fleet's MachineTable, with its Runners column. */
export function MachineTable({ machines }: { machines: MachineView[] }) {
  const navigate = useNavigate();
  const now = useNow();
  const { runners } = useYard();
  const summary = useQuery({
    queryKey: ["jobs-summary"],
    queryFn: async () =>
      (await call(api.jobs.summary.$get())) as unknown as {
        machines: Record<string, JobCounts>;
      },
    refetchInterval: 60_000,
  });
  if (!machines.length) {
    return (
      <Card>
        <EmptyLine>No machines yet.</EmptyLine>
      </Card>
    );
  }
  return (
    <LinkTable columns={COLUMNS} minWidth="min-w-[640px]">
      {machines.map((m) => {
        const status = machineStatus(m);
        const h = m.health;
        const memory = memoryUsedFraction(h);
        const disk = primaryDisk(h);
        const warnings =
          m.diagnostics &&
          !m.diagnostics.stale &&
          m.diagnostics.checks.some((c) => c.status === "warn");
        return (
          <LinkRow
            key={m.id}
            onOpen={() => void navigate({ to: "/machines/$id", params: { id: m.id } })}
            title={machineTooltip(m)}
            opener={
              <>
                <StatusDot tone={status.tone} hollow={status.hollow} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-2">
                    {osLine(m) ?? m.sshTarget}
                  </span>
                  {h?.stale && (
                    <span className="block text-[11px] text-warn">
                      as of {timeAgo(h.asOf, now)}
                    </span>
                  )}
                </span>
              </>
            }
          >
            <td className="px-3 py-2.5">
              {(() => {
                const own = runners.filter((r) => r.machineId === m.id);
                return own.length ? (
                  <RunnerCells runners={own} />
                ) : (
                  <span className="text-[12px] text-ink-3">None</span>
                );
              })()}
            </td>
            <td className="px-3 py-2.5 text-[12px] whitespace-nowrap text-ink-2 tabular">
              {(() => {
                const c = summary.data?.machines[m.id];
                if (!c) return <span className="text-ink-3">—</span>;
                const done = c.passed + c.failed + c.cancelled;
                return (
                  <span>
                    {done}
                    {c.failed > 0 && <span className="text-bad"> · {c.failed} failed</span>}
                  </span>
                );
              })()}
            </td>
            <td className={`px-3 py-2.5 text-[12px] ${warnings ? "text-warn" : "text-ink-2"}`}>
              {m.connection.state === "error" ? (
                <span className="text-bad">SSH failed</span>
              ) : (
                diagnosticSummary(m)
              )}
            </td>
            <MetricCell
              value={h?.cpuPercent == null ? "—" : formatPercent(h.cpuPercent)}
              fraction={h?.cpuPercent == null ? null : h.cpuPercent / 100}
              stale={h?.stale}
            />
            <MetricCell
              value={memory == null ? "—" : formatPercent(memory * 100)}
              fraction={memory}
              stale={h?.stale}
            />
            <MetricCell
              value={disk ? formatBytes(disk.availableBytes) : "—"}
              fraction={diskUsedFraction(disk)}
              stale={h?.stale}
            />
            <td className="hidden px-3 py-2.5 font-mono text-[12px] text-ink-2 tabular min-[1300px]:table-cell">
              {h?.uptimeSecs == null ? "—" : formatUptime(h.uptimeSecs)}
            </td>
          </LinkRow>
        );
      })}
    </LinkTable>
  );
}

function MetricCell({
  value,
  fraction,
  stale,
  "data-label": label,
}: {
  value: string;
  fraction: number | null;
  stale?: boolean;
  /** Its column, for the narrow layout (LinkRow sets it). */
  "data-label"?: string;
}) {
  return (
    <td className="px-3 py-2.5" data-label={label}>
      <div className="flex min-w-[64px] flex-col gap-1.5">
        <span className={`font-mono text-[12px] tabular ${stale ? "text-ink-3" : "text-ink"}`}>
          {value}
        </span>
        {fraction != null && <Meter fraction={fraction} stale={stale} />}
      </div>
    </td>
  );
}

/** Observed history, newest first, a page at a time. */
export function EventTimeline({
  machineId,
  title = "History",
}: {
  machineId?: string;
  title?: string;
}) {
  // The `before` cursor of each page back from the newest; empty on the first page.
  const [cursors, setCursors] = useState<number[]>([]);
  const events = useQuery(eventsQuery(machineId, cursors.at(-1)));
  const navigate = useNavigate();
  const now = useNow();
  const page = events.data?.slice(0, EVENTS_PAGE) ?? [];
  const older = (events.data?.length ?? 0) > EVENTS_PAGE;
  return (
    <Section
      title={title}
      action={
        (cursors.length > 0 || older) && (
          <div className="flex items-center gap-1.5">
            <Button
              small
              disabled={cursors.length === 0}
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              Newer
            </Button>
            <Button
              small
              disabled={!older}
              onClick={() => setCursors([...cursors, page.at(-1)!.id])}
            >
              Older
            </Button>
          </div>
        )
      }
    >
      <Card className="overflow-hidden">
        {events.error && <ErrorText className="px-4 py-3" error={events.error} />}
        {events.data?.length === 0 && <EmptyLine>No events yet.</EmptyLine>}
        <ul className="divide-y divide-line">
          {page.map((e) => {
            const style = eventStyle[e.kind as keyof typeof eventStyle] ?? {
              label: e.kind,
              tone: "muted" as const,
            };
            return (
              <li key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-[12.5px]">
                <span className="mt-1.5">
                  <StatusDot tone={style.tone} size={7} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {!machineId && (
                      <button
                        className="font-medium hover:underline"
                        onClick={() =>
                          void navigate({ to: "/machines/$id", params: { id: e.machineId } })
                        }
                      >
                        {e.machineName}
                      </button>
                    )}
                    <span className={machineId ? "font-medium" : "text-ink-2"}>{style.label}</span>
                  </div>
                  <p className="text-[12px] break-words text-ink-2">{e.detail}</p>
                </div>
                <span
                  className="shrink-0 text-[11.5px] text-ink-3 tabular"
                  title={new Date(e.at).toLocaleString()}
                >
                  {now - e.at < 86_400_000 ? formatClock(e.at) : timeAgo(e.at, now)}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}
