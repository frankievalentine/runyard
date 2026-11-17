import type { QueuedJobView, RunnerView } from "../github/derive.ts";
import type { YardView } from "../machines/derive.ts";
import { waitingState } from "./waiting.ts";

/*
 * The Board's departures: running jobs, then jobs waiting for a runner, as rows of a station
 * departure board. The words follow the queue's own status pills. No I/O.
 */

/** How a row reads at a glance: moving, held up (needs a person), boarding (about to go) or neutral. */
export type DepartureTone = "moving" | "held" | "boarding" | "neutral";

export type Departure = {
  key: string;
  kind: "running" | "waiting";
  /** When it started running, or was queued. */
  at: number;
  job: string;
  repo: string;
  /** The runner (or on-demand service) it runs on, or will. */
  platform: string;
  status: string;
  tone: DepartureTone;
  /** Opens this runner's page, for running jobs. */
  runnerKey?: string;
  /** The job's labels, for waiting jobs. */
  labels: string[];
};

function running(r: RunnerView): Departure {
  return {
    key: `run:${r.key}`,
    kind: "running",
    at: r.job?.startedAt ?? r.job?.createdAt ?? 0,
    job: r.job?.name ?? "Job details unavailable",
    repo: r.job?.repo ?? r.scopeLabel,
    platform: r.onDemand ? `${r.onDemand} · ${r.name}` : r.name,
    status: "On its way",
    tone: "moving",
    runnerKey: r.key,
    labels: r.job?.labels ?? [],
  };
}

function waiting(job: QueuedJobView, view: YardView): Departure {
  const eligible = view.runners.filter((r) => job.eligible.includes(r.key));
  const idle = eligible.filter((r) => r.activity === "idle").length;
  const limits = job.onDemand === "boat.dev" ? view.boat?.limits : null;
  let status: string;
  let tone: DepartureTone;
  let platform = "";
  if (limits?.atConcurrencyLimit) {
    status = `Waiting: boat.dev is at ${limits.maxActiveSandboxes} VMs`;
    tone = "held";
  } else if (limits?.atStartLimit) {
    status = "Waiting for boat.dev's start limit";
    tone = "held";
  } else if (job.onDemand) {
    status = `Starts on ${job.onDemand}`;
    tone = "boarding";
    platform = job.onDemand;
  } else if (eligible.length === 0) {
    const state = waitingState(job, view);
    status =
      state === "runnerStarting"
        ? "Runner starting"
        : state === "runnerOnline"
          ? "Runner online"
          : state === "poolPaused"
            ? "Pool paused"
            : "No matching runner online";
    tone = state === "noRunner" ? "held" : state === "poolPaused" ? "neutral" : "boarding";
  } else if (idle > 0) {
    status = idle === 1 ? "1 idle runner matches" : `${idle} idle runners match`;
    tone = "boarding";
    platform = eligible.find((r) => r.activity === "idle")?.name ?? "";
  } else {
    status = `${eligible.length} matching, all busy`;
    tone = "neutral";
  }
  return {
    key: `wait:${job.forge}:${job.id}`,
    kind: "waiting",
    at: job.createdAt,
    job: job.name,
    repo: job.repo,
    platform,
    status,
    tone,
    labels: job.labels,
  };
}

/** Running jobs (longest running first), then waiting jobs (longest waiting first). */
export function departures(view: YardView): Departure[] {
  const run = view.runners
    .filter((r) => r.activity === "busy")
    .map(running)
    .sort((a, b) => a.at - b.at);
  const wait = view.queue.jobs.map((j) => waiting(j, view)).sort((a, b) => a.at - b.at);
  return [...run, ...wait];
}
