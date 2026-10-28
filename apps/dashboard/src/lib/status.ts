import type { Connection, DiagnosticStatus, EventKind, MachineView } from "@runyard/core";

/** Status color families shared by dots, pills and stats. */
export type Tone = "busy" | "ok" | "warn" | "bad" | "muted" | "info";

export type StatusLabel = { tone: Tone; label: string; hollow?: boolean };

/** Ported from fleet: a hollow dot means old or unknown data. */
export function connectionStatus(c: Connection): StatusLabel {
  switch (c.state) {
    case "connected":
      return { tone: "ok", label: "Connected" };
    case "stale":
      return { tone: "warn", label: "Stale", hollow: true };
    case "offline":
      return { tone: "muted", label: "Offline" };
    case "error":
      return { tone: "bad", label: "Error" };
    case "pending":
      return { tone: "muted", label: "Checking…", hollow: true };
  }
}

/** A machine's dot in lists: alerts first, then its connection. */
export function machineStatus(m: MachineView): StatusLabel {
  if (m.alerts.some((a) => !a.stale)) {
    const offline = m.alerts.some((a) => a.kind === "offline");
    return { tone: offline ? "bad" : "warn", label: offline ? "Offline alert" : "Low disk space" };
  }
  return connectionStatus(m.connection);
}

export const diagnosticTone: Record<DiagnosticStatus, { label: string; tone: Tone }> = {
  pass: { label: "OK", tone: "ok" },
  warn: { label: "Warning", tone: "warn" },
  info: { label: "Info", tone: "muted" },
  unknown: { label: "Unknown", tone: "muted" },
};

/** Current diagnostics warnings, ignoring stale reads. */
export function diagnosticWarnings(m: MachineView): number {
  return m.diagnostics && !m.diagnostics.stale
    ? m.diagnostics.checks.filter((c) => c.status === "warn").length
    : 0;
}

export const eventStyle: Record<EventKind, { label: string; tone: Tone }> = {
  monitoringStarted: { label: "Monitoring started", tone: "info" },
  targetChanged: { label: "SSH target changed", tone: "info" },
  online: { label: "Online", tone: "ok" },
  offline: { label: "Offline", tone: "muted" },
  sshUnavailable: { label: "SSH unavailable", tone: "warn" },
  sshRecovered: { label: "SSH recovered", tone: "ok" },
  rebooted: { label: "Rebooted", tone: "info" },
  offlineAlert: { label: "Offline alert", tone: "bad" },
  lowDisk: { label: "Low disk space", tone: "warn" },
  diskRecovered: { label: "Disk space recovered", tone: "ok" },
  maintenanceStarted: { label: "Maintenance started", tone: "muted" },
  maintenanceEnded: { label: "Maintenance ended", tone: "muted" },
  alertsResumed: { label: "Alerts resumed", tone: "warn" },
};

export const osLabel: Record<string, string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
  other: "Other",
};

/** Short right-aligned sidebar summary for a machine row. Runner counts join this with runners. */
export function machineSummary(m: MachineView): string {
  if (m.alerts.some((a) => a.kind === "lowDisk" && !a.stale)) return "Low disk";
  return connectionStatus(m.connection).label;
}

/** Hover text for a machine: its name and description. */
export function machineTooltip(m: MachineView): string {
  return [m.name, m.description].filter(Boolean).join("\n");
}

/** Ported from fleet: warnings and unknowns, or why there's nothing to say. */
export function diagnosticSummary(m: MachineView): string {
  const d = m.diagnostics;
  if (!d) return "Not checked";
  if (d.stale) return "Stale";
  const warnings = d.checks.filter((c) => c.status === "warn").length;
  const unknown = d.checks.filter((c) => c.status === "unknown").length;
  return (
    [
      warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : null,
      unknown ? `${unknown} unknown` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "No warnings"
  );
}

/** The OS line under a machine's name: macOS reports a bare version, so it gets its name. */
export function osLine(m: MachineView): string | null {
  const version = m.health?.osVersion;
  if (version) return m.os === "macos" && /^\d/.test(version) ? `macOS ${version}` : version;
  return m.os ? osLabel[m.os] : null;
}
