import { statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../command.ts";
import type { SshPrograms } from "../machines/ssh.ts";

export type CheckState = "ok" | "warn" | "bad" | "off";
export type SetupCheck = {
  id: string;
  title: string;
  state: CheckState;
  detail: string;
  fix: string | null;
};

export type TailnetState =
  | { kind: "off" }
  | { kind: "serving"; url: string }
  | { kind: "problem"; message: string }
  | { kind: "starting" };

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

/** What the control machine needs for Runyard to work, each with a one-line fix. Read-only. */
export async function setupChecks(deps: CheckDeps): Promise<SetupCheck[]> {
  return Promise.all([
    ssh(deps),
    sshKey(deps),
    tailnet(deps),
    secretKey(deps),
    disk(deps),
    service(deps),
  ]);
}

async function ssh({ run, programs, platform = process.platform }: CheckDeps): Promise<SetupCheck> {
  const res = await run([programs.ssh, "-V"], { timeoutMs: 5_000 });
  const version = (res.stderr || res.stdout).trim().split(/\r?\n/)[0] ?? "";
  if (res.code === 0)
    return { id: "ssh", title: "OpenSSH client", state: "ok", detail: version, fix: null };
  return {
    id: "ssh",
    title: "OpenSSH client",
    state: "bad",
    detail: `Runyard couldn't run ${programs.ssh}.`,
    fix:
      platform === "win32"
        ? "Add OpenSSH Client in Settings ▸ System ▸ Optional features."
        : platform === "darwin"
          ? "macOS includes OpenSSH; set RUNYARD_SSH if it lives somewhere other than /usr/bin/ssh."
          : "Install it with your package manager, such as `sudo apt install openssh-client`.",
  };
}

async function sshKey({ env = process.env, home = homedir() }: CheckDeps): Promise<SetupCheck> {
  const title = "SSH key";
  for (const name of KEY_FILES) {
    if (await Bun.file(join(home, ".ssh", name)).exists()) {
      return { id: "sshKey", title, state: "ok", detail: `~/.ssh/${name}`, fix: null };
    }
  }
  if (env.SSH_AUTH_SOCK)
    return { id: "sshKey", title, state: "ok", detail: "An SSH agent is running.", fix: null };
  return {
    id: "sshKey",
    title,
    state: "warn",
    detail: "No key in ~/.ssh and no SSH agent.",
    fix: "Run `ssh-keygen -t ed25519` and add ~/.ssh/id_ed25519.pub to each machine's authorized_keys, or use Tailscale SSH for machines on your tailnet.",
  };
}

async function tailnet(deps: CheckDeps): Promise<SetupCheck> {
  const title = "Tailscale HTTPS";
  const state = deps.tailnet();
  switch (state.kind) {
    case "serving":
      return { id: "tailnet", title, state: "ok", detail: state.url, fix: null };
    case "off":
      return {
        id: "tailnet",
        title,
        state: "off",
        detail: "Turned off with RUNYARD_TAILNET=off. Runyard serves on its local address only.",
        fix: null,
      };
    case "starting":
      return { id: "tailnet", title, state: "warn", detail: "Reading Tailscale…", fix: null };
    case "problem":
      return {
        id: "tailnet",
        title,
        state: "warn",
        detail: state.message,
        fix:
          (deps.platform ?? process.platform) === "linux" &&
          /denied|permission|operator/i.test(state.message)
            ? "Let Runyard's user fetch certificates: `sudo tailscale set --operator=<user>`. Runyard checks again every five minutes."
            : "Install Tailscale and sign in to reach Runyard from your other devices. Runyard checks again every five minutes.",
      };
  }
}

async function secretKey({ env = process.env, dataDir }: CheckDeps): Promise<SetupCheck> {
  const title = "Secret key";
  if (env.RUNYARD_SECRET_KEY) {
    return { id: "secretKey", title, state: "ok", detail: "From RUNYARD_SECRET_KEY.", fix: null };
  }
  if (env.RUNYARD_SECRET_KEY_FILE) {
    return {
      id: "secretKey",
      title,
      state: "ok",
      detail: `From ${env.RUNYARD_SECRET_KEY_FILE}.`,
      fix: null,
    };
  }
  return {
    id: "secretKey",
    title,
    state: "warn",
    detail: `Generated beside the database, at ${join(dataDir, "secret.key")}.`,
    fix: "Back it up somewhere other than the database's backups: without it, stored GitHub and Forgejo credentials can't be read.",
  };
}

async function service({ env = process.env }: CheckDeps): Promise<SetupCheck> {
  const title = "Background service";
  if (env.RUNYARD_SERVICE === "1") {
    return {
      id: "service",
      title,
      state: "ok",
      detail: "Runyard runs as a service and restarts on its own.",
      fix: null,
    };
  }
  return {
    id: "service",
    title,
    state: "warn",
    detail: "Runyard was started by hand; it stops when that terminal closes.",
    fix: "Run `runyard service install` to keep it running.",
  };
}

async function disk({ dataDir }: CheckDeps): Promise<SetupCheck> {
  const title = "Data directory";
  try {
    const s = await statfs(dataDir);
    const free = s.blocks ? (s.bavail / s.blocks) * 100 : 100;
    if (free < LOW_DISK_PERCENT) {
      return {
        id: "disk",
        title,
        state: "warn",
        detail: `${dataDir}: ${free.toFixed(1)}% free.`,
        fix: "Free some space: Runyard's database and event journal live here.",
      };
    }
    return { id: "disk", title, state: "ok", detail: dataDir, fix: null };
  } catch (error) {
    return {
      id: "disk",
      title,
      state: "bad",
      detail: `Couldn't read ${dataDir}: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Check the directory's permissions, or set RUNYARD_DATA_DIR.",
    };
  }
}
