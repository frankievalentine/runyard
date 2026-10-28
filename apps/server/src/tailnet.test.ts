import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult } from "./command.ts";
import { TailnetListener } from "./tailnet.ts";
import { TailscaleCli } from "./tailscale.ts";

let dir: string | undefined;
afterEach(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

async function listener(status: object, cert: CommandResult = { code: 0, stdout: "", stderr: "" }) {
  dir = await mkdtemp(join(tmpdir(), "runyard-tailnet-"));
  const logs: string[] = [];
  const cli = new TailscaleCli(async (argv) =>
    argv[1] === "status" ? { code: 0, stdout: JSON.stringify(status), stderr: "" } : cert,
  );
  const tailnet = new TailnetListener({
    tailscale: cli,
    dataDir: dir,
    port: 0,
    fetch: () => new Response(),
    log: (m) => logs.push(m),
  });
  return { tailnet, logs };
}

test("stays on loopback and logs once while Tailscale is down", async () => {
  const { tailnet, logs } = await listener({ BackendState: "Stopped" });
  await tailnet.check();
  await tailnet.check();
  expect(tailnet.url).toBeUndefined();
  expect(logs).toEqual(["Tailscale isn't connected (state Stopped). Serving on loopback only."]);
});

test("explains how to enable certificates", async () => {
  const { tailnet, logs } = await listener({
    BackendState: "Running",
    Self: { DNSName: "box.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] },
    CertDomains: [],
  });
  await tailnet.check();
  expect(logs[0]).toContain("Turn on HTTPS Certificates");
});

test("reports a certificate failure", async () => {
  const { tailnet, logs } = await listener(
    {
      BackendState: "Running",
      Self: { DNSName: "box.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] },
      CertDomains: ["box.tail1234.ts.net"],
    },
    { code: 1, stdout: "", stderr: "rate limited" },
  );
  await tailnet.check();
  expect(tailnet.url).toBeUndefined();
  expect(logs).toEqual(["tailscale cert failed: rate limited"]);
});
