import { boatVmsByRunner, deriveBoat, type BoatView, type BoatVm } from "../boat/derive.ts";
import type { BoatObservation } from "../boat/model.ts";
import { deriveForgejo, type ForgejoView } from "../forgejo/derive.ts";
import type { ForgejoConnectionObservation } from "../forgejo/model.ts";
import {
  deriveGithub,
  type GithubView,
  type QueuedJobView,
  type RunnerView,
} from "../github/derive.ts";
import type { GithubAppObservation } from "../github/model.ts";
import type { ForgeKind, Scope } from "../model.ts";
import { scopeKey } from "../scope.ts";
import { desiredRunners, nameCollisions } from "../pools/desired.ts";
import type { DesiredRunner, Pool } from "../pools/model.ts";
import type { Registration } from "../pools/plan.ts";
import { evaluateDiagnostics } from "./diagnostics.ts";
import {
  canHostRunners,
  osFromTailnet,
  peerAddress,
  SSH_STALE_AFTER_MS,
  type Diagnostic,
  type MachineReport,
  type OsFamily,
  type SshTransport,
  type TailnetPeer,
  type TailnetSnapshot,
} from "./model.ts";
import {
  alerts as machineAlerts,
  type Alert,
  type Connection,
  type MachineState,
  type Observed,
} from "./monitoring.ts";

/** Tailnet data older than this no longer counts as a fresh observation. */
export const TAILNET_STALE_AFTER_MS = 60_000;

/** A machine the user added to Runyard. */
export type MachineConfig = {
  id: string;
  name: string;
  description: string;
  sshTarget: string;
  transport: SshTransport;
  /** The OS the machine must report; null accepts any. */
  expectedOs: OsFamily | null;
  /** Set when the machine was added from the tailnet. */
  tailscaleNodeId: string | null;
};

export type Timed<T> = { at: number; value: T };

export type MachineObservation = {
  report: Timed<MachineReport> | null;
  error: Timed<string> | null;
};

export type TailnetObservation = {
  /** When the tailnet was last read successfully. */
  at: number | null;
  snapshot: TailnetSnapshot | null;
  error: string | null;
};

export type HealthView = Omit<MachineReport, "diagnostics" | "warnings"> & {
  asOf: number;
  stale: boolean;
  warnings: string[];
};

export type PeerView = {
  nodeId: string;
  name: string;
  address: string;
  os: OsFamily;
  online: boolean;
  lastSeen: number | null;
  tailscaleSsh: boolean;
  tags: string[];
};

export type MachineView = {
  id: string;
  name: string;
  description: string;
  sshTarget: string;
  transport: SshTransport;
  os: OsFamily | null;
  tailnet: (PeerView & { ips: string[] }) | null;
  connection: Connection;
  health: HealthView | null;
  diagnostics: { asOf: number; stale: boolean; checks: Diagnostic[] } | null;
  alerts: Alert[];
  maintenanceUntil: number | null;
};

/** A runner Runyard didn't register, placed on a machine by an admin. Display only. */
export type RunnerAssignment = { scope: Scope; runnerName: string; machineId: string };

export type FleetView = {
  generatedAt: number;
  tailnet: { name: string | null; at: number | null; stale: boolean; error: string | null };
  machines: MachineView[];
  /** Desktop and server peers not added and not ignored. */
  discovered: PeerView[];
  ignored: PeerView[];
  alerts: Alert[];
  github: GithubView;
  forgejo: ForgejoView;
  /** Every forge's runners, sorted by name. */
  runners: RunnerView[];
  /** Every forge's self-hosted jobs waiting for a runner. */
  queue: { jobs: QueuedJobView[]; complete: boolean; at: number | null };
  summary: { runners: number; busy: number; idle: number; offline: number; unknown: number };
  /** boat's VMs and limits, when connected. */
  boat: BoatView | null;
  /** The boat VM running each boat runner's job, by runner key. */
  boatVms: Record<string, BoatVm>;
  /** Runners on a machine by an admin's assignment rather than a Runyard registration, by key. */
  assignedRunners: string[];
  pools: PoolsView;
};

export type PoolsView = {
  pools: Pool[];
  /** Every runner the pools call for. */
  desired: DesiredRunner[];
  /** Desired runners that would share a name in one scope. */
  collisions: string[];
  /** Runners Runyard registered. */
  registrations: Registration[];
};

/** The whole dashboard view, from configuration and observations. No I/O. */
export function deriveFleet(input: {
  machines: MachineConfig[];
  observations: ReadonlyMap<string, MachineObservation>;
  tailnet: TailnetObservation;
  ignoredNodeIds: ReadonlySet<string>;
  states: ReadonlyMap<string, MachineState>;
  github?: GithubAppObservation[];
  forgejo?: ForgejoConnectionObservation[];
  /** Present once a boat API key is saved. */
  boat?: BoatObservation | null;
  assignments?: RunnerAssignment[];
  pools?: Pool[];
  registrations?: Registration[];
  now: number;
}): FleetView {
  const { now, tailnet } = input;
  const peers = tailnet.snapshot?.peers ?? [];
  const tailnetFresh = tailnet.at !== null && now - tailnet.at <= TAILNET_STALE_AFTER_MS;
  const linked = new Set<string>();

  const machines = input.machines
    .map((config): MachineView => {
      const peer = findPeer(config, peers);
      if (peer) linked.add(peer.nodeId);
      const observation = input.observations.get(config.id);
      const health = healthView(observation, now);
      const view: MachineView = {
        id: config.id,
        name: config.name,
        description: config.description,
        sshTarget: config.sshTarget,
        transport: config.transport,
        os: health?.os ?? config.expectedOs ?? (peer ? osFromTailnet(peer.os) : null),
        tailnet: peer ? { ...peerView(peer), ips: peer.ips } : null,
        connection: connection(peer, observation, now),
        health,
        diagnostics:
          observation?.report && Object.keys(observation.report.value.diagnostics).length > 0
            ? {
                asOf: observation.report.at,
                stale: health?.stale ?? true,
                checks: evaluateDiagnostics(observation.report.value),
              }
            : null,
        alerts: [],
        maintenanceUntil: input.states.get(config.id)?.maintenanceUntil ?? null,
      };
      const state = input.states.get(config.id);
      if (state) view.alerts = machineAlerts(state, config.id, observed(view), tailnetFresh, now);
      return view;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const candidates = peers.filter(
    (p) => p.nodeId !== tailnet.snapshot?.selfNodeId && !linked.has(p.nodeId),
  );
  return {
    generatedAt: now,
    tailnet: {
      name: tailnet.snapshot?.tailnetName ?? null,
      at: tailnet.at,
      stale: !tailnetFresh,
      error: tailnet.error,
    },
    machines,
    discovered: candidates
      .filter((p) => canHostRunners(p) && !input.ignoredNodeIds.has(p.nodeId))
      .map(peerView),
    ignored: candidates.filter((p) => input.ignoredNodeIds.has(p.nodeId)).map(peerView),
    alerts: machines.flatMap((m) => m.alerts),
    ...forges(
      input.github ?? [],
      input.forgejo ?? [],
      input.registrations ?? [],
      input.assignments ?? [],
      now,
      input.boat ?? null,
    ),
    pools: poolsView(
      input.pools ?? [],
      input.registrations ?? [],
      machines,
      new Map<string, ForgeKind>([
        ...(input.github ?? []).map((g): [string, ForgeKind] => [g.forgeId, "github"]),
        ...(input.forgejo ?? []).map((f): [string, ForgeKind] => [f.forgeId, "forgejo"]),
      ]),
    ),
  };
}

/** Both forges' views, and their runners, queue and counts merged. */
function forges(
  github: GithubAppObservation[],
  forgejo: ForgejoConnectionObservation[],
  registrations: Registration[],
  assignments: RunnerAssignment[],
  now: number,
  boatObs: BoatObservation | null,
) {
  const link = (scope: Scope, name: string) => `${scopeKey(scope)}:${name.toLowerCase()}`;
  const registered = new Map(registrations.map((r) => [link(r.scope, r.runnerName), r.machineId]));
  // A Runyard registration wins over an admin's assignment of the same runner.
  const assigned = new Map(
    assignments
      .map((a): [string, string] => [link(a.scope, a.runnerName), a.machineId])
      .filter(([k]) => !registered.has(k)),
  );
  const links = new Map([...assigned, ...registered]);
  const gh = deriveGithub(github, now, links);
  const fj = deriveForgejo(forgejo, now, links);
  const runners = [...gh.runners, ...fj.runners].sort(
    (a, b) => a.name.localeCompare(b.name) || a.scopeLabel.localeCompare(b.scopeLabel),
  );
  const summary = { runners: runners.length, busy: 0, idle: 0, offline: 0, unknown: 0 };
  for (const r of runners) summary[r.activity]++;
  const at = [gh.queue.at, fj.queue.at].filter((t): t is number => t !== null);
  const boat = boatObs ? deriveBoat(boatObs, runners, now) : null;
  return {
    assignedRunners: runners.filter((r) => assigned.has(link(r.scope, r.name))).map((r) => r.key),
    boat,
    boatVms: boat ? Object.fromEntries(boatVmsByRunner(boat, runners)) : {},
    github: gh,
    forgejo: fj,
    runners,
    summary,
    queue: {
      jobs: [...gh.queue.jobs, ...fj.queue.jobs].sort((a, b) => a.createdAt - b.createdAt),
      complete:
        (github.length === 0 || gh.queue.complete) && (forgejo.length === 0 || fj.queue.complete),
      at: at.length ? Math.min(...at) : null,
    },
  };
}

function poolsView(
  pools: Pool[],
  registrations: Registration[],
  machines: MachineView[],
  forgeKinds: ReadonlyMap<string, ForgeKind>,
): PoolsView {
  const info = new Map(machines.map((m) => [m.id, { name: m.name, os: m.os }]));
  const desired = desiredRunners(pools, info, forgeKinds);
  return { pools, desired, collisions: nameCollisions(desired), registrations };
}

/** What the monitoring state machine needs from a machine's view. */
export function observed(view: MachineView): Observed {
  return {
    name: view.name,
    tailnetOnline: view.tailnet?.online ?? null,
    connection: view.connection,
    health: view.health
      ? {
          asOf: view.health.asOf,
          stale: view.health.stale,
          bootId: view.health.bootId,
          disks: view.health.disks,
        }
      : null,
  };
}

/** The machine's peer: by node ID when added from the tailnet, else by matching its SSH target's host. */
export function findPeer(
  config: MachineConfig,
  peers: readonly TailnetPeer[],
): TailnetPeer | undefined {
  if (config.tailscaleNodeId) return peers.find((p) => p.nodeId === config.tailscaleNodeId);
  const host = sshHost(config.sshTarget).toLowerCase();
  return peers.find(
    (p) =>
      p.dnsName?.toLowerCase() === host ||
      p.ips.includes(host) ||
      p.hostname.toLowerCase() === host ||
      p.dnsName?.toLowerCase().split(".")[0] === host,
  );
}

/** The host part of `user@host`. */
export function sshHost(target: string): string {
  return target.slice(target.lastIndexOf("@") + 1);
}

function peerView(peer: TailnetPeer): PeerView {
  return {
    nodeId: peer.nodeId,
    name: peer.hostname || peer.dnsName?.split(".")[0] || peer.nodeId,
    address: peerAddress(peer),
    os: osFromTailnet(peer.os),
    online: peer.online,
    lastSeen: peer.lastSeen,
    tailscaleSsh: peer.sshHostKeys.length > 0,
    tags: peer.tags,
  };
}

function healthView(observation: MachineObservation | undefined, now: number): HealthView | null {
  const report = observation?.report;
  if (!report) return null;
  const failedSince = observation.error && observation.error.at >= report.at;
  const { diagnostics: _, ...metrics } = report.value;
  return {
    ...metrics,
    asOf: report.at,
    stale: Boolean(failedSince) || now - report.at > SSH_STALE_AFTER_MS,
  };
}

/** Ported from fleet's `machine_connection`. */
export function connection(
  peer: TailnetPeer | undefined,
  observation: MachineObservation | undefined,
  now: number,
): Connection {
  if (peer && !peer.online) return { state: "offline", lastSeen: peer.lastSeen };
  if (!observation) return { state: "pending" };
  const { report } = observation;
  const error =
    observation.error && (!report || observation.error.at >= report.at) ? observation.error : null;
  if (report && !error && now - report.at <= SSH_STALE_AFTER_MS)
    return { state: "connected", checkedAt: report.at };
  if (report)
    return { state: "stale", checkedAt: report.at, reason: error?.value ?? "No recent SSH check." };
  if (error) return { state: "error", detail: error.value };
  return { state: "pending" };
}
