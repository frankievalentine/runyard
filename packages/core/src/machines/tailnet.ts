import type { TailnetPeer, TailnetSnapshot } from "./model.ts";

type Node = {
  ID?: string;
  HostName?: string;
  DNSName?: string;
  OS?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  LastSeen?: string;
  Tags?: string[];
  sshHostKeys?: string[];
};

/** Parses `tailscale status --json`, or returns an Error explaining why the tailnet isn't readable. */
export function parseTailnetStatus(json: string): TailnetSnapshot | Error {
  let status: {
    BackendState?: string;
    Self?: Node;
    Peer?: Record<string, Node>;
    CurrentTailnet?: { Name?: string };
  };
  try {
    status = JSON.parse(json) as typeof status;
  } catch {
    return new Error("Unexpected tailscale status output.");
  }
  if (status.BackendState && status.BackendState !== "Running") {
    return new Error(`Tailscale is not connected (state: ${status.BackendState}).`);
  }
  const peers: TailnetPeer[] = Object.values(status.Peer ?? {})
    .filter((n): n is Node & { ID: string } => typeof n.ID === "string")
    .map((n) => {
      const lastSeen = n.LastSeen ? Date.parse(n.LastSeen) : NaN;
      return {
        nodeId: n.ID,
        hostname: n.HostName ?? "",
        dnsName: n.DNSName?.replace(/\.$/, "") || null,
        os: n.OS ?? "",
        ips: n.TailscaleIPs ?? [],
        online: n.Online === true,
        // Tailscale reports "never" as year 1.
        lastSeen: Number.isFinite(lastSeen) && lastSeen > 0 ? lastSeen : null,
        tags: n.Tags ?? [],
        sshHostKeys: n.sshHostKeys ?? [],
      };
    })
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
  return {
    selfNodeId: status.Self?.ID ?? null,
    tailnetName: status.CurrentTailnet?.Name ?? null,
    peers,
  };
}
