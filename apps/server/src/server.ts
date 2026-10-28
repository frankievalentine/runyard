import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createApp, type AppDeps } from "./app.ts";
import { Challenges } from "./auth/passkeys.ts";
import { FailureLimiter } from "./auth/rate-limit.ts";
import { pruneSessions } from "./auth/sessions.ts";
import { SetupCode } from "./auth/setup.ts";
import { adminCount } from "./auth/users.ts";
import { dataDir } from "./config.ts";
import type { DashboardAssets } from "./dashboard.ts";
import { openDatabase } from "./db/index.ts";
import { loadSecretKey, SecretStore } from "./secrets.ts";

/** macOS limits Unix socket paths to 104 bytes including the terminator. */
const MAX_SOCKET_PATH = 103;

/**
 * Opens storage, then serves on TCP (loopback by default) and on a Unix socket
 * in the data directory for `tailscale serve unix:<path>`. Only the socket
 * trusts Tailscale identity headers.
 */
export async function start(dashboard?: DashboardAssets) {
  const dir = dataDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const db = openDatabase(join(dir, "runyard.db"));
  const secrets = await SecretStore.open(db, await loadSecretKey(process.env, dir));

  const setup = new SetupCode((code) => {
    console.log(
      `\nNo admin yet. Open the dashboard and enter this setup code to create one:\n\n    ${code}\n`,
    );
  });
  const limiter = new FailureLimiter(10, 15 * 60 * 1000);
  const challenges = new Challenges();
  const deps = (listener: AppDeps["listener"]): AppDeps => ({
    db,
    listener,
    setup,
    limiter,
    challenges,
  });

  pruneSessions(db);
  setInterval(() => pruneSessions(db), 60 * 60 * 1000).unref();

  // Checked before either listener starts, so a bad socket path never leaves TCP half up.
  const socketPath = process.env.RUNYARD_SOCKET ?? join(dir, "runyard.sock");
  if (socketPath !== "off") await clearStaleSocket(socketPath);

  const hostname = process.env.RUNYARD_HOST ?? "127.0.0.1";
  const port = Number(process.env.RUNYARD_PORT ?? 7420);
  const server = Bun.serve({ hostname, port, fetch: createApp(deps("tcp"), dashboard).fetch });
  console.log(`runyard listening on ${server.url.href} (data in ${dir})`);

  let socket: ReturnType<typeof Bun.serve> | undefined;
  if (socketPath !== "off") {
    socket = Bun.serve({ unix: socketPath, fetch: createApp(deps("socket"), dashboard).fetch });
    await chmod(socketPath, 0o600);
    console.log(`runyard listening on unix:${socketPath} (for tailscale serve)`);
  }
  if (adminCount(db) === 0) setup.issue();

  return { server, socket, db, secrets };
}

/** Removes a socket file left by a crashed run, but never one another Runyard is serving. */
async function clearStaleSocket(path: string) {
  if (path.length > MAX_SOCKET_PATH) {
    throw new Error(
      `The socket path ${path} is too long. Set RUNYARD_SOCKET to a shorter path, or "off".`,
    );
  }
  // lstat, not Bun.file().exists(): a socket isn't a regular file.
  if (
    !(await lstat(path).then(
      () => true,
      () => false,
    ))
  )
    return;
  const inUse = await Bun.connect({ unix: path, socket: { data() {} } }).then(
    (s) => (s.end(), true),
    () => false,
  );
  if (inUse) throw new Error(`Another Runyard is already listening on ${path}.`);
  await unlink(path);
}
