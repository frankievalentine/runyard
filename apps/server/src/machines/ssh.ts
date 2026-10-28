import { existsSync } from "node:fs";
import type { OsFamily, SshTransport } from "@runyard/core";
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

export type SshPrograms = { ssh: string; tailscale: string };

/** The system's OpenSSH by absolute path where it exists, so PATH can't substitute another binary. */
export function installedPrograms(env: NodeJS.ProcessEnv = process.env): SshPrograms {
  const ssh = env.RUNYARD_SSH ?? (existsSync("/usr/bin/ssh") ? "/usr/bin/ssh" : "ssh");
  return { ssh, tailscale: env.RUNYARD_TAILSCALE ?? "tailscale" };
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
  throw new Error(sshFailure(res.code, res.stderr, machine.transport));
}

function sshFailure(code: number, stderr: string, transport: SshTransport): string {
  const program = transport === "tailscale" ? "tailscale ssh" : "ssh";
  if (code === 124) return `The SSH check didn't finish within ${SSH_TIMEOUT_MS / 1000} seconds.`;
  if (code === 127) return `Couldn't run ${program}: ${stderr.trim() || "not found"}.`;
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.$/, "");
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)) {
    return "The machine's SSH host key isn't trusted on this machine. Connect once with ssh to verify and accept it, then check again.";
  }
  if (/Permission denied/i.test(stderr)) {
    return `SSH refused the login: ${line}. Check the user name and that this machine's key is authorized.`;
  }
  return `${program} failed (exit ${code})${line ? `: ${line}` : "."}`;
}
