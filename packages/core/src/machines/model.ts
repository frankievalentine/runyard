/** Operating systems Runyard distinguishes; `other` covers anything else a machine reports. */
export type OsFamily = "macos" | "linux" | "windows" | "other";

/** How Runyard reaches a machine: the system's OpenSSH, or `tailscale ssh`. */
export type SshTransport = "openssh" | "tailscale";

/** Capacity of an OS or home filesystem (every fixed drive on Windows). */
export type DiskStats = { mountPoint: string; totalBytes: number; availableBytes: number };

/** A successful SSH read. Unreadable metrics are null, never zero. */
export type MachineReport = {
  os: OsFamily;
  osVersion: string | null;
  cpuPercent: number | null;
  loadAverage: [number, number, number] | null;
  logicalCores: number | null;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  uptimeSecs: number | null;
  bootId: string | null;
  disks: DiskStats[];
  /** Selected, non-secret configuration facts; empty when the diagnostics section was incomplete. */
  diagnostics: Record<string, string>;
  warnings: string[];
};

export type DiagnosticStatus = "pass" | "warn" | "info" | "unknown";
export type DiagnosticGroup = "network" | "power" | "system";

export type Diagnostic = {
  id: string;
  group: DiagnosticGroup;
  title: string;
  status: DiagnosticStatus;
  value: string;
  detail: string;
};

/** A tailnet peer as `tailscale status` reports it. */
export type TailnetPeer = {
  nodeId: string;
  hostname: string;
  /** MagicDNS name without the trailing dot. */
  dnsName: string | null;
  /** As Tailscale reports it: `macOS`, `linux`, `windows`, `iOS`... */
  os: string;
  ips: string[];
  online: boolean;
  lastSeen: number | null;
  tags: string[];
  /** Published SSH host keys mean the peer runs Tailscale SSH. */
  sshHostKeys: string[];
};

export type TailnetSnapshot = {
  selfNodeId: string | null;
  tailnetName: string | null;
  peers: TailnetPeer[];
};

/** Free space below this share of a disk is low. */
export const LOW_DISK_FREE_PERCENT = 10;
/** Machine facts older than this are stale. */
export const SSH_STALE_AFTER_MS = 150_000;

export function freePercent(available: number, total: number): number {
  return (100 * available) / Math.max(total, 1);
}

export function gib(bytes: number): number {
  return bytes / 1_073_741_824;
}

export function osFromTailnet(os: string): OsFamily {
  const lower = os.toLowerCase();
  return lower === "macos" || lower === "linux" || lower === "windows" ? lower : "other";
}

/** Desktop and server systems that can host runners; phones and TVs can't. */
export function canHostRunners(peer: TailnetPeer): boolean {
  return ["macos", "linux", "windows", "freebsd", "openbsd"].includes(peer.os.toLowerCase());
}

/** The address Runyard connects to: MagicDNS name, else the first tailnet IP, else the hostname. */
export function peerAddress(peer: TailnetPeer): string {
  return peer.dnsName ?? peer.ips[0] ?? peer.hostname;
}
