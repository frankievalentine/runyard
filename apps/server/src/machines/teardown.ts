import type { OsFamily, SshTransport } from "@runyard/core";
import windowsTeardown from "../../scripts/machine-teardown.ps1" with { type: "text" };
import posixTeardown from "../../scripts/machine-teardown.sh" with { type: "text" };
import type { CommandRunner } from "../command.ts";
import { scriptCommand, sshFailure, type SshPrograms } from "./ssh.ts";

const TEARDOWN_TIMEOUT_MS = 2 * 60_000;

/** The teardown script for a machine, with Runyard's public key line filled in. */
export function teardownScript(windows: boolean, keyLine: string): string {
  return (windows ? windowsTeardown : posixTeardown).replaceAll("__RUNYARD_KEY__", keyLine);
}

/**
 * Runs the machine teardown over SSH, as the account Runyard uses: it deletes
 * Runyard's runner folder, then Runyard's key, and refuses while a runner is
 * still configured there. Resolves to what it printed; rejects with a sentence
 * for the dashboard.
 */
export async function tearDown(
  run: CommandRunner,
  programs: SshPrograms,
  machine: { sshTarget: string; transport: SshTransport; runyardKeyOnly?: boolean },
  os: OsFamily,
  keyLine: string,
): Promise<string> {
  const windows = os === "windows";
  const { argv, stdin } = scriptCommand(
    programs,
    machine,
    windows,
    teardownScript(windows, keyLine),
  );
  const res = await run(argv, { stdin, timeoutMs: TEARDOWN_TIMEOUT_MS });
  const output = `${res.stdout}${res.stderr}`.trim();
  if (res.code === 0) return output;
  // 255 is ssh's own failure; anything else is the script refusing, in its own words.
  if (res.code === 255 || res.code === 124 || res.code === 127)
    throw sshFailure(res.code, res.stderr, machine.transport);
  throw new Error(output || `The cleanup failed (exit ${res.code}).`);
}
