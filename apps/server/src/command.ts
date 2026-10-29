/** The result of an external command. A timeout or spawn failure is a non-zero `code`. */
export type CommandResult = { code: number; stdout: string; stderr: string };

export type CommandOptions = {
  stdin?: string;
  timeoutMs?: number;
  /** Receives stdout and stderr as they arrive, in arrival order, like a terminal. */
  onOutput?: (chunk: string) => void;
};

/**
 * Runs external programs (`tailscale`, and later `ssh`). Everything that
 * reaches outside the process goes through one of these, so tests substitute
 * a fake and never touch real machines or tailnets.
 */
export type CommandRunner = (
  argv: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

/** Reads a stream to its end, handing each decoded chunk to `each` as it arrives. */
async function drain(stream: ReadableStream<Uint8Array>, each?: (chunk: string) => void) {
  const decoder = new TextDecoder();
  let all = "";
  for await (const bytes of stream) {
    const chunk = decoder.decode(bytes, { stream: true });
    all += chunk;
    if (chunk) each?.(chunk);
  }
  const rest = decoder.decode();
  if (rest) each?.(rest);
  return all + rest;
}

export const runCommand: CommandRunner = async (
  argv,
  { stdin, timeoutMs = 30_000, onOutput } = {},
) => {
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
      drain(proc.stdout, onOutput),
      drain(proc.stderr, onOutput),
      proc.exited,
    ]);
    return { code: proc.signalCode ? 124 : code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};
