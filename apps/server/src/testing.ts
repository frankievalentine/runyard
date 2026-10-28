import { createApp, type AppDeps } from "./app.ts";
import type { Listener } from "./auth/identity.ts";
import { Challenges } from "./auth/passkeys.ts";
import { FailureLimiter } from "./auth/rate-limit.ts";
import { SetupCode } from "./auth/setup.ts";
import type { DashboardAssets } from "./dashboard.ts";
import { openDatabase } from "./db/index.ts";

/** An app on an in-memory database. `codes` collects every setup code announced. */
export function testApp(
  options: { listener?: Listener; dashboard?: DashboardAssets; issueSetupCode?: boolean } = {},
) {
  const codes: string[] = [];
  const setup = new SetupCode((code) => codes.push(code));
  if (options.issueSetupCode ?? true) setup.issue();
  const deps: AppDeps = {
    db: openDatabase(":memory:"),
    listener: options.listener ?? "tcp",
    setup,
    limiter: new FailureLimiter(10, 15 * 60 * 1000),
    challenges: new Challenges(),
  };
  const app = createApp(deps, options.dashboard);
  return { app, deps, codes, setup };
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
