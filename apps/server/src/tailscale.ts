import { parseTailnetStatus, type TailnetSnapshot } from "@runyard/core";
import type { CommandRunner } from "./command.ts";

export type TailscaleSelf = {
  /** The machine's MagicDNS name without the trailing dot, e.g. `box.tail1234.ts.net`. */
  dnsName: string;
  ips: string[];
  /** Whether the tailnet can issue HTTPS certificates for `dnsName`. */
  canCert: boolean;
};

/** The Tailscale CLI, which talks to whichever daemon is installed (app, standalone or tailscaled). */
export class TailscaleCli {
  constructor(
    private readonly run: CommandRunner,
    private readonly binary = process.env.RUNYARD_TAILSCALE ?? "tailscale",
  ) {}

  /** This machine on the tailnet, or an Error saying why it isn't usable. */
  async self(): Promise<TailscaleSelf | Error> {
    const res = await this.run([this.binary, "status", "--json", "--peers=false"], {
      timeoutMs: 10_000,
    });
    if (res.code === 127) return notInstalled();
    if (res.code !== 0)
      return new Error(`tailscale status failed: ${res.stderr.trim() || `exit ${res.code}`}`);
    return parseSelf(res.stdout);
  }

  /** Every peer on the tailnet, or an Error saying why it can't be read. */
  async status(): Promise<TailnetSnapshot | Error> {
    const res = await this.run([this.binary, "status", "--json"], { timeoutMs: 10_000 });
    if (res.code === 124)
      return new Error(
        "The Tailscale CLI didn't respond within 10 seconds. Check that Tailscale is running.",
      );
    if (res.code === 127) return notInstalled();
    if (res.code !== 0)
      return new Error(res.stderr.trim() || `tailscale status failed (exit ${res.code}).`);
    return parseTailnetStatus(res.stdout);
  }

  /** The Tailscale login behind a tailnet address; null for tagged devices or unknown addresses. */
  async whois(ip: string): Promise<string | null> {
    const res = await this.run([this.binary, "whois", "--json", ip], { timeoutMs: 5_000 });
    if (res.code !== 0) return null;
    return parseWhois(res.stdout);
  }

  /** Writes the machine's certificate and key, renewing through the daemon when near expiry. */
  async cert(dnsName: string, certFile: string, keyFile: string): Promise<Error | undefined> {
    const res = await this.run(
      [this.binary, "cert", "--cert-file", certFile, "--key-file", keyFile, dnsName],
      {
        timeoutMs: 120_000,
      },
    );
    if (res.code !== 0)
      return new Error(`tailscale cert failed: ${res.stderr.trim() || `exit ${res.code}`}`);
    return undefined;
  }
}

/** The CLI couldn't be started at all: Tailscale is optional, so say so plainly. */
function notInstalled(): Error {
  return new Error(
    "Tailscale isn't installed here (or RUNYARD_TAILSCALE points somewhere else). It's optional: it adds tailnet discovery, Tailscale SSH and the tailnet address.",
  );
}

/** The CLI can print plain-text warnings instead of JSON; those parse to undefined. */
function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function parseSelf(json: string): TailscaleSelf | Error {
  const status = parseJson<{
    BackendState?: string;
    Self?: { DNSName?: string; TailscaleIPs?: string[] };
    CertDomains?: string[] | null;
  }>(json);
  if (!status) {
    return new Error(
      `tailscale status printed something other than JSON: ${json.trim().slice(0, 160)}`,
    );
  }
  if (status.BackendState !== "Running") {
    return new Error(`Tailscale isn't connected (state ${status.BackendState ?? "unknown"}).`);
  }
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "") ?? "";
  if (!dnsName)
    return new Error("Tailscale has no MagicDNS name for this machine. Turn on MagicDNS.");
  return {
    dnsName,
    ips: status.Self?.TailscaleIPs ?? [],
    canCert: (status.CertDomains ?? []).includes(dnsName),
  };
}

export function parseWhois(json: string): string | null {
  const whois = parseJson<{ Node?: { Tags?: string[] }; UserProfile?: { LoginName?: string } }>(
    json,
  );
  // A tagged device belongs to no person, even though whois reports a placeholder profile.
  if (!whois || whois.Node?.Tags?.length) return null;
  return whois.UserProfile?.LoginName?.toLowerCase() || null;
}

/** Caches whois answers per address so each request doesn't spawn the CLI. */
export class WhoisCache {
  private entries = new Map<string, { login: string | null; expires: number }>();

  constructor(
    private readonly lookup: (ip: string) => Promise<string | null>,
    private readonly ttlMs = 60_000,
  ) {}

  async login(ip: string, now = Date.now()): Promise<string | null> {
    const hit = this.entries.get(ip);
    if (hit && hit.expires > now) return hit.login;
    const login = await this.lookup(ip);
    if (this.entries.size > 1000) this.entries.clear();
    this.entries.set(ip, { login, expires: now + this.ttlMs });
    return login;
  }
}
