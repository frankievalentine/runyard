import type { RunnerView, YardView } from "@runyard/core";
import { Link } from "@tanstack/react-router";
import { formatDollars } from "../../lib/format.ts";
import { unassignedGroups } from "../../lib/nav.ts";
import { primaryDisk } from "../../lib/health.ts";
import { machineSummary, osLabel, runnerStatus } from "../../lib/status.ts";
import { Icon } from "../icons.tsx";
import { InfoTip, RowTip, TipText } from "../InfoTip.tsx";

/** How many machines show before "Show more". */
const SHOWN = 5;

/**
 * A machine's line under its name, like the design: what's wrong when something is (SSH failed,
 * offline, how much disk is left), otherwise its system and version.
 */
function summary(m: YardView["machines"][number]): string {
  if (m.connection.state === "error") return "SSH failed";
  if (m.connection.state === "offline" || m.alerts.some((a) => a.kind === "offline" && !a.stale))
    return "Offline";
  if (m.alerts.some((a) => a.kind === "lowDisk" && !a.stale)) {
    const disk = primaryDisk(m.health);
    return disk
      ? `Disk ${Math.round((disk.availableBytes / Math.max(1, disk.totalBytes)) * 100)}% free`
      : "Low disk space";
  }
  if (m.health?.osVersion) return m.health.osVersion;
  return m.os ? osLabel[m.os] : machineSummary(m);
}

/**
 * The Board's platforms, as in the Timetable design: each machine with its platform number, a
 * light per runner (orange working, green idle, gray offline; each names itself on hover), then boat.dev, runners outside
 * pools and tailnet devices. The first five machines show; the rest are on Machines.
 */
export function Platforms({ view }: { view: YardView }) {
  const byMachine = new Map<string, RunnerView[]>();
  for (const r of view.runners) {
    if (r.machineId) byMachine.set(r.machineId, [...(byMachine.get(r.machineId) ?? []), r]);
  }
  const machines = view.machines.slice(0, SHOWN);
  const more = view.machines.length - machines.length;
  const s = view.summary;
  const boatRunners = view.runners.filter((r) => r.onDemand === "boat.dev");
  const boatCost = boatRunners.reduce((sum, r) => sum + (view.boatVms[r.key]?.dollars ?? 0), 0);
  const unassigned = unassignedGroups(view.runners).reduce((n, g) => n + g.runners.length, 0);
  const device = view.discovered[0];

  return (
    <section
      aria-labelledby="platforms-title"
      className="flex min-w-0 flex-col rounded-xl border border-tt-rule bg-tt-card"
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <span className="flex items-center gap-1.5">
          <h2
            id="platforms-title"
            className="text-[13px] font-extrabold tracking-[.06em] uppercase"
          >
            Platforms
          </h2>
          <InfoTip label="Platforms">
            <TipText
              what="Your machines, numbered like platforms in a station. Each small box is one of its runners."
              details="Orange: working. Green outline: idle. Gray: offline. A red number means Runyard can't reach the machine over SSH; a gray one means it's offline."
            />
          </InfoTip>
        </span>
        <span className="text-[12.5px] text-tt-ink-3">
          {view.machines.length === 0
            ? "No machines yet"
            : `${s.busy} working · ${s.idle} idle · ${s.offline} offline`}
        </span>
      </header>
      <div className="flex-1">
        {view.machines.length === 0 && (
          // The design's empty platforms: a dashed machine, what adding one does, and the button.
          <div className="flex flex-col items-start gap-2.5 px-4 pt-1 pb-4">
            <span
              aria-hidden
              className="grid size-[34px] place-items-center rounded-md border-[1.5px] border-dashed border-tt-rule-2 text-tt-ink-3"
            >
              <Icon name="server" size={16} />
            </span>
            <h3 className="text-[17px] font-bold">No machines yet</h3>
            <p className="text-[13px] text-tt-ink-2">
              Add a machine and Runyard checks it over SSH every minute. It changes nothing until
              you review it.
            </p>
            <Link
              to="/machines/add"
              className="mt-1 inline-flex h-10 items-center gap-2 rounded-lg bg-tt-inv px-4 text-[13.5px] font-semibold text-tt-on-inv hover:opacity-90"
            >
              <Icon name="plus" size={14} />
              <span className="mt-[2px]">Add machine</span>
            </Link>
          </div>
        )}
        {machines.map((m, i) => {
          const runners = byMachine.get(m.id) ?? [];
          const bad = m.connection.state === "error";
          const off = m.connection.state === "offline";
          return (
            <Link
              key={m.id}
              to="/machines/$id"
              params={{ id: m.id }}
              className={`flex items-center gap-3 px-4 py-[9px] hover:bg-tt-hover ${i > 0 ? "border-t border-tt-rule" : ""}`}
            >
              <span
                className={`grid size-[30px] flex-none place-items-center rounded-[5px] text-[16px] leading-none font-extrabold [font-stretch:85%] ${
                  bad
                    ? "bg-tt-bad text-white"
                    : off
                      ? "bg-[#6f7680] text-white"
                      : "bg-tt-inv text-tt-on-inv"
                }`}
                aria-hidden
              >
                {view.machines.indexOf(m) + 1}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[14px] font-bold">{m.name}</b>
                <small className="block truncate text-[12px] text-tt-ink-3">{summary(m)}</small>
              </span>
              {runners.length === 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-tt-bad-bg px-2 py-0.5 text-[11.5px] font-semibold text-tt-bad-ink">
                  <i className="size-1.5 rounded-full bg-tt-bad" aria-hidden />
                  No runners
                </span>
              ) : (
                <span
                  className="flex flex-none gap-[3px]"
                  aria-label={`${runners.filter((r) => r.activity === "busy").length} of ${runners.length} runners working`}
                >
                  {runners.map((r) => (
                    <RowTip
                      key={r.key}
                      content={<TipText what={`${r.name} · ${runnerStatus(r).label}`} />}
                    >
                      <i
                        className={`h-[9px] w-[13px] rounded-[2px] border-[1.5px] ${
                          r.activity === "busy"
                            ? "border-tt-loco bg-tt-loco"
                            : r.activity === "idle"
                              ? "border-tt-ok"
                              : "border-tt-off"
                        }`}
                      />
                    </RowTip>
                  ))}
                </span>
              )}
            </Link>
          );
        })}
        {/* The rest are on Machines, which lists them all with more than this card can hold. */}
        {more > 0 && (
          <Link
            to="/machines"
            className="block w-full border-t border-tt-rule px-4 py-2.5 text-left text-[12.5px] font-semibold text-tt-ink-2 hover:text-tt-ink"
          >
            All {view.machines.length} machines <span aria-hidden>→</span>
          </Link>
        )}
      </div>
      {(view.boat || boatRunners.length > 0 || unassigned > 0 || device) && (
        <div className="border-t border-tt-rule px-2 pt-1.5 pb-2">
          {(view.boat || boatRunners.length > 0) && (
            <Link
              to="/boat"
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] text-tt-ink-2 hover:bg-tt-hover hover:text-tt-ink"
            >
              <span className="text-tt-ink-3">
                <Icon name="runner" size={16} />
              </span>
              <span>
                <b className="font-semibold text-tt-ink">boat.dev</b> ·{" "}
                {boatRunners.length === 1 ? "1 VM" : `${boatRunners.length} VMs`} on a job
                {boatCost ? ` · ${formatDollars(boatCost)} so far` : ""}
              </span>
            </Link>
          )}
          {unassigned > 0 && (
            <Link
              to="/machines"
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] text-tt-ink-2 hover:bg-tt-hover hover:text-tt-ink"
            >
              <span className="text-tt-ink-3">
                <Icon name="runner" size={16} />
              </span>
              <span>
                <b className="font-semibold text-tt-ink">
                  {unassigned} {unassigned === 1 ? "runner" : "runners"}
                </b>{" "}
                {unassigned === 1 ? "isn't" : "aren't"} in a pool
              </span>
            </Link>
          )}
          {device && (
            <Link
              to="/machines/add"
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] text-tt-ink-2 hover:bg-tt-hover hover:text-tt-ink"
            >
              <span className="text-tt-ink-3">
                <Icon name="machine" size={16} />
              </span>
              {view.machines.length === 0 ? (
                // A new install: the device is the obvious first machine, so it reads as a find.
                <>
                  <span className="min-w-0 flex-1 truncate">
                    Found on your tailnet:{" "}
                    <b className="font-semibold text-tt-ink">{device.name}</b>
                    {` · ${osLabel[device.os]} · ${device.online ? "online" : "offline"}`}
                  </span>
                  <span className="font-semibold text-tt-ink">Add</span>
                </>
              ) : (
                <span>
                  <b className="font-semibold text-tt-ink">{device.name}</b> is on your tailnet but
                  not added
                </span>
              )}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
