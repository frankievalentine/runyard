import type { RunnerView, YardView } from "@runyard/core";
import { Link } from "@tanstack/react-router";
import { machineStatus, machineSummary } from "../../lib/status.ts";
import { StatusDot } from "../ui.tsx";

const LIGHT: Record<string, string> = {
  busy: "bg-tt-loco border-tt-loco",
  idle: "bg-tt-ok border-tt-ok",
  offline: "bg-transparent border-tt-off",
};

/**
 * The Board's platforms: each machine with a light per runner (orange working, green idle, hollow
 * offline), so where there's room to run a job reads at a glance. Opens the machine.
 */
export function Platforms({
  view,
  besideBoard = false,
}: {
  view: YardView;
  besideBoard?: boolean;
}) {
  const byMachine = new Map<string, RunnerView[]>();
  for (const r of view.runners) {
    if (r.machineId) byMachine.set(r.machineId, [...(byMachine.get(r.machineId) ?? []), r]);
  }
  const free = view.runners.filter((r) => r.machineId && r.activity === "idle").length;
  return (
    <section
      aria-labelledby="platforms-title"
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-tt-rule bg-tt-card ${besideBoard ? "[contain:size] max-lg:[contain:none]" : ""}`}
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-tt-rule px-4 pt-3.5 pb-3">
        <h2 id="platforms-title" className="text-[13px] font-extrabold tracking-[.08em] uppercase">
          Platforms
        </h2>
        <span className="text-[12px] text-tt-ink-3">
          {view.machines.length === 0
            ? "No machines yet"
            : `${free} ${free === 1 ? "runner" : "runners"} free`}
        </span>
      </header>
      <div className="scroll min-h-0 flex-1">
        {view.machines.length === 0 && (
          <p className="px-4 py-4 text-[13px] text-tt-ink-2">
            No machines yet.{" "}
            <Link to="/machines/add" className="font-semibold underline">
              Add a machine
            </Link>{" "}
            and Runyard checks it over SSH every minute.
          </p>
        )}
        {view.machines.map((m) => {
          const status = machineStatus(m);
          const runners = byMachine.get(m.id) ?? [];
          return (
            <Link
              key={m.id}
              to="/machines/$id"
              params={{ id: m.id }}
              className="flex items-center gap-3 border-b border-tt-rule px-4 py-2.5 last:border-b-0 hover:bg-tt-hover"
            >
              <StatusDot tone={status.tone} hollow={status.hollow} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold">{m.name}</span>
                <span className="block truncate text-[12px] text-tt-ink-3">
                  {machineSummary(m)}
                </span>
              </span>
              <span
                className="flex shrink-0 flex-wrap justify-end gap-1"
                aria-label={`${runners.filter((r) => r.activity === "busy").length} of ${runners.length} runners working`}
              >
                {runners.length === 0 ? (
                  <span className="text-[12px] text-tt-ink-3">No runners</span>
                ) : (
                  runners.map((r) => (
                    <i
                      key={r.key}
                      title={`${r.name}: ${r.activity}`}
                      className={`size-3 rounded-[3px] border ${LIGHT[r.activity] ?? LIGHT.offline}`}
                    />
                  ))
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
