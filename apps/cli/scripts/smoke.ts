/**
 * Starts dist/runyard against a throwaway data directory on a free port and
 * checks that the API and the embedded dashboard answer. Stops only the
 * process it started.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve(import.meta.dir, "../dist/runyard");
const dataDir = await mkdtemp(join(tmpdir(), "runyard-smoke-"));
const port = Bun.serve({ port: 0, fetch: () => new Response() });
const { port: free } = port;
await port.stop();

const child = Bun.spawn([binary], {
  // CI never calls the real Tailscale CLI: the listener is off and the CLI path
  // points nowhere, which also proves Runyard keeps serving without Tailscale.
  env: {
    ...process.env,
    RUNYARD_DATA_DIR: dataDir,
    RUNYARD_PORT: String(free),
    RUNYARD_TAILNET: "off",
    RUNYARD_WEBHOOKS: "off",
    RUNYARD_TAILSCALE: join(dataDir, "no-tailscale"),
  },
  stdout: "inherit",
  stderr: "inherit",
});

try {
  const base = `http://127.0.0.1:${free}`;
  const health = await waitFor(`${base}/api/health`);
  const { ok } = (await health.json()) as { ok: boolean };
  if (!ok) throw new Error("/api/health did not report ok.");
  const page = await fetch(`${base}/machines/example`);
  if (!(await page.text()).includes('<div id="root">'))
    throw new Error("The dashboard was not served.");
  console.log("Smoke test passed.");
} finally {
  child.kill();
  await child.exited;
  await rm(dataDir, { recursive: true, force: true });
}

async function waitFor(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error(`runyard exited with code ${child.exitCode}.`);
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(250);
  }
  throw new Error(`${url} did not answer within 10 seconds.`);
}
