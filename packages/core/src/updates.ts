/**
 * Updating Runyard itself: whether a release is newer than what runs, and the steps that update
 * this host, which depend on how Runyard was installed.
 */

/** How this Runyard was installed and is kept running. */
export type InstallKind =
  /** The Docker image, from docker/compose.yaml. */
  | "docker"
  /** The installed binary, run by launchd, systemd or a Windows scheduled task. */
  | "service"
  /** The installed binary, started in a terminal. */
  | "terminal"
  /** `bun src/main.ts` from a checkout. */
  | "source";

export type UpdateSteps = {
  /** One line to paste into a terminal on the Runyard host, or null when there is none. */
  command: string | null;
  /** Where to run it and what happens next. */
  note: string;
};

const SITE = "https://frankievalentine.github.io/runyard";

/** `0.3.0`, `v0.3.0` or `0.3.0-rc.1` as numbers, or null when it isn't a version. */
function parse(version: string): { core: number[]; pre: string | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
}

/**
 * Whether `latest` is a later release than `current`. A prerelease comes before its release
 * (0.4.0-rc.1 < 0.4.0). Anything that isn't a version is never newer.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b.core[i] !== a.core[i]) return b.core[i]! > a.core[i]!;
  }
  if (a.pre === b.pre) return false;
  if (b.pre === null) return true;
  if (a.pre === null) return false;
  return b.pre.localeCompare(a.pre, "en", { numeric: true }) > 0;
}

/**
 * The steps that update this host to `version`. `binary` is the running runyard's path: the
 * installer is pointed at its folder, so it replaces this binary rather than putting a second
 * one somewhere else on the PATH.
 */
export function updateSteps(options: {
  kind: InstallKind;
  platform: string;
  version: string;
  binary: string;
}): UpdateSteps {
  const { kind, platform, version, binary } = options;
  const windows = platform === "win32";
  const slash = Math.max(binary.lastIndexOf("/"), binary.lastIndexOf("\\"));
  const dir = slash > 0 ? binary.slice(0, slash) : null;
  if (kind === "docker") {
    return {
      command:
        "docker compose -f docker/compose.yaml pull && docker compose -f docker/compose.yaml up -d",
      note: `Run it in your Runyard checkout. If docker/.env pins RUNYARD_VERSION, set it to ${version} first. Runyard updates its database when it starts.`,
    };
  }
  if (kind === "source") {
    return {
      command: null,
      note: `This Runyard runs from a checkout. Pull ${version} (git pull --tags, then check out v${version}), run vp install, then restart it.`,
    };
  }
  if (windows) {
    const env = dir ? `$env:RUNYARD_INSTALL_DIR='${dir.replace(/'/g, "''")}'; ` : "";
    const install = `${env}irm ${SITE}/install.ps1 | iex`;
    return kind === "service"
      ? {
          command: `Stop-ScheduledTask -TaskName Runyard; ${install}; & '${binary.replace(/'/g, "''")}' service install`,
          note: "Run it in PowerShell on this host. Windows can't replace a running runyard, so it stops the service first; service install starts it again on the new version.",
        }
      : {
          command: install,
          note: "Stop Runyard first (Windows can't replace it while it runs), run this in PowerShell on this host, then start runyard again.",
        };
  }
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const env = dir ? `RUNYARD_INSTALL_DIR=${quote(dir)} ` : "";
  const install = `curl -fsSL ${SITE}/install.sh | ${env}sh`;
  return kind === "service"
    ? {
        command: `${install} && ${quote(binary)} service install`,
        note: "Run it in a terminal on this host. It checks the download against the release's checksums, then service install restarts Runyard on the new version. The dashboard reconnects on its own.",
      }
    : {
        command: install,
        note: "Run it in a terminal on this host, then restart runyard in the terminal it runs in.",
      };
}
