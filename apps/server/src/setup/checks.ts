import { statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../command.ts";
import { runyardPublicKey, runyardSshPaths } from "../machines/keys.ts";
import type { SshPrograms } from "../machines/ssh.ts";

export type CheckState = "ok" | "warn" | "bad" | "off";
export type SetupCheck = {
  id: string;
  title: string;
  /** Two or three words on how it stands, shown beside the title. */
  status: string;
  /** What the check is for, whatever its state. */
  about: string;
  state: CheckState;
  /** The particulars: a version, a path, what went wrong. */
  detail: string;
  /** What to do about it, when anything. */
  fix: string | null;
};

export type TailnetState =
  | { kind: "off" }
  | { kind: "serving"; url: string }
  | { kind: "problem"; message: string }
  | { kind: "starting" };

/** A check before its `about` is added. */
type Check = Omit<SetupCheck, "about">;

export type CheckDeps = {
  run: CommandRunner;
  programs: SshPrograms;
  tailnet: () => TailnetState;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
};

const KEY_FILES = ["id_ed25519", "id_ecdsa", "id_rsa"];
const LOW_DISK_PERCENT = 10;

/** What each check is for, by id, in words for someone new to it. */
const ABOUT: Record<string, string> = {
  ssh: "Runyard uses SSH to connect to your machines and set up their runners.",
  sshKey:
    "Runyard's own login key. Each machine trusts it when you set the machine up, so Runyard never needs your personal keys.",
  tailnet:
    "Lets you open Runyard securely from your other devices on your Tailscale network. Passkeys, the phone app and the machine setup command need it.",
  secretKey:
    "Locks the GitHub, Forgejo and boat.dev logins Runyard saves. Without this key, Runyard can't read them.",
  disk: "The folder where Runyard keeps its database and logs.",
  service:
    "Keeps Runyard running in the background, and starts it again when this computer restarts.",
};

/** What the control machine needs for Runyard to work, each with a one-line fix. Read-only. */
export async function setupChecks(deps: CheckDeps): Promise<SetupCheck[]> {
  const checks = await Promise.all([
    ssh(deps),
    sshKey(deps),
    tailnet(deps),
    secretKey(deps),
    disk(deps),
    service(deps),
  ]);
  return checks.map((c) => ({ ...c, about: ABOUT[c.id] ?? "" }));
}

async function ssh({ run, programs, platform = process.platform }: CheckDeps): Promise<Check> {
  const title = "OpenSSH client";
  const res = await run([programs.ssh, "-V"], { timeoutMs: 5_000 });
  const version = (res.stderr || res.stdout).trim().split(/\r?\n/)[0] ?? "";
  if (res.code === 0)
    return { id: "ssh", title, status: "Installed", state: "ok", detail: version, fix: null };
  return {
    id: "ssh",
    title,
    status: "Not found",
    state: "bad",
    detail: `Runyard couldn't find SSH at ${programs.ssh}.`,
    fix:
      platform === "win32"
        ? "Add OpenSSH Client in Windows Settings ▸ System ▸ Optional features."
        : platform === "darwin"
          ? "macOS comes with SSH. If yours is somewhere other than /usr/bin/ssh, set RUNYARD_SSH to its path."
          : "Install it with your package manager, for example `sudo apt install openssh-client`.",
  };
}

async function sshKey({ dataDir, env = process.env, home = homedir() }: CheckDeps): Promise<Check> {
  const title = "SSH key";
  const key = await runyardPublicKey(runyardSshPaths(dataDir));
  if (key)
    return {
      id: "sshKey",
      title,
      status: "Ready",
      state: "ok",
      detail: `Fingerprint ${key.fingerprint}`,
      fix: null,
    };
  let own: string | null = null;
  for (const name of KEY_FILES)
    if (await Bun.file(join(home, ".ssh", name)).exists()) own = `~/.ssh/${name}`;
  if (!own && env.SSH_AUTH_SOCK) own = "your SSH agent";
  return {
    id: "sshKey",
    title,
    status: own ? "Using yours" : "Missing",
    state: "warn",
    detail: own
      ? `Runyard couldn't make its own key, so it signs in with ${own}.`
      : "Runyard couldn't make its own key, and found none of yours to use.",
    fix: "Install ssh-keygen (it comes with OpenSSH), then restart Runyard. Or use Tailscale SSH on your machines instead.",
  };
}

async function tailnet(deps: CheckDeps): Promise<Check> {
  const title = "Tailscale HTTPS";
  const state = deps.tailnet();
  switch (state.kind) {
    case "serving":
      return { id: "tailnet", title, status: "On", state: "ok", detail: state.url, fix: null };
    case "off":
      return {
        id: "tailnet",
        title,
        status: "Off",
        state: "off",
        detail: "It's turned off (RUNYARD_TAILNET=off), so Runyard opens only on this computer.",
        fix: null,
      };
    case "starting":
      return {
        id: "tailnet",
        title,
        status: "Starting",
        state: "warn",
        detail: "Runyard is still reading Tailscale.",
        fix: null,
      };
    case "problem":
      return {
        id: "tailnet",
        title,
        status: "Not working",
        state: "warn",
        detail: state.message,
        fix:
          (deps.platform ?? process.platform) === "linux" &&
          /denied|permission|operator/i.test(state.message)
            ? "Let Runyard's user get certificates: `sudo tailscale set --operator=<user>`. Runyard tries again every five minutes."
            : "Install Tailscale and sign in, to open Runyard from your other devices. Runyard tries again every five minutes.",
      };
  }
}

async function secretKey({ env = process.env, dataDir }: CheckDeps): Promise<Check> {
  const title = "Secret key";
  if (env.RUNYARD_SECRET_KEY) {
    return {
      id: "secretKey",
      title,
      status: "Set",
      state: "ok",
      detail: "Read from RUNYARD_SECRET_KEY.",
      fix: null,
    };
  }
  if (env.RUNYARD_SECRET_KEY_FILE) {
    return {
      id: "secretKey",
      title,
      status: "Set",
      state: "ok",
      detail: `Read from ${env.RUNYARD_SECRET_KEY_FILE}.`,
      fix: null,
    };
  }
  return {
    id: "secretKey",
    title,
    status: "Back it up",
    state: "warn",
    detail: `Runyard made this key and saved it next to its database: ${join(dataDir, "secret.key")}`,
    fix: "Copy that file somewhere safe, apart from your database backups. If it's lost, you'll have to connect GitHub and Forgejo again.",
  };
}

async function service({ env = process.env }: CheckDeps): Promise<Check> {
  const title = "Background service";
  if (env.RUNYARD_SERVICE === "1") {
    return {
      id: "service",
      title,
      status: "Running",
      state: "ok",
      detail: "Runyard runs in the background and starts again on its own.",
      fix: null,
    };
  }
  return {
    id: "service",
    title,
    status: "Started by hand",
    state: "warn",
    detail: "Runyard stops when you close the terminal it's running in.",
    fix: "Run `runyard service install` to keep it running.",
  };
}

async function disk({ dataDir }: CheckDeps): Promise<Check> {
  const title = "Data directory";
  try {
    const s = await statfs(dataDir);
    const free = s.blocks ? (s.bavail / s.blocks) * 100 : 100;
    if (free < LOW_DISK_PERCENT) {
      return {
        id: "disk",
        title,
        status: "Low on space",
        state: "warn",
        detail: `Only ${free.toFixed(1)}% of the disk is free. The folder: ${dataDir}`,
        fix: "Free up some space on this disk.",
      };
    }
    return {
      id: "disk",
      title,
      status: `${Math.floor(free)}% free`,
      state: "ok",
      detail: dataDir,
      fix: null,
    };
  } catch (error) {
    return {
      id: "disk",
      title,
      status: "Can't read",
      state: "bad",
      detail: `Runyard couldn't open ${dataDir}: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Check the folder's permissions, or point RUNYARD_DATA_DIR at another folder.",
    };
  }
}
