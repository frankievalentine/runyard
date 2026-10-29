/** The result of an external command. A timeout or spawn failure is a non-zero `code`. */
export type CommandResult = { code: number; stdout: string; stderr: string };

export type CommandOptions = { stdin?: string; timeoutMs?: number };

/**
 * Runs external programs (`tailscale`, and later `ssh`). Everything that
 * reaches outside the process goes through one of these, so tests substitute
 * a fake and never touch real machines or tailnets.
 */
export type CommandRunner = (
  argv: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export const runCommand: CommandRunner = async (argv, { stdin, timeoutMs = 30_000 } = {}) => {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    // Passed explicitly: Bun.spawn's default environment misses variables set at runtime,
    // such as TAILSCALE_BE_CLI, which the macOS Tailscale app needs without a terminal.
    proc = Bun.spawn([...argv], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });
  } catch (error) {
    return {
      code: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
  if (stdin !== undefined) await proc.stdin.write(stdin);
  await proc.stdin.end();
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code: proc.signalCode ? 124 : code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};
