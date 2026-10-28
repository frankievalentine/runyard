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
import { FakeMachines } from "./machines/fake.ts";
import { importKey } from "./crypto.ts";
import { SecretStore } from "./secrets.ts";
import { MachineMonitor } from "./machines/monitor.ts";
import { PoolEngine } from "./pools/engine.ts";
import { listPools, listRegistrations } from "./pools/store.ts";

/** An app on an in-memory database. `codes` collects every setup code announced. */
export async function testApp(
  options: { listener?: Listener; dashboard?: DashboardAssets; issueSetupCode?: boolean } = {},
) {
  const codes: string[] = [];
  const setup = new SetupCode((code) => codes.push(code));
  if (options.issueSetupCode ?? true) setup.issue();
  const db = openDatabase(":memory:");
  const fake = new FakeMachines();
  const clock = { now: 1_000_000 };
  const secrets = await SecretStore.open(
    db,
    await importKey(crypto.getRandomValues(new Uint8Array(32))),
  );
  const fakeGithub = new FakeGithub();
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
  monitor = new MachineMonitor({
    db,
    run: fake.run,
    programs: fake.programs,
    tailscale: fake.tailscale,
    now: () => clock.now,
    github: () => github.observations(),
    forgejo: () => forgejo.observations(),
    pools: () => ({ pools: listPools(db), registrations: listRegistrations(db) }),
  });
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
  });
  const deps: AppDeps = {
    db,
    monitor,
    secrets,
    github,
    forgejo,
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
  };
  const app = createApp(deps, options.dashboard);
  return {
    app,
    deps,
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
