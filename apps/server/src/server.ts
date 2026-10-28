import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getConnInfo } from "hono/bun";
import { createApp, type AppDeps } from "./app.ts";
import type { TailnetLogin } from "./auth/identity.ts";
import { Challenges } from "./auth/passkeys.ts";
import { FailureLimiter } from "./auth/rate-limit.ts";
import { pruneSessions } from "./auth/sessions.ts";
import { SetupCode } from "./auth/setup.ts";
import { adminCount } from "./auth/users.ts";
import { runCommand, type CommandRunner } from "./command.ts";
import { dataDir } from "./config.ts";
import type { DashboardAssets } from "./dashboard.ts";
import { openDatabase } from "./db/index.ts";
import { MachineMonitor } from "./machines/monitor.ts";
import { installedPrograms, type SshPrograms } from "./machines/ssh.ts";
import { loadSecretKey, SecretStore } from "./secrets.ts";
import { TailnetListener } from "./tailnet.ts";
import { TailscaleCli, WhoisCache } from "./tailscale.ts";

/**
 * Opens storage, then serves on loopback TCP and, when Tailscale is available,
 * on HTTPS at this machine's tailnet addresses with its `*.ts.net` certificate.
 */
/** Replaces the programs Runyard runs; the demo harness uses it to fake a whole fleet. */
export type StartOverrides = { run?: CommandRunner; programs?: SshPrograms };

export async function start(dashboard?: DashboardAssets, overrides: StartOverrides = {}) {
  const run = overrides.run ?? runCommand;
  const dir = dataDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const db = openDatabase(join(dir, "runyard.db"));
  const secrets = await SecretStore.open(db, await loadSecretKey(process.env, dir));

  const setup = new SetupCode((code) => {
    console.log(
      `\nNo admin yet. Open the dashboard and enter this setup code to create one:\n\n    ${code}\n`,
    );
  });
  const tailscale = new TailscaleCli(run);
  const whois = new WhoisCache((ip) => tailscale.whois(ip));
  const tailnetLogin: TailnetLogin = async (c) => {
    const address = getConnInfo(c).remote.address?.replace(/^::ffff:/, "");
    return address ? whois.login(address) : null;
  };
  const monitor = new MachineMonitor({
    db,
    run,
    programs: overrides.programs ?? installedPrograms(),
    tailscale,
  });
  monitor.start();
  const shared = {
    db,
    setup,
    limiter: new FailureLimiter(10, 15 * 60 * 1000),
    challenges: new Challenges(),
    tailnetLogin,
    monitor,
  };
  const deps = (listener: AppDeps["listener"]): AppDeps => ({ ...shared, listener });

  pruneSessions(db);
  setInterval(() => pruneSessions(db), 60 * 60 * 1000).unref();

  const hostname = process.env.RUNYARD_HOST ?? "127.0.0.1";
  const port = Number(process.env.RUNYARD_PORT ?? 7420);
  const server = Bun.serve({ hostname, port, fetch: createApp(deps("tcp"), dashboard).fetch });
  console.log(`runyard listening on ${server.url.href} (data in ${dir})`);

  let tailnet: TailnetListener | undefined;
  if (process.env.RUNYARD_TAILNET !== "off") {
    tailnet = new TailnetListener({
      tailscale,
      dataDir: dir,
      port: Number(process.env.RUNYARD_TAILNET_PORT ?? 7443),
      fetch: createApp(deps("tailnet"), dashboard).fetch,
      log: (message) => console.log(message),
    });
    await tailnet.start();
  }
  if (adminCount(db) === 0) setup.issue();

  return { server, tailnet, db, secrets, monitor };
}
