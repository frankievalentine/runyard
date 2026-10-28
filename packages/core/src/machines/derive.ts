import { deriveGithub, type GithubView } from "../github/derive.ts";
import type { GithubAppObservation } from "../github/model.ts";
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

export type FleetView = {
  generatedAt: number;
  tailnet: { name: string | null; at: number | null; stale: boolean; error: string | null };
  machines: MachineView[];
  /** Desktop and server peers not added and not ignored. */
  discovered: PeerView[];
  ignored: PeerView[];
  alerts: Alert[];
  github: GithubView;
};

/** The whole dashboard view, from configuration and observations. No I/O. */
export function deriveFleet(input: {
  machines: MachineConfig[];
  observations: ReadonlyMap<string, MachineObservation>;
  tailnet: TailnetObservation;
  ignoredNodeIds: ReadonlySet<string>;
  states: ReadonlyMap<string, MachineState>;
  github?: GithubAppObservation[];
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
    github: deriveGithub(input.github ?? [], now),
  };
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
