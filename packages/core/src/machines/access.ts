import type { MachineView } from "./derive.ts";
import type { OsFamily } from "./model.ts";
import type { SshProblem } from "./monitoring.ts";

export type AccessStepId = "sshServer" | "hostKey" | "authorize" | "connected";
export type AccessStepState = "done" | "current" | "todo";

/** A command to run, and where: on the machine or on the one running Runyard. */
export type AccessCommand = { label: string; text: string };

export type AccessStep = {
  id: AccessStepId;
  title: string;
  state: AccessStepState;
  detail: string;
  /** What ssh itself said when this step failed, shown small to copy. */
  output?: string;
  commands: AccessCommand[];
};

/** Where in the steps each problem leaves off: SSH checks the host key before the login. */
const REACHED: Record<SshProblem, AccessStepId> = {
  connectionRefused: "sshServer",
  unreachable: "sshServer",
  timeout: "sshServer",
  noProgram: "sshServer",
  other: "sshServer",
  hostKeyUnknown: "hostKey",
  hostKeyChanged: "hostKey",
  loginRefused: "authorize",
};

/** The user Runyard signs in as, when the target names one. */
export function sshUser(target: string): string | null {
  const at = target.lastIndexOf("@");
  return at > 0 ? target.slice(0, at) : null;
}

/**
 * The steps that get Runyard into a machine over SSH, in the order SSH
 * meets them, with where the last check left off and the commands for the
 * step that's failing. Every step is done once a check has succeeded. The
 * dashboard's machine panel and the Getting started checklist both read
 * these. No I/O.
 */
export function accessSteps(m: MachineView, publicKey: string | null): AccessStep[] {
  const tailscale = m.transport === "tailscale";
  const ids: AccessStepId[] = tailscale
    ? ["sshServer", "authorize", "connected"]
    : ["sshServer", "hostKey", "authorize", "connected"];
  const c = m.connection;
  const everConnected = m.health !== null || c.state === "connected";
  const problem: SshProblem | null =
    c.state === "offline"
      ? "unreachable"
      : c.state === "error" || c.state === "stale"
        ? (c.problem ?? "other")
        : null;
  const current: AccessStepId | null = everConnected
    ? null
    : problem
      ? tailscale && REACHED[problem] === "hostKey"
        ? "sshServer"
        : REACHED[problem]
      : null;
  const at = current ? ids.indexOf(current) : -1;
  const state = (id: AccessStepId): AccessStepState => {
    if (everConnected) return "done";
    if (at === -1) return "todo";
    const i = ids.indexOf(id);
    return i < at ? "done" : i === at ? "current" : "todo";
  };
  // An SSH error's first line is Runyard's summary; ssh's own output follows.
  const [error, ...raw] = (
    c.state === "error" ? c.detail : c.state === "stale" ? c.reason : ""
  ).split("\n");
  const output = raw.length ? { output: raw.join("\n") } : {};
  const user = sshUser(m.sshTarget);
  const os = m.os;

  return ids.map((id): AccessStep => {
    const s = state(id);
    const failing = s === "current" && error ? error : null;
    const said = failing ? output : {};
    switch (id) {
      case "sshServer":
        return {
          id,
          title: tailscale ? "Turn on Tailscale SSH" : "Turn on its SSH server",
          state: s,
          detail:
            c.state === "offline"
              ? "Tailscale reports the machine offline. Turn it on or reconnect it to the tailnet."
              : (failing ??
                (tailscale
                  ? "Tailscale SSH answers on the machine itself, with no keys to manage."
                  : "Remote Login on macOS, OpenSSH Server on Linux and Windows.")),
          ...said,
          commands: tailscale
            ? [{ label: "On the machine", text: "tailscale set --ssh" }]
            : serverCommands(os),
        };
      case "hostKey":
        return {
          id,
          title: "Trust its host key",
          state: s,
          detail:
            failing ??
            "So Runyard knows it's talking to this machine. Strict host key checking stays on.",
          ...said,
          commands: [],
        };
      case "authorize":
        return {
          id,
          title: tailscale ? "Allow the sign-in" : "Authorize Runyard's key",
          state: s,
          detail:
            (failing ? `${failing} ` : "") +
            (tailscale
              ? `Your tailnet's SSH access rules must let this machine sign in${user ? ` as ${user}` : ""}.`
              : user
                ? failing
                  ? `Runyard signs in as ${user}.`
                  : `Runyard signs in as ${user}; that account needs Runyard's key.`
                : "Runyard signs in as the user ~/.ssh/config sets for this host. Add user@ to the SSH target to choose one."),
          ...said,
          commands: tailscale || !publicKey ? [] : authorizeCommands(os, publicKey),
        };
      case "connected":
        return {
          id,
          title: "Connected",
          state: s,
          detail: everConnected
            ? "Runyard reads its health every minute."
            : c.state === "pending"
              ? "Checking now…"
              : "Runyard checks again every minute, or use Check now.",
          commands: [],
        };
    }
  });
}

/** The step a machine is stuck on, for the Getting started checklist. Null once it's connected. */
export function nextAccessStep(m: MachineView): AccessStep | null {
  return accessSteps(m, null).find((s) => s.state === "current") ?? null;
}

function serverCommands(os: OsFamily | null): AccessCommand[] {
  const mac = {
    label: "On the Mac",
    text: "sudo systemsetup -setremotelogin on",
  };
  const linux = {
    label: "On Linux (Debian or Ubuntu; use dnf and sshd on Fedora)",
    text: "sudo apt install -y openssh-server && sudo systemctl enable --now ssh",
  };
  const windows = {
    label: "On Windows, in an administrator PowerShell",
    text: "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Start-Service sshd; Set-Service -Name sshd -StartupType Automatic",
  };
  if (os === "macos") return [mac];
  if (os === "linux") return [linux];
  if (os === "windows") return [windows];
  return [mac, linux, windows];
}

function authorizeCommands(os: OsFamily | null, key: string): AccessCommand[] {
  // The commands single-quote the key; a line with a quote of its own isn't one to paste.
  if (key.includes("'")) return [];
  const posix = {
    label: os === "macos" ? "On the Mac, as that user" : "On the machine, as that user",
    text: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${key}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
  };
  const windowsAdmin = {
    label: "On Windows, for an administrator account (administrator PowerShell)",
    text: `Add-Content -Path "$env:ProgramData\\ssh\\administrators_authorized_keys" -Value '${key}'; icacls.exe "$env:ProgramData\\ssh\\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"`,
  };
  const windowsUser = {
    label: "On Windows, for a standard account (PowerShell as that user)",
    text: `New-Item -ItemType Directory -Force "$HOME\\.ssh" | Out-Null; Add-Content -Path "$HOME\\.ssh\\authorized_keys" -Value '${key}'`,
  };
  if (os === "windows") return [windowsAdmin, windowsUser];
  if (os === "macos" || os === "linux") return [posix];
  return [posix, windowsAdmin, windowsUser];
}
