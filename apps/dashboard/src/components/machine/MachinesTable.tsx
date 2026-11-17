import type { JobCounts, MachineView, RunnerView, YardView } from "@runyard/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, call } from "../../api.ts";
import { formatPercent, formatUptime } from "../../lib/format.ts";
import { memoryUsedFraction, primaryDisk } from "../../lib/health.ts";
import { osLabel } from "../../lib/status.ts";
import { Chip, type ChipTone, Panel, Sign, ttTable } from "../tt.tsx";

/*
 * The Machines page's table and phone list, from the Timetable design: each machine's platform
 * sign, name, state, a light per runner, health readings with bars, its jobs this week and uptime.
 */

/** A machine's state chip, as on its page's head. */
export function stateChip(m: MachineView): [ChipTone, string] {
  const c = m.connection.state;
  return c === "connected"
    ? ["ok", "Connected"]
    : c === "error"
      ? ["error", "SSH failed"]
      : c === "offline"
        ? ["neutral", "Offline"]
        : c === "stale"
          ? ["warn", "Stale"]
          : ["plain", "Checking…"];
}

function signTone(m: MachineView): "error" | "dim" | "normal" {
  return m.connection.state === "error"
    ? "error"
    : m.connection.state === "offline"
      ? "dim"
      : "normal";
}

/** "Ubuntu 24.04", "macOS 15.6", else the OS, else nothing. */
function system(m: MachineView): string | null {
  const os = m.os ? osLabel[m.os] : null;
  const version = m.health?.osVersion;
  if (!version) return os;
  // macOS reports only its number.
  return os && /^\d/.test(version) ? `${os} ${version}` : version;
}

/** The machine's line under its name: its system and where Runyard reaches it. */
function subline(m: MachineView): string {
  return [system(m), m.tailnet?.address ?? m.sshTarget].filter(Boolean).join(" · ");
}

function runnersOf(view: YardView): Map<string, RunnerView[]> {
  const by = new Map<string, RunnerView[]>();
  for (const r of view.runners)
    if (r.machineId) by.set(r.machineId, [...(by.get(r.machineId) ?? []), r]);
  return by;
}

/** A light per runner: orange working, outlined green idle, gray offline. */
export function RunnerLights({ runners }: { runners: RunnerView[] }) {
  return (
    <span
      className="flex flex-wrap gap-[3px]"
      aria-label={`${runners.filter((r) => r.activity === "busy").length} of ${runners.length} runners working`}
    >
      {runners.map((r) => (
        <i
          key={r.key}
          title={`${r.name}: ${r.activity}`}
          className={`h-[9px] w-[13px] rounded-[2px] border-[1.5px] ${
            r.activity === "busy"
              ? "border-tt-loco bg-tt-loco"
              : r.activity === "idle"
                ? "border-tt-ok"
                : "border-tt-rule-2 bg-tt-rule"
          }`}
        />
      ))}
    </span>
  );
}

/** A percentage with the design's thin bar; `warn` paints the bar amber. */
function Reading({ value, warn }: { value: number | null; warn?: boolean }) {
  if (value == null) return <span className="text-tt-ink-3">—</span>;
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {formatPercent(pct)}
      <span
        aria-hidden
        className="inline-block h-[5px] w-[72px] overflow-hidden rounded-[3px] bg-tt-rule"
      >
        <i
          className={`block h-full ${warn ? "bg-[#e3a800]" : "bg-tt-ink"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

function useJobsSummary() {
  return useQuery({
    queryKey: ["jobs-summary"],
    queryFn: async () =>
      (await call(api.jobs.summary.$get())) as unknown as {
        machines: Record<string, JobCounts>;
      },
    refetchInterval: 60_000,
  });
}

/** Every machine as a row of the design's table. */
export function MachinesTable({ view, machines }: { view: YardView; machines: MachineView[] }) {
  const byMachine = runnersOf(view);
  const summary = useJobsSummary();
  const num = "text-right tabular";
  return (
    <Panel className="overflow-x-auto">
      <table className={`${ttTable.table} min-w-[860px]`}>
        <thead>
          <tr>
            <th className={ttTable.th}>
              <span className="sr-only">Platform</span>
            </th>
            <th className={ttTable.th}>Machine</th>
            <th className={ttTable.th}>State</th>
            <th className={ttTable.th}>Runners</th>
            <th className={`${ttTable.th} !text-right`}>CPU</th>
            <th className={`${ttTable.th} !text-right`}>Memory</th>
            <th className={`${ttTable.th} !text-right`}>Disk free</th>
            <th className={`${ttTable.th} !text-right`}>Jobs, 7 days</th>
            <th className={`${ttTable.th} !text-right`}>Uptime</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => {
            const h = m.health;
            const runners = byMachine.get(m.id) ?? [];
            const disk = primaryDisk(h);
            const free = disk ? disk.availableBytes / Math.max(1, disk.totalBytes) : null;
            const jobs = summary.data?.machines[m.id];
            const total = jobs ? jobs.passed + jobs.failed + jobs.cancelled : 0;
            const [tone, label] = stateChip(m);
            const to = { to: "/machines/$id", params: { id: m.id } } as const;
            return (
              <tr key={m.id} className="relative cursor-pointer hover:bg-tt-hover">
                <td className={`${ttTable.td} w-[46px]`}>
                  <Sign n={view.machines.indexOf(m) + 1} tone={signTone(m)} />
                </td>
                <td className={ttTable.td}>
                  {/* The name's link covers the row, so the whole row opens the machine. */}
                  <Link {...to} className="block font-bold after:absolute after:inset-0">
                    {m.name}
                  </Link>
                  <small className="block text-[12px] text-tt-ink-3">{subline(m)}</small>
                </td>
                <td className={ttTable.td}>
                  <Chip tone={tone}>{label}</Chip>
                </td>
                <td className={ttTable.td}>
                  {runners.length ? (
                    <RunnerLights runners={runners} />
                  ) : (
                    <span className="text-tt-ink-3">None</span>
                  )}
                </td>
                <td className={`${ttTable.td} ${num}`}>
                  <Reading value={h?.cpuPercent == null ? null : h.cpuPercent / 100} />
                </td>
                <td className={`${ttTable.td} ${num}`}>
                  <Reading value={memoryUsedFraction(h)} />
                </td>
                <td className={`${ttTable.td} ${num}`}>
                  <Reading value={free} warn={free != null && free < 0.1} />
                </td>
                <td className={`${ttTable.td} ${num}`}>
                  {total ? (
                    <>
                      {total}
                      {jobs!.failed > 0 && (
                        <span className="text-tt-bad"> · {jobs!.failed} failed</span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${ttTable.td} ${num}`}>
                  {h?.uptimeSecs == null ? "—" : formatUptime(h.uptimeSecs)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

/** The phone list: sign, name, system and runners, state. */
export function MachinesCards({ view, machines }: { view: YardView; machines: MachineView[] }) {
  const byMachine = runnersOf(view);
  return (
    <div className="overflow-hidden rounded-xl border border-tt-rule bg-tt-card">
      {machines.map((m, i) => {
        const n = byMachine.get(m.id)?.length ?? 0;
        const [tone, label] = stateChip(m);
        return (
          <Link
            key={m.id}
            to="/machines/$id"
            params={{ id: m.id }}
            className={`flex w-full items-center gap-3 px-3.5 py-[13px] text-left hover:bg-tt-hover ${i ? "border-t border-tt-rule" : ""}`}
          >
            <Sign n={view.machines.indexOf(m) + 1} tone={signTone(m)} />
            <span className="min-w-0 flex-1">
              <b className="block truncate font-bold">{m.name}</b>
              <small className="block truncate text-[12px] text-tt-ink-3">
                {[system(m), `${n} ${n === 1 ? "runner" : "runners"}`].filter(Boolean).join(" · ")}
              </small>
            </span>
            <Chip tone={tone}>{label}</Chip>
          </Link>
        );
      })}
    </div>
  );
}
