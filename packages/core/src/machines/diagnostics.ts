import {
  freePercent,
  gib,
  LOW_DISK_FREE_PERCENT,
  type Diagnostic,
  type DiagnosticGroup,
  type DiagnosticStatus,
  type MachineReport,
} from "./model.ts";

/**
 * Interprets a report's configuration facts, without network calls or
 * changes to the machine. Ported from aarondfrancis/fleet's `machine_diagnostics`; runner
 * checks arrive with runner management.
 */
export function evaluateDiagnostics(report: MachineReport): Diagnostic[] {
  const checks = new Checks(report);
  checks.tailscale();
  if (report.os === "macos" || report.os === "windows") checks.powerMacWindows();
  else if (report.os === "linux") checks.powerLinux();
  else {
    checks.add(
      "power-sleep",
      "power",
      "System sleep",
      "unknown",
      "Unsupported platform",
      "No native power-policy collector is available for this operating system.",
    );
  }
  checks.system();
  return checks.list;
}

class Checks {
  readonly list: Diagnostic[] = [];

  constructor(private readonly report: MachineReport) {}

  /** A collected fact; empty values count as unread. */
  get(key: string): string | null {
    return this.report.diagnostics[key] || null;
  }

  add(
    id: string,
    group: DiagnosticGroup,
    title: string,
    status: DiagnosticStatus,
    value: string,
    detail: string,
  ) {
    this.list.push({ id, group, title, status, value, detail });
  }

  /** `info` with the value when the fact was read, otherwise `unknown`. */
  fact(id: string, group: DiagnosticGroup, title: string, value: string | null, detail: string) {
    this.add(id, group, title, value ? "info" : "unknown", value ?? "Unknown", detail);
  }

  tailscale() {
    const installation = this.get("tailscale_install");
    const variant =
      (
        {
          "cli-daemon": "CLI + daemon",
          cli: "CLI found; daemon unconfirmed",
          "mac-app-store": "GUI · Mac App Store",
          "mac-standalone": "GUI · standalone app",
          windows: "Windows app + service",
        } as Record<string, string>
      )[installation ?? ""] ?? null;
    const cli = this.get("tailscale_cli");
    this.add(
      "tailscale-install",
      "network",
      "Tailscale installation",
      variant ? "info" : "unknown",
      variant ?? "Unknown",
      cli
        ? `CLI: ${cli}. GUI installations can also include a CLI.`
        : "The CLI path could not be read with this SSH account.",
    );
    this.fact(
      "tailscale-version",
      "network",
      "Tailscale version",
      this.get("tailscale_version"),
      "Version reported by the local Tailscale daemon.",
    );
    const backend = this.get("tailscale_backend");
    this.add(
      "tailscale-state",
      "network",
      "Tailscale connection",
      backend === "Running" ? "pass" : backend ? "warn" : "unknown",
      backend ?? "Unknown",
      "Local daemon state from tailscale status.",
    );

    const os = this.report.os;
    const unsupported =
      os === "windows" || installation === "mac-app-store" || installation === "mac-standalone";
    const ssh = this.get("tailscale_ssh");
    const [status, value, detail]: [DiagnosticStatus, string, string] =
      ssh === "true"
        ? [
            "pass",
            "Enabled",
            "The local RunSSH preference is enabled. Tailnet access rules still control who can connect.",
          ]
        : unsupported
          ? [
              "info",
              "Not supported",
              "This Tailscale variant does not host Tailscale SSH. Use the operating system's SSH server over the tailnet.",
            ]
          : ssh === "false"
            ? [
                "info",
                "Disabled",
                "The local RunSSH preference is disabled. Ordinary SSH over Tailscale can still work.",
              ]
            : [
                "unknown",
                "Unknown",
                "The local RunSSH preference could not be read. A configured SSH transport is not proof that Tailscale SSH is enabled.",
              ];
    this.add("tailscale-ssh", "network", "Tailscale SSH", status, value, detail);

    if (os === "windows") {
      const unattended = this.get("tailscale_unattended");
      this.add(
        "tailscale-unattended",
        "network",
        "Tailscale unattended mode",
        unattended === "true" ? "pass" : unattended === "false" ? "warn" : "unknown",
        unattended === "true" ? "Enabled" : unattended === "false" ? "Disabled" : "Unknown",
        "The ForceDaemon preference controls whether Tailscale stays connected after logout.",
      );
    }
    if (os === "linux" || os === "windows") {
      const startup = this.get("tailscale_startup");
      const [s, v]: [DiagnosticStatus, string] =
        startup === "enabled" || startup === "Auto"
          ? ["pass", "Starts at boot"]
          : startup && ["disabled", "masked", "Manual", "Disabled"].includes(startup)
            ? ["warn", "Not automatic"]
            : startup === "enabled-runtime"
              ? ["warn", "Enabled until reboot"]
              : ["unknown", "Unknown"];
      this.add(
        "tailscale-startup",
        "network",
        "Tailscale startup",
        s,
        v,
        `Native service startup: ${startup ?? "not readable"}.`,
      );
    }
  }

  powerMacWindows() {
    const mac = this.report.os === "macos";
    const unit = mac ? "minutes" : "seconds";
    const settings = [
      ["sleep", "Sleep on AC power", true],
      ["displaysleep", "Display off on AC power", false],
    ] as const;
    for (const [key, title, risk] of settings) {
      const n = whole(this.get(`ac_${key}`));
      const [status, value]: [DiagnosticStatus, string] =
        n === 0
          ? [risk ? "pass" : "info", "Never"]
          : n !== null
            ? [risk ? "warn" : "info", `After ${n} ${unit}`]
            : ["unknown", "Unknown"];
      const b = whole(this.get(`battery_${key}`));
      const battery =
        b === null ? "" : b === 0 ? " Battery: never." : ` Battery: after ${b} ${unit}.`;
      const detail = risk
        ? "Automatic sleep interrupts remote access and jobs. This timeout does not cover lid actions or every standby policy."
        : "Display sleep is separate from system sleep; Modern Standby devices may also change connectivity when the display turns off.";
      this.add(`power-${key}`, "power", title, status, value, `${detail}${battery}`);
    }
    if (mac) this.powerMac();
    else this.powerWindows();
  }

  powerMac() {
    const restart = this.get("ac_autorestart");
    this.add(
      "power-recovery",
      "power",
      "Restart after power failure",
      restart === "1" ? "pass" : restart === "0" ? "warn" : "unknown",
      restart === "1" ? "Enabled" : restart === "0" ? "Disabled" : "Unknown",
      "AC autorestart setting from pmset. Availability depends on the Mac model.",
    );
    const womp = this.get("ac_womp");
    this.add(
      "power-wake",
      "power",
      "Wake for network access",
      womp === "1" || womp === "0" ? "info" : "unknown",
      womp === "1" ? "Enabled" : womp === "0" ? "Disabled" : "Unknown",
      "Wake-on-network setting from pmset. This does not guarantee wake through Tailscale.",
    );
  }

  powerWindows() {
    const seconds = whole(this.get("ac_hibernate"));
    this.add(
      "power-hibernate",
      "power",
      "Hibernate on AC power",
      seconds === 0 ? "pass" : seconds !== null ? "warn" : "unknown",
      seconds === 0 ? "Never" : seconds !== null ? `After ${seconds} seconds` : "Unknown",
      "Active power plan hibernation timeout.",
    );
    const lid = (
      { "0": "Do nothing", "1": "Sleep", "2": "Hibernate", "3": "Shut down" } as Record<
        string,
        string
      >
    )[this.get("ac_lid") ?? ""];
    this.add(
      "power-lid",
      "power",
      "Lid close on AC power",
      lid ? "info" : "unknown",
      lid ?? "Unknown / unavailable",
      "Active power plan policy, applicable only to devices with a lid.",
    );
    const network = (
      { "0": "Disabled", "1": "Enabled", "2": "Managed by Windows" } as Record<string, string>
    )[this.get("ac_standby_network") ?? ""];
    this.add(
      "power-standby-network",
      "power",
      "Network during standby",
      network ? "info" : "unknown",
      network ?? "Unknown / unavailable",
      "AC power plan preference. Hardware support and group policy may override it; this does not prove connectivity during Modern Standby.",
    );
  }

  powerLinux() {
    const targets = ["sleep", "suspend", "hibernate", "hybrid-sleep", "suspend-then-hibernate"];
    const target = (t: string) => this.get(`target_${t}`);
    const blocked =
      target("sleep") === "masked" || targets.slice(1).every((t) => target(t) === "masked");
    const detail = targets.map((t) => `${t}: ${target(t) ?? "unknown"}`).join("; ");
    this.add(
      "power-sleep",
      "power",
      "System sleep protection",
      blocked ? "pass" : "unknown",
      blocked ? "Blocked by systemd" : "Not confirmed disabled",
      `${detail}. Unmasked targets do not prove automatic sleep is enabled; desktop and logind policies can differ.`,
    );
    const idle = this.get("idle_action");
    const sleepy = ["suspend", "hibernate", "hybrid-sleep", "suspend-then-hibernate", "poweroff"];
    this.add(
      "power-idle",
      "power",
      "Logind idle action",
      idle === "ignore"
        ? "pass"
        : idle && sleepy.includes(idle) && !blocked
          ? "warn"
          : idle
            ? "info"
            : "unknown",
      idle ?? "Unknown",
      "Configuration on disk, including drop-ins. A desktop environment can have a separate policy; changes may need a service reload.",
    );
  }

  system() {
    this.fact(
      "ssh-identity",
      "system",
      "SSH account",
      this.get("identity"),
      "Account used for this read-only inspection.",
    );
    this.fact(
      "architecture",
      "system",
      "Architecture",
      this.get("architecture"),
      "Architecture reported by the operating system.",
    );
    const { disks } = this.report;
    if (disks.length === 0) {
      this.add(
        "disk-space",
        "system",
        "Disk space",
        "unknown",
        "Unknown",
        "Filesystem capacity could not be read.",
      );
      return;
    }
    const low = disks.some(
      (d) => freePercent(d.availableBytes, d.totalBytes) < LOW_DISK_FREE_PERCENT,
    );
    this.add(
      "disk-space",
      "system",
      "Disk space",
      low ? "warn" : "pass",
      low ? `Less than ${LOW_DISK_FREE_PERCENT}% free` : `At least ${LOW_DISK_FREE_PERCENT}% free`,
      disks
        .map(
          (d) =>
            `${d.mountPoint}: ${gib(d.availableBytes).toFixed(1)} GiB free of ${gib(d.totalBytes).toFixed(1)} GiB`,
        )
        .join("; "),
    );
  }
}

/** A non-negative whole number, or null. */
function whole(value: string | null): number | null {
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}
