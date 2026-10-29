import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlan } from "./apply.ts";

test("a step with retries is tried again until it works, as launchd needs after a bootout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runyard-apply-"));
  const counter = join(dir, "tries");
  // Fails twice, then succeeds: like bootstrap while the old service is still stopping.
  const flaky = `n=$(cat '${counter}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${counter}'; [ $n -ge 3 ]`;
  await applyPlan(
    {
      kind: "launchagent",
      summary: "test",
      files: [],
      commands: [{ argv: ["sh", "-c", flaky], sudo: false, retries: 5 }],
      logs: "",
    },
    { dryRun: false, log: () => {} },
  );
  expect((await Bun.file(counter).text()).trim()).toBe("3");
});
