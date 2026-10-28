import { existsSync } from "node:fs";
import type { OsFamily, SshProblem, SshTransport } from "@runyard/core";
import windowsDiagnostics from "../../scripts/machine-diagnostics.ps1" with { type: "text" };
import posixDiagnostics from "../../scripts/machine-diagnostics.sh" with { type: "text" };
import windowsHealth from "../../scripts/machine-health.ps1" with { type: "text" };
import posixHealth from "../../scripts/machine-health.sh" with { type: "text" };
import type { CommandRunner } from "../command.ts";

/**
 * Added to the user's own OpenSSH configuration on every connection (aarondfrancis/fleet's
 * hardening): never prompt, never trust an unknown host key, never forward
 * anything to the machine.
 */
export const OPENSSH_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ForwardAgent=no",
  "-o",
  "ClearAllForwardings=yes",
] as const;

/** One SSH inspection, connection included. */
export const SSH_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_SECS = 15;

/**
 * Windows reads the script as one base64 line, so nothing waits for stdin EOF
 * through cmd.exe. Elsewhere the script runs with `bash -s` from stdin.
 */
const WINDOWS_COMMAND =
  'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' +
  "$encoded = [Console]::In.ReadLine(); " +
  "$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)); " +
  '& ([ScriptBlock]::Create($source))"';

export type SshPrograms = {
  ssh: string;
  tailscale: string;
  /** Runyard's own key, offered before the user's own keys. */
  identity?: string;
  /** Runyard's known_hosts, checked along with the user's. */
  knownHosts?: string;
  /** Reads host keys without signing in. */
  keyscan?: string;
};

/** OpenSSH options for Runyard's own key and known hosts, when it has them. */
export function runyardOptions(programs: SshPrograms): string[] {
  const out: string[] = [];
  if (programs.identity) out.push("-i", programs.identity);
  if (programs.knownHosts)
    out.push(
      "-o",
      // Quoted: the data directory may contain spaces. The user's own files stay in the list.
      `UserKnownHostsFile="${programs.knownHosts}" ~/.ssh/known_hosts ~/.ssh/known_hosts2`,
    );
  return out;
}

/** The system's OpenSSH by absolute path where it exists, so PATH can't substitute another binary. */
export function installedPrograms(env: NodeJS.ProcessEnv = process.env): SshPrograms {
  const ssh = env.RUNYARD_SSH ?? (existsSync("/usr/bin/ssh") ? "/usr/bin/ssh" : "ssh");
  const keyscan =
    env.RUNYARD_SSH_KEYSCAN ??
    (existsSync("/usr/bin/ssh-keyscan") ? "/usr/bin/ssh-keyscan" : "ssh-keyscan");
  return { ssh, tailscale: env.RUNYARD_TAILSCALE ?? "tailscale", keyscan };
}

/**
 * Rejects SSH targets that could be read as options or carry a second
 * argument. OpenSSH also gets `--` before the target; `tailscale ssh` has no
 * such guard, so this check is what protects it.
 */
export function validateTarget(target: string): string | null {
  if (!target) return "Enter an SSH target, such as user@host.";
  if (target.startsWith("-")) return "An SSH target can't start with a dash.";
  let unsafe = /\s/.test(target);
  for (let i = 0; i < target.length && !unsafe; i++) {
    const code = target.charCodeAt(i);
    unsafe = code < 0x20 || code === 0x7f;
  }
  if (unsafe) return "An SSH target can't contain spaces or control characters.";
  if (target.length > 255) return "That SSH target is too long.";
  return null;
}

/** The read-only health and diagnostics script for a machine's OS. Diagnostics run isolated from health. */
export function inspectionScript(windows: boolean): string {
  return windows
    ? `${windowsHealth}\n& {\n${windowsDiagnostics}\n}\n`
    : `${posixHealth}\n(\n${posixDiagnostics}\n)\n`;
}

export function scriptCommand(
  programs: SshPrograms,
  machine: { sshTarget: string; transport: SshTransport },
  windows: boolean,
  script: string,
): { argv: string[]; stdin: string } {
  const problem = validateTarget(machine.sshTarget);
  if (problem) throw new Error(problem);
  const [remote, stdin] = windows
    ? [WINDOWS_COMMAND, `${Buffer.from(script, "utf8").toString("base64")}\n`]
    : ["bash -s", script];
  const argv =
    machine.transport === "tailscale"
      ? [programs.tailscale, "ssh", machine.sshTarget, remote]
      : [
          programs.ssh,
          ...OPENSSH_OPTIONS,
          ...runyardOptions(programs),
          "-o",
          `ConnectTimeout=${CONNECT_TIMEOUT_SECS}`,
          "--",
          machine.sshTarget,
          remote,
        ];
  return { argv, stdin };
}

/** Runs the inspection over SSH; resolves to stdout or rejects with a sentence for the dashboard. */
export async function inspect(
  run: CommandRunner,
  programs: SshPrograms,
  machine: { sshTarget: string; transport: SshTransport },
  os: OsFamily | null,
): Promise<string> {
  const windows = os === "windows";
  const { argv, stdin } = scriptCommand(programs, machine, windows, inspectionScript(windows));
  const res = await run(argv, { stdin, timeoutMs: SSH_TIMEOUT_MS });
  if (res.code === 0) return res.stdout;
  throw sshFailure(res.code, res.stderr, machine.transport);
}

/** An SSH failure as a sentence for the dashboard, with its kind for the setup steps. */
export class SshError extends Error {
  constructor(
    message: string,
    readonly problem: SshProblem,
  ) {
    super(message);
  }
}

export function sshFailure(code: number, stderr: string, transport: SshTransport): SshError {
  const program = transport === "tailscale" ? "tailscale ssh" : "ssh";
  if (code === 124)
    return new SshError(
      `The SSH check didn't finish within ${SSH_TIMEOUT_MS / 1000} seconds.`,
      "timeout",
    );
  if (code === 127)
    return new SshError(`Couldn't run ${program}: ${stderr.trim() || "not found"}.`, "noProgram");
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.$/, "");
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/i.test(stderr))
    return new SshError(
      "The machine's SSH host key changed since it was trusted. That happens after a reinstall, or if something is intercepting the connection. Check before trusting the new key.",
      "hostKeyChanged",
    );
  if (/Host key verification failed|No \S+ host key is known/i.test(stderr))
    return new SshError(
      "The machine's SSH host key isn't trusted yet. Trust it from the machine's setup steps, then check again.",
      "hostKeyUnknown",
    );
  if (/Permission denied|Too many authentication failures/i.test(stderr))
    return new SshError(
      `SSH refused the login: ${line}. Check the user name and that Runyard's key is authorized.`,
      "loginRefused",
    );
  if (/Connection refused/i.test(stderr))
    return new SshError(
      "The machine refused the connection: its SSH server isn't running, or a firewall blocks it.",
      "connectionRefused",
    );
  if (
    /Could not resolve hostname|No route to host|Network is unreachable|Connection timed out|Operation timed out/i.test(
      stderr,
    )
  )
    return new SshError(
      `Couldn't reach the machine: ${line}. Check its address and that it's on the network.`,
      "unreachable",
    );
  return new SshError(`${program} failed (exit ${code})${line ? `: ${line}` : "."}`, "other");
}
