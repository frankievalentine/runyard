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
import type { Fetch } from "./github/client.ts";
import { ManifestStates } from "./github/manifest.ts";
import { GithubMonitor } from "./github/monitor.ts";
import { ForgejoMonitor } from "./forgejo/monitor.ts";
import { BoatMonitor } from "./boat/monitor.ts";
import { listAssignments, listMigrations } from "./machines/assignments.ts";
import { MachineMonitor } from "./machines/monitor.ts";
import { Dispatcher } from "./pools/dispatcher.ts";
import { PoolEngine } from "./pools/engine.ts";
import { listDispatches, listPools, listRegistrations, listTemplates } from "./pools/store.ts";
import { ensureRunyardKey, runyardSshPaths, sshKeygenProgram } from "./machines/keys.ts";
import { HostKeys } from "./machines/host-keys.ts";
import { MachineSetupCodes } from "./machines/setup-codes.ts";
import { installedPrograms, type SshPrograms } from "./machines/ssh.ts";
import { loadSecretKey, SecretStore } from "./secrets.ts";
import { setupChecks, type TailnetState } from "./setup/checks.ts";
import { TailnetListener } from "./tailnet.ts";
import { WebhookReceiver } from "./webhooks/receiver.ts";
import { TailscaleCli, WhoisCache } from "./tailscale.ts";

/**
 * Opens storage, then serves on loopback TCP and, when Tailscale is available,
 * on HTTPS at this machine's tailnet addresses with its `*.ts.net` certificate.
 */
/** Replaces the programs Runyard runs; the demo harness uses it to fake a whole yard. */
export type StartOverrides = {
  run?: CommandRunner;
  programs?: SshPrograms;
  /** GitHub's API and web, for the demo's fictional GitHub. */
  fetch?: Fetch;
  githubApiBase?: string;
  githubWebBase?: string;
};

export async function start(dashboard?: DashboardAssets, overrides: StartOverrides = {}) {
  const run = overrides.run ?? runCommand;
  const dir = dataDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const db = openDatabase(join(dir, "runyard.db"));
  const secrets = await SecretStore.open(db, await loadSecretKey(process.env, dir));
  const sshPaths = runyardSshPaths(dir);
  // Made even for the demo, whose fake machines never use it, so its dashboard has a key to show.
  const keyError = await ensureRunyardKey(runCommand, sshKeygenProgram(), sshPaths);
  if (keyError) console.error(keyError);
  const programs: SshPrograms = overrides.programs ?? {
    ...installedPrograms(),
    ...(keyError ? {} : { identity: sshPaths.identity }),
    knownHosts: sshPaths.knownHosts,
  };

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
  const fetch: Fetch = overrides.fetch ?? ((request) => globalThis.fetch(request));
  // The machine monitor publishes the whole view; GitHub polls ask it to.
  let monitor: MachineMonitor | undefined;
  const github = new GithubMonitor({ db, secrets, fetch, onChange: () => monitor?.tick() });
  const forgejo = new ForgejoMonitor({ db, secrets, fetch, onChange: () => monitor?.tick() });
  const boat = new BoatMonitor({ secrets, fetch, onChange: () => monitor?.tick() });
  monitor = new MachineMonitor({
    db,
    run,
    programs,
    tailscale,
    github: () => github.observations(),
    forgejo: () => forgejo.observations(),
    boat: () => boat.observation(),
    pools: () => ({
      pools: listPools(db),
      registrations: listRegistrations(db),
      assignments: listAssignments(db),
      templateRecords: listTemplates(db),
      dispatches: listDispatches(db, 100),
      migrations: listMigrations(db),
    }),
  });
  monitor.start();
  const engine = new PoolEngine({
    db,
    run,
    programs,
    github,
    forgejo,
    fetch,
    machineView: (id) => monitor?.view.machines.find((m) => m.id === id),
    onChange: () => monitor?.tick(),
  });
  const dispatcher = new Dispatcher({
    db,
    run,
    programs,
    engine,
    github,
    forgejo,
    view: () => monitor!.view,
    onChange: () => monitor?.tick(),
  });

  void github.start();
  void forgejo.start();
  void boat.start();
  dispatcher.start();
  // Assigned once the tailnet listener exists, after the loopback server starts.
  let tailnet: TailnetListener | undefined;
  const tailnetState = (): TailnetState =>
    process.env.RUNYARD_TAILNET === "off"
      ? { kind: "off" }
      : (tailnet?.state ?? { kind: "starting" });
  // GitHub webhooks: their own loopback listener, for Funnel or a reverse proxy to expose.
  const receiver = new WebhookReceiver({
    db,
    secrets,
    github,
    afterRefresh: async () => {
      monitor?.tick();
      await dispatcher.tick();
    },
  });
  let webhookPort: number | null = null;
  if (process.env.RUNYARD_WEBHOOKS !== "off") {
    const port = Number(process.env.RUNYARD_WEBHOOK_PORT ?? 7444);
    try {
      Bun.serve({
        hostname: "127.0.0.1",
        port,
        maxRequestBodySize: 1_000_000,
        fetch: (r) => receiver.handle(r),
      });
      webhookPort = port;
    } catch (error) {
      console.log(
        `Webhook listener: couldn't listen on 127.0.0.1:${port}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const shared = {
    db,
    setup,
    limiter: new FailureLimiter(10, 15 * 60 * 1000),
    challenges: new Challenges(),
    tailnetLogin,
    monitor,
    demo: process.env.RUNYARD_DEMO === "1",
    engine,
    secrets,
    github,
    forgejo,
    boat,
    states: new ManifestStates(),
    fetch,
    apiBase: overrides.githubApiBase,
    webBase: overrides.githubWebBase,
    tailnetState,
    webhooks: { port: webhookPort, receiver, funnel: (port: number) => tailscale.funnelFor(port) },
    setupChecks: () => setupChecks({ run, programs, tailnet: tailnetState, dataDir: dir }),
    ssh: sshPaths,
    hostKeys: new HostKeys({ run, programs, file: sshPaths.knownHosts }),
    machineSetup: new MachineSetupCodes(),
  };
  const deps = (listener: AppDeps["listener"]): AppDeps => ({ ...shared, listener });

  pruneSessions(db);
  setInterval(() => pruneSessions(db), 60 * 60 * 1000).unref();

  const hostname = process.env.RUNYARD_HOST ?? "127.0.0.1";
  const port = Number(process.env.RUNYARD_PORT ?? 7420);
  const server = Bun.serve({ hostname, port, fetch: createApp(deps("tcp"), dashboard).fetch });
  console.log(`runyard listening on ${server.url.href} (data in ${dir})`);

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

  return { server, tailnet, db, secrets, monitor, github, forgejo, boat, dispatcher };
}
