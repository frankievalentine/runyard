import { createApp, type AppDeps } from "./app.ts";
import type { Listener } from "./auth/identity.ts";
import { Challenges } from "./auth/passkeys.ts";
import { FailureLimiter } from "./auth/rate-limit.ts";
import { SetupCode } from "./auth/setup.ts";
import type { DashboardAssets } from "./dashboard.ts";
import { openDatabase } from "./db/index.ts";
import { FakeGithub } from "./github/fake.ts";
import { ManifestStates } from "./github/manifest.ts";
import { GithubMonitor } from "./github/monitor.ts";
import { ForgejoMonitor } from "./forgejo/monitor.ts";
import { FakeForgejo } from "./forgejo/fake.ts";
import { FakeBoat } from "./boat/fake.ts";
import { BoatMonitor } from "./boat/monitor.ts";
import { FakeMachines } from "./machines/fake.ts";
import { importKey } from "./crypto.ts";
import { SecretStore } from "./secrets.ts";
import { WebhookReceiver } from "./webhooks/receiver.ts";
import { setupChecks, type TailnetState } from "./setup/checks.ts";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAssignments, listMigrations } from "./machines/assignments.ts";
import { HostKeys } from "./machines/host-keys.ts";
import { MachineSetupCodes } from "./machines/setup-codes.ts";
import { TestJobs } from "./pools/test-jobs.ts";
import { runyardSshPaths } from "./machines/keys.ts";
import { MachineMonitor } from "./machines/monitor.ts";
import { Dispatcher } from "./pools/dispatcher.ts";
import { PoolEngine } from "./pools/engine.ts";
import { listDispatches, listPools, listRegistrations, listTemplates } from "./pools/store.ts";

/** An app on an in-memory database. `codes` collects every setup code announced. */
export async function testApp(
  options: { listener?: Listener; dashboard?: DashboardAssets; issueSetupCode?: boolean } = {},
) {
  const codes: string[] = [];
  const setup = new SetupCode((code) => codes.push(code));
  if (options.issueSetupCode ?? true) setup.issue();
  const db = openDatabase(":memory:");
  const dataDir = await mkdtemp(join(tmpdir(), "runyard-test-data-"));
  const ssh = runyardSshPaths(dataDir);
  await mkdir(ssh.dir, { mode: 0o700 });
  const fake = new FakeMachines();
  const clock = { now: 1_000_000 };
  const secrets = await SecretStore.open(
    db,
    await importKey(crypto.getRandomValues(new Uint8Array(32))),
  );
  const fakeGithub = new FakeGithub();
  /** What the tailnet listener reports; tests set it. */
  const tailnet: { state: TailnetState } = { state: { kind: "off" } };
  let monitor: MachineMonitor | undefined;
  const github = new GithubMonitor({
    db,
    secrets,
    fetch: fakeGithub.fetch,
    onChange: () => monitor?.tick(),
  });
  const fakeForgejo = new FakeForgejo();
  const forgejo = new ForgejoMonitor({
    db,
    secrets,
    fetch: fakeForgejo.fetch,
    onChange: () => monitor?.tick(),
  });
  const fakeBoat = new FakeBoat();
  const boat = new BoatMonitor({
    secrets,
    fetch: fakeBoat.fetch,
    now: () => clock.now,
    onChange: () => monitor?.tick(),
  });
  monitor = new MachineMonitor({
    db,
    run: fake.run,
    programs: fake.programs,
    tailscale: fake.tailscale,
    now: () => clock.now,
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
  /** Machines a finished run asked to check again. */
  const rechecked: string[] = [];
  const engine = new PoolEngine({
    db,
    run: fake.run,
    programs: fake.programs,
    github,
    forgejo,
    fetch: fakeForgejo.fetch,
    machineView: (id) => monitor?.view.machines.find((m) => m.id === id),
    now: () => clock.now,
    onChange: () => monitor?.tick(),
    afterRun: (machineId) => rechecked.push(machineId),
  });
  const dispatcher = new Dispatcher({
    db,
    run: fake.run,
    programs: fake.programs,
    engine,
    github,
    forgejo,
    view: () => monitor!.view,
    now: () => clock.now,
    onChange: () => monitor?.tick(),
  });

  const receiver = new WebhookReceiver({
    db,
    secrets,
    github,
    afterRefresh: async () => {
      monitor?.tick();
      await dispatcher.tick();
    },
    now: () => clock.now,
    nudgeDelayMs: 0,
  });
  /** What Tailscale reports Funnel serving; tests set it. */
  const funnel: { url: string | null } = { url: null };
  const deps: AppDeps = {
    db,
    monitor,
    secrets,
    github,
    forgejo,
    boat,
    engine,
    states: new ManifestStates(),
    fetch: fakeGithub.fetch,
    apiBase: "https://api.github.test",
    webBase: "https://github.test",
    listener: options.listener ?? "tcp",
    setup,
    limiter: new FailureLimiter(10, 15 * 60 * 1000),
    challenges: new Challenges(),
    // Tests name the connecting device's login with a header; production asks `tailscale whois`.
    tailnetLogin: async (c) => c.req.header("X-Test-Tailnet-Login")?.toLowerCase() ?? null,
    tailnetState: () => tailnet.state,
    webhooks: { port: 7444, receiver, funnel: async () => funnel },
    setupChecks: () =>
      setupChecks({
        run: fake.run,
        programs: fake.programs,
        tailnet: () => tailnet.state,
        dataDir,
        env: {},
        home: join(tmpdir(), "runyard-no-home"),
      }),
    ssh,
    hostKeys: new HostKeys({ run: fake.run, programs: fake.programs, file: ssh.knownHosts }),
    machineSetup: new MachineSetupCodes(() => clock.now),
    testJobs: new TestJobs({ github, now: () => clock.now }),
    dispatcher,
  };
  const app = createApp(deps, options.dashboard);
  return {
    app,
    deps,
    tailnet,
    codes,
    setup,
    fake,
    clock,
    monitor,
    github,
    fakeGithub,
    engine,
    forgejo,
    fakeForgejo,
    boat,
    fakeBoat,
    dispatcher,
    receiver,
    funnel,
    rechecked,
  };
}

/** A same-origin JSON request as the dashboard would send it, with an optional cookie and extra headers. */
export function send(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method,
    headers: {
      Host: "localhost",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The `runyard_session` cookie a response set, as a `Cookie` header value. */
export function sessionCookie(res: Response): string {
  const set = res.headers.getSetCookie().find((c) => c.startsWith("runyard_session="));
  if (!set) throw new Error("No session cookie was set.");
  return set.split(";")[0]!;
}

/** A response's JSON body, typed by the caller. */
export async function body<T>(res: Response | Promise<Response>): Promise<T> {
  return (await (await res).json()) as T;
}
