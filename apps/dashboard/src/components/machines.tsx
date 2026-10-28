import type { Alert, MachineView } from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { eventsQuery } from "../lib/fleet.ts";
import { formatBytes, formatClock, formatPercent, timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { eventStyle, machineStatus, osLabel } from "../lib/status.ts";
import { Card, EmptyLine, ErrorText, Pill, StatusDot } from "./ui.tsx";

/** Active alerts, with the machine named when listed across machines. Ported from fleet. */
export function ActiveAlerts({
  alerts,
  showMachine = false,
}: {
  alerts: Alert[];
  showMachine?: boolean;
}) {
  const now = useNow();
  return (
    <Card className="divide-y divide-warn/15 overflow-hidden border-warn/30 bg-warn/5">
      {alerts.map((alert) => (
        <div key={alert.id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
            <StatusDot tone={alert.kind === "offline" ? "bad" : "warn"} />
            {showMachine && (
              <Link to="/machines/$id" params={{ id: alert.machineId }} className="hover:underline">
                {alert.machineName}
              </Link>
            )}
            <span>{alert.kind === "offline" ? "Offline" : "Low disk space"}</span>
            {alert.muted && <Pill tone="muted">Maintenance</Pill>}
            {alert.stale && (
              <Pill tone="muted" hollow>
                Awaiting fresh data
              </Pill>
            )}
          </div>
          <p className="mt-1 text-[12px] break-words whitespace-pre-line text-ink-2">
            {alert.detail}
          </p>
          <p className="mt-1 text-[11px] text-ink-3" title={new Date(alert.since).toLocaleString()}>
            First observed {timeAgo(alert.since, now)}
          </p>
        </div>
      ))}
    </Card>
  );
}

/** The tightest disk on a machine, as a free-space percentage. */
export function tightestDisk(m: MachineView) {
  const disks = m.health?.disks ?? [];
  if (disks.length === 0) return null;
  return disks.reduce((a, b) =>
    a.availableBytes / a.totalBytes <= b.availableBytes / b.totalBytes ? a : b,
  );
}

export function MachineTable({ machines }: { machines: MachineView[] }) {
  const now = useNow();
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[12.5px]">
        <thead className="border-b border-line text-[11.5px] text-ink-2">
          <tr>
            {["Machine", "Status", "OS", "CPU", "Memory", "Disk free", "Last read"].map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {machines.map((m) => {
            const status = machineStatus(m);
            const h = m.health;
            const disk = tightestDisk(m);
            const dim = h?.stale ? "opacity-50" : "";
            return (
              <tr key={m.id} className="hover:bg-hover">
                <td className="px-4 py-2.5">
                  <Link
                    to="/machines/$id"
                    params={{ id: m.id }}
                    className="font-medium hover:underline"
                  >
                    {m.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <StatusDot tone={status.tone} hollow={status.hollow} />
                    {status.label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-2">{m.os ? osLabel[m.os] : "—"}</td>
                <td className={`px-4 py-2.5 tabular ${dim}`}>
                  {h?.cpuPercent != null ? formatPercent(h.cpuPercent) : "—"}
                </td>
                <td className={`px-4 py-2.5 tabular ${dim}`}>
                  {h?.memoryTotalBytes != null && h.memoryAvailableBytes != null
                    ? `${formatBytes(h.memoryTotalBytes - h.memoryAvailableBytes)} / ${formatBytes(h.memoryTotalBytes)}`
                    : "—"}
                </td>
                <td className={`px-4 py-2.5 tabular ${dim}`}>
                  {disk ? formatPercent((100 * disk.availableBytes) / disk.totalBytes) : "—"}
                </td>
                <td className="px-4 py-2.5 text-ink-2">{h ? timeAgo(h.asOf, now) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/** Observed history, newest first. */
export function EventList({ machineId }: { machineId?: string }) {
  const events = useQuery(eventsQuery(machineId));
  const now = useNow();
  return (
    <Card className="overflow-hidden">
      {events.error && <ErrorText className="px-4 py-3" error={events.error} />}
      {events.data?.length === 0 && <EmptyLine>No events yet.</EmptyLine>}
      <ul className="divide-y divide-line">
        {events.data?.map((e) => {
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
                    <Link
                      to="/machines/$id"
                      params={{ id: e.machineId }}
                      className="font-medium hover:underline"
                    >
                      {e.machineName}
                    </Link>
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
  );
}
