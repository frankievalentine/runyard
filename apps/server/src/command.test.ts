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
