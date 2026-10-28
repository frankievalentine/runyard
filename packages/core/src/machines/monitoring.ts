import { freePercent, gib, LOW_DISK_FREE_PERCENT, type DiskStats } from "./model.ts";

/** Ported from aarondfrancis/fleet's `monitoring/state.rs`; runner service tracking arrives with runner management. */
export const OFFLINE_DELAY_MS = 3 * 60_000;
export const DISK_DELAY_MS = 60_000;
/** A low-disk alert clears only this far above the threshold, so readings near it don't flap. */
export const DISK_RECOVERY_MARGIN_PERCENT = 2;
export const MAINTENANCE_MS = 60 * 60_000;

export type EventKind =
  | "monitoringStarted"
  | "targetChanged"
  | "online"
  | "offline"
  | "sshUnavailable"
  | "sshRecovered"
  | "rebooted"
  | "offlineAlert"
  | "lowDisk"
  | "diskRecovered"
  | "maintenanceStarted"
  | "maintenanceEnded"
  | "alertsResumed"
  /** On-demand pools: one-job runners Runyard started and how they ended. */
  | "runnerStarted"
  | "runnerFinished"
  | "runnerFailed";

/** `notify` marks changes a future notification channel should announce. */
export type Change = { kind: EventKind; detail: string; notify: boolean };

export type AlertKind = "offline" | "lowDisk";

export type Alert = {
  id: string;
  machineId: string;
  machineName: string;
  kind: AlertKind;
  since: number;
  detail: string;
  /** The observations behind the alert are no longer current. */
  stale: boolean;
  muted: boolean;
};

export type Connection =
  | { state: "connected"; checkedAt: number }
  | { state: "stale"; checkedAt: number; reason: string }
  | { state: "offline"; lastSeen: number | null }
  | { state: "error"; detail: string }
  | { state: "pending" };

/** What one monitoring round sees of a machine. */
export type Observed = {
  name: string;
  /** The tailnet peer's online state, when the machine is on the tailnet. */
  tailnetOnline: boolean | null;
  connection: Connection;
  health: { asOf: number; stale: boolean; bootId: string | null; disks: DiskStats[] } | null;
};

type DiskState = {
  pendingSince: number | null;
  activeSince: number | null;
  announced: boolean;
  at: number | null;
  free: number;
  total: number;
};

/** Persisted per-machine baselines, so a restart neither repeats nor misses transitions. */
export type MachineState = {
  name: string;
  networkAt: number | null;
  online: boolean | null;
  offlineSince: number | null;
  offlineAlert: number | null;
  offlineAnnounced: boolean;
  healthAt: number | null;
  bootId: string | null;
  sshAvailable: boolean | null;
  disks: Record<string, DiskState>;
  maintenanceUntil: number | null;
};

export function newMachineState(name: string): MachineState {
  return {
    name,
    networkAt: null,
    online: null,
    offlineSince: null,
    offlineAlert: null,
    offlineAnnounced: false,
    healthAt: null,
    bootId: null,
    sshAvailable: null,
    disks: {},
    maintenanceUntil: null,
  };
}

const change = (kind: EventKind, detail: string, notify: boolean): Change => ({
  kind,
  detail,
  notify,
});

/**
 * Advances a machine's state with one round's observations and returns the
 * transitions. `networkAt` is when the tailnet was last read successfully;
 * null means no fresh tailnet data, which never accrues offline time.
 */
export function observe(
  state: MachineState,
  m: Observed,
  networkAt: number | null,
  now: number,
): Change[] {
  const changes: Change[] = [];
  state.name = m.name;
  if (state.maintenanceUntil !== null && state.maintenanceUntil <= now) {
    state.maintenanceUntil = null;
    changes.push(
      change(
        "maintenanceEnded",
        "The one-hour maintenance pause ended. Alerts are active again.",
        false,
      ),
    );
  }
  const muted = state.maintenanceUntil !== null && state.maintenanceUntil > now;
  observeNetwork(state, m, networkAt, muted, changes);
  observeSsh(state, m.connection, changes);
  const health = m.health;
  if (health && !health.stale && (state.healthAt === null || health.asOf > state.healthAt)) {
    state.healthAt = health.asOf;
    if (health.bootId) {
      if (state.bootId !== null && state.bootId !== health.bootId) {
        changes.push(
          change("rebooted", "A different operating-system boot session was observed.", false),
        );
      }
      state.bootId = health.bootId;
    }
    observeDisks(state, health.asOf, health.disks, muted, changes);
  }
  return changes;
}

function observeNetwork(
  state: MachineState,
  m: Observed,
  at: number | null,
  muted: boolean,
  changes: Change[],
) {
  if (
    at !== null &&
    (state.networkAt === null || at > state.networkAt) &&
    m.tailnetOnline !== null
  ) {
    const online = m.tailnetOnline;
    const gap = state.networkAt === null || at - state.networkAt > 60_000;
    state.networkAt = at;
    if (state.online !== null && state.online !== online) {
      changes.push(
        change(
          online ? "online" : "offline",
          online
            ? "The machine is online on the tailnet again."
            : "The machine is offline on the tailnet. An alert follows if it stays offline for three minutes.",
          online && state.offlineAlert !== null && state.offlineAnnounced && !muted,
        ),
      );
    }
    state.online = online;
    if (online) {
      state.offlineSince = null;
      state.offlineAlert = null;
      state.offlineAnnounced = false;
      return;
    }
    if (gap && state.offlineAlert === null) state.offlineSince = null;
    const since = (state.offlineSince ??= at);
    if (at - since >= OFFLINE_DELAY_MS && state.offlineAlert === null) {
      state.offlineAlert = since;
      state.offlineAnnounced = !muted;
      changes.push(
        change(
          "offlineAlert",
          "Offline for at least three minutes across fresh tailnet checks.",
          !muted,
        ),
      );
    } else if (state.offlineAlert !== null && !state.offlineAnnounced && !muted) {
      state.offlineAnnounced = true;
      changes.push(
        change("alertsResumed", "The machine is still offline after maintenance.", true),
      );
    }
  } else if (at === null) {
    // A tailnet outage, a sleeping control machine or stale data can't accrue outage time.
    state.offlineSince = null;
  }
}

function observeSsh(state: MachineState, connection: Connection, changes: Change[]) {
  let available: boolean;
  if (connection.state === "connected") available = true;
  else if (connection.state === "error" || connection.state === "stale") available = false;
  else return;
  if (state.sshAvailable !== null && state.sshAvailable !== available) {
    changes.push(
      available
        ? change("sshRecovered", "SSH health checks are succeeding again.", false)
        : change(
            "sshUnavailable",
            "A current SSH health read is unavailable. Last successful values are retained.",
            false,
          ),
    );
  }
  state.sshAvailable = available;
}

function observeDisks(
  state: MachineState,
  asOf: number,
  disks: DiskStats[],
  muted: boolean,
  changes: Change[],
) {
  for (const disk of disks) {
    if (disk.totalBytes === 0 || disk.availableBytes > disk.totalBytes) continue;
    const d = (state.disks[disk.mountPoint] ??= {
      pendingSince: null,
      activeSince: null,
      announced: false,
      at: null,
      free: 0,
      total: 0,
    });
    if (d.at === null || asOf - d.at > 3 * 60_000) d.pendingSince = null;
    d.at = asOf;
    d.free = disk.availableBytes;
    d.total = disk.totalBytes;
    const percent = freePercent(disk.availableBytes, disk.totalBytes);
    if (percent < LOW_DISK_FREE_PERCENT) {
      const since = (d.pendingSince ??= asOf);
      if (asOf - since >= DISK_DELAY_MS && d.activeSince === null) {
        d.activeSince = since;
        d.announced = !muted;
        changes.push(change("lowDisk", diskDetail(disk.mountPoint, d.free, d.total), !muted));
      }
    } else {
      d.pendingSince = null;
      if (
        percent >= LOW_DISK_FREE_PERCENT + DISK_RECOVERY_MARGIN_PERCENT &&
        d.activeSince !== null
      ) {
        d.activeSince = null;
        changes.push(
          change(
            "diskRecovered",
            `Disk space recovered. ${diskDetail(disk.mountPoint, d.free, d.total)}`,
            d.announced && !muted,
          ),
        );
        d.announced = false;
      }
    }
    if (d.activeSince !== null && !d.announced && !muted) {
      d.announced = true;
      changes.push(
        change(
          "alertsResumed",
          `Disk space is still low after maintenance. ${diskDetail(disk.mountPoint, d.free, d.total)}`,
          true,
        ),
      );
    }
  }
}

/** The machine's active alerts: at most one offline and one low-disk alert. */
export function alerts(
  state: MachineState,
  machineId: string,
  m: Observed,
  networkFresh: boolean,
  now: number,
): Alert[] {
  const muted = state.maintenanceUntil !== null && state.maintenanceUntil > now;
  const out: Alert[] = [];
  if (state.offlineAlert !== null) {
    out.push({
      id: `${machineId}:offline`,
      machineId,
      machineName: m.name,
      kind: "offline",
      since: state.offlineAlert,
      detail: "Offline for at least three minutes.",
      stale: !networkFresh || m.tailnetOnline === null,
      muted,
    });
  }
  // One disk alert per machine. Equal capacity readings (such as macOS System
  // and Data volumes) share a detail line.
  const groups = new Map<string, { free: number; total: number; mounts: string[] }>();
  let since: number | null = null;
  let stale = false;
  for (const [mount, d] of Object.entries(state.disks).sort(([a], [b]) => a.localeCompare(b))) {
    if (d.activeSince === null) continue;
    const health = m.health;
    stale ||=
      !health ||
      health.stale ||
      !health.disks.some((x) => x.mountPoint === mount) ||
      d.at !== health.asOf;
    since = since === null ? d.activeSince : Math.min(since, d.activeSince);
    const key = `${d.free}:${d.total}`;
    const group = groups.get(key) ?? { free: d.free, total: d.total, mounts: [] };
    group.mounts.push(mount);
    groups.set(key, group);
  }
  if (since !== null) {
    out.push({
      id: `${machineId}:disk`,
      machineId,
      machineName: m.name,
      kind: "lowDisk",
      since,
      // Ordered by capacity reading, as aarondfrancis/fleet does, so the tightest disk comes first.
      detail: [...groups.values()]
        .sort((a, b) => a.free - b.free || a.total - b.total)
        .map((g) => diskDetail(g.mounts.join(", "), g.free, g.total))
        .join("\n"),
      stale,
      muted,
    });
  }
  return out;
}

function diskDetail(mount: string, free: number, total: number) {
  return `${mount}: ${freePercent(free, total).toFixed(1)}% free (${gib(free).toFixed(1)} GiB of ${gib(total).toFixed(1)} GiB).`;
}
