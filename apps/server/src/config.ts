import { homedir } from "node:os";
import { join } from "node:path";

/** Where the database and generated key file live: `RUNYARD_DATA_DIR`, else the platform's per-user data directory. */
export function dataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): string {
  if (env.RUNYARD_DATA_DIR) return env.RUNYARD_DATA_DIR;
  if (platform === "darwin") return join(home, "Library", "Application Support", "Runyard");
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Runyard");
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "runyard");
}
