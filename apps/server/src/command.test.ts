import { expect, test } from "bun:test";
import { runCommand } from "./command.ts";

test("commands see variables Runyard sets while running, such as TAILSCALE_BE_CLI", async () => {
  process.env.RUNYARD_TEST_RUNTIME_VAR = "seen";
  try {
    const res = await runCommand(["sh", "-c", 'printf %s "$RUNYARD_TEST_RUNTIME_VAR"']);
    expect(res.stdout).toBe("seen");
  } finally {
    delete process.env.RUNYARD_TEST_RUNTIME_VAR;
  }
});

test("output arrives as it's written, from both streams in order, before the command ends", async () => {
  const seen: { chunk: string; at: number }[] = [];
  const start = Date.now();
  const res = await runCommand(
    ["sh", "-c", "echo one; sleep 0.3; echo two >&2; sleep 0.3; echo three"],
    {
      onOutput: (chunk) => seen.push({ chunk, at: Date.now() - start }),
    },
  );
  expect(seen.map((s) => s.chunk).join("")).toBe("one\ntwo\nthree\n");
  // "one" arrived well before the command finished.
  expect(seen[0]!.at).toBeLessThan(250);
  expect(res.stdout).toBe("one\nthree\n");
  expect(res.stderr).toBe("two\n");
});
