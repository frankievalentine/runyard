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
      "Runyard can't read power settings on this operating system.",
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
    command?: string,
  ) {
    this.list.push({ id, group, title, status, value, detail, ...(command ? { command } : {}) });
  }

  /** `info` with the value when the fact was read, otherwise `unknown`. */
  fact(id: string, group: DiagnosticGroup, title: string, value: string | null, detail: string) {
    this.add(id, group, title, value ? "info" : "unknown", value ?? "Unknown", detail);
  }

  tailscale() {
    const backend = this.get("tailscale_backend");
    this.add(
      "tailscale-state",
      "network",
      "Tailscale connection",
      backend === "Running" ? "pass" : backend ? "warn" : "unknown",
      backend ?? "Unknown",
      backend && backend !== "Running" ? "Start Tailscale on the machine." : "",
    );
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
      cli ? `CLI at ${cli}.` : "Couldn't find its CLI with this SSH account.",
    );
    this.fact(
      "tailscale-version",
      "network",
      "Tailscale version",
      this.get("tailscale_version"),
      "",
    );

    const os = this.report.os;
    const unsupported =
      os === "windows" || installation === "mac-app-store" || installation === "mac-standalone";
    const ssh = this.get("tailscale_ssh");
    const [status, value, detail]: [DiagnosticStatus, string, string] =
      ssh === "true"
        ? ["pass", "Enabled", "Your tailnet's access rules decide who can connect."]
        : unsupported
          ? [
              "info",
              "Not supported",
              "This Tailscale app can't host SSH. Use OpenSSH over the tailnet.",
            ]
          : ssh === "false"
            ? ["info", "Disabled", "OpenSSH over the tailnet still works."]
            : ["unknown", "Unknown", "Couldn't read this setting."];
    this.add("tailscale-ssh", "network", "Tailscale SSH", status, value, detail);

    if (os === "windows") {
      const unattended = this.get("tailscale_unattended");
      this.add(
        "tailscale-unattended",
        "network",
        "Tailscale unattended mode",
        unattended === "true" ? "pass" : unattended === "false" ? "warn" : "unknown",
        unattended === "true" ? "Enabled" : unattended === "false" ? "Disabled" : "Unknown",
        unattended === "false"
          ? "Tailscale disconnects when you sign out. Turn on Run unattended in Tailscale."
          : "Keeps Tailscale connected after you sign out.",
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
        `Service startup: ${startup ?? "unknown"}.`,
      );
    }
  }

  powerMacWindows() {
    const mac = this.report.os === "macos";
    const after = (n: number) =>
      mac ? `after ${plural(n, "minute")}` : `after ${plural(n, "second")}`;
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
            ? [risk ? "warn" : "info", capitalize(after(n))]
            : ["unknown", "Unknown"];
      const b = whole(this.get(`battery_${key}`));
      const battery = b === null ? "" : b === 0 ? " Battery: never." : ` Battery: ${after(b)}.`;
      const detail = risk
        ? "Sleep interrupts jobs and remote access."
        : mac
          ? "Separate from system sleep."
          : "On Modern Standby devices, display off can drop the network.";
      this.add(`power-${key}`, "power", title, status, value, `${detail}${battery}`);
    }
    if (mac) this.powerMac();
    else this.powerWindows();
  }

  powerMac() {
    const autoLogin = this.get("auto_login_user");
    this.add(
      "login-auto",
      "power",
      "Automatic login",
      "info",
      autoLogin ? `As ${autoLogin}` : "Off",
      "Runners run only while their user is logged in. Automatic login brings them back after a restart.",
    );
    const restart = this.get("ac_autorestart");
    this.add(
      "power-recovery",
      "power",
      "Restart after power failure",
      restart === "1" ? "pass" : restart === "0" ? "warn" : "unknown",
      restart === "1" ? "Enabled" : restart === "0" ? "Disabled" : "Unknown",
      restart === "0" ? "The Mac stays off after a power outage." : "Not every Mac supports it.",
    );
    const womp = this.get("ac_womp");
    this.add(
      "power-wake",
      "power",
      "Wake for network access",
      womp === "1" || womp === "0" ? "info" : "unknown",
      womp === "1" ? "Enabled" : womp === "0" ? "Disabled" : "Unknown",
      "Doesn't guarantee wake over Tailscale.",
    );
  }

  powerWindows() {
    const seconds = whole(this.get("ac_hibernate"));
    this.add(
      "power-hibernate",
      "power",
      "Hibernate on AC power",
      seconds === 0 ? "pass" : seconds !== null ? "warn" : "unknown",
      seconds === 0
        ? "Never"
        : seconds !== null
          ? `After ${plural(Math.round(seconds / 60), "minute")}`
          : "Unknown",
      "Hibernation stops jobs and remote access.",
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
      "Applies only to laptops.",
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
      "Hardware and group policy can override it.",
    );
  }

  powerLinux() {
    // A container (an LXC, say) doesn't sleep on its own: the machine it runs on decides.
    const container = this.get("container");
    if (container && container !== "none") {
      this.add(
        "power-sleep",
        "power",
        "System sleep",
        "info",
        `Managed by the host (${container} container)`,
        "Keep the host machine awake.",
      );
      return;
    }
    const targets = ["sleep", "suspend", "hibernate", "hybrid-sleep", "suspend-then-hibernate"];
    const target = (t: string) => this.get(`target_${t}`);
    const blocked =
      target("sleep") === "masked" || targets.slice(1).every((t) => target(t) === "masked");
    this.add(
      "power-sleep",
      "power",
      "System sleep",
      blocked ? "pass" : "unknown",
      blocked ? "Disabled" : "Not disabled",
      blocked
        ? "Its sleep targets are masked in systemd."
        : "It may sleep. Masking its sleep targets keeps it awake.",
      blocked
        ? undefined
        : "sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target",
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
      idle && sleepy.includes(idle) && !blocked
        ? "Set IdleAction=ignore in /etc/systemd/logind.conf."
        : "A desktop environment can override it.",
    );
  }

  system() {
    this.fact(
      "ssh-identity",
      "system",
      "SSH account",
      this.get("identity"),
      "Runyard signs in as this account.",
    );
    this.fact("architecture", "system", "Architecture", this.get("architecture"), "");
    const { disks } = this.report;
    if (disks.length === 0) {
      this.add(
        "disk-space",
        "system",
        "Disk space",
        "unknown",
        "Unknown",
        "Couldn't read disk usage.",
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

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
