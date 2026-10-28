import type { RunnerView } from "../github/derive.ts";
import {
  BOAT_STALE_AFTER_MS,
  type BoatLimits,
  type BoatObservation,
  type BoatSandbox,
} from "./model.ts";

/** A CI job's VM, joined to the runner GitHub reports for it. */
export type BoatVm = {
  id: string;
  name: string;
  type: string;
  size: string | null;
  createdAt: number;
  dollars: number | null;
  /** The GitHub job it runs, from boat's `ci-<repo>-<job id>` name. */
  jobId: number | null;
};

export type BoatView = {
  at: number | null;
  stale: boolean;
  error: string | null;
  limits: (BoatLimits & { atConcurrencyLimit: boolean; atStartLimit: boolean }) | null;
  /** Every running VM. */
  running: BoatVm[];
  /**
   * Running VMs that aren't a current CI job: still billing, perhaps forgotten.
   * A CI VM counts only after BOAT_CI_GRACE_MS, since it starts before GitHub
   * reports its job running, and its repository may be outside the job scan.
   */
  leftover: BoatVm[];
};

/** How long a CI VM may run without a matching running job before it counts as left running. */
export const BOAT_CI_GRACE_MS = 15 * 60_000;

/** States in which a VM is (or is about to be) billing. */
export const BOAT_ACTIVE_STATES = [
  "init",
  "provisioning",
  "provisioned",
  "cloning",
  "ready",
  "idle",
  "running",
];

/** boat's CI VMs are named `ci-<repo>-<job id>`; GitHub job IDs are unique on their own. */
export function boatJobId(name: string): number | null {
  const match = /^ci-.+-(\d+)$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** boat's VMs and limits, matched to the GitHub jobs now running on boat. No I/O. */
export function deriveBoat(obs: BoatObservation, runners: RunnerView[], now: number): BoatView {
  const at = obs.sandboxes?.at ?? null;
  const stale = at === null || now - at > BOAT_STALE_AFTER_MS;
  const jobs = new Set(runners.filter((r) => r.onDemand === "boat" && r.job).map((r) => r.job!.id));
  const running = (obs.sandboxes?.value ?? [])
    .filter((s) => BOAT_ACTIVE_STATES.includes(s.state))
    .map(vm)
    .sort((a, b) => a.createdAt - b.createdAt);
  const limits = obs.limits?.value ?? null;
  return {
    at,
    stale,
    error: obs.error,
    limits: limits && {
      ...limits,
      atConcurrencyLimit: limits.activeSandboxes >= limits.maxActiveSandboxes,
      atStartLimit:
        limits.startsThisMinute !== null &&
        limits.startsThisMinute.used >= limits.startsThisMinute.limit,
    },
    running,
    leftover: stale
      ? []
      : running.filter(
          (v) => v.jobId === null || (!jobs.has(v.jobId) && now - v.createdAt > BOAT_CI_GRACE_MS),
        ),
  };
}

/** The boat VM running each boat runner's job, keyed by runner key. */
export function boatVmsByRunner(view: BoatView, runners: RunnerView[]): Map<string, BoatVm> {
  const byJob = new Map(view.running.filter((v) => v.jobId !== null).map((v) => [v.jobId!, v]));
  const out = new Map<string, BoatVm>();
  for (const r of runners) {
    const v = r.onDemand === "boat" && r.job ? byJob.get(r.job.id) : undefined;
    if (v) out.set(r.key, v);
  }
  return out;
}

function vm(s: BoatSandbox): BoatVm {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    size: s.vcpu && s.memoryGB ? `${s.vcpu} vCPU, ${s.memoryGB} GB` : null,
    createdAt: s.createdAt,
    dollars: s.dollars,
    jobId: boatJobId(s.name),
  };
}
