import { join } from "node:path";

export const SERVICE_NAME = "runyard";
export const LAUNCHD_LABEL = "dev.runyard";
export const WINDOWS_TASK = "Runyard";
const UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;

/** Settings that carry into the service. A literal secret key never does: unit files are world-readable. */
const CARRIED = [
  "RUNYARD_HOST",
  "RUNYARD_PORT",
  "RUNYARD_DATA_DIR",
  "RUNYARD_SECRET_KEY_FILE",
  "RUNYARD_TAILNET",
  "RUNYARD_TAILNET_PORT",
  "RUNYARD_TAILSCALE",
  "RUNYARD_SSH",
  "RUNYARD_ORIGIN",
];

export type ServiceContext = {
  platform: NodeJS.Platform;
  /** The compiled runyard binary, by absolute path. */
  binary: string;
  user: string;
  uid: number;
  home: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  /** Absolute path of the Tailscale CLI, when found at install time; services get a minimal PATH. */
  tailscale: string | null;
};

/** A file to write, then commands to run, in order. `sudo` marks the ones that need root. */
export type ServicePlan = {
  kind: "systemd" | "launchagent" | "scheduled-task";
  summary: string;
  files: { path: string; content: string; sudo: boolean; mode: number }[];
  commands: { argv: string[]; sudo: boolean; ignoreFailure?: boolean }[];
  logs: string;
};

export class ServiceError extends Error {}

/** The service's environment: carried settings, the data directory, and the tools by absolute path. */
export function serviceEnv(ctx: ServiceContext): Record<string, string> {
  if (ctx.env.RUNYARD_SECRET_KEY) {
    throw new ServiceError(
      "RUNYARD_SECRET_KEY is set. Service definitions are readable by other users, so put the key in a file and set RUNYARD_SECRET_KEY_FILE instead.",
    );
  }
  const env: Record<string, string> = {};
  for (const key of CARRIED) {
    const value = ctx.env[key];
    if (value) env[key] = value;
  }
  env.RUNYARD_DATA_DIR = ctx.dataDir;
  if (!env.RUNYARD_TAILSCALE && ctx.tailscale) env.RUNYARD_TAILSCALE = ctx.tailscale;
  if (ctx.env.PATH) env.PATH = ctx.env.PATH;
  // Lets the setup checks tell a service from a terminal session.
  env.RUNYARD_SERVICE = "1";
  return env;
}

export function installPlan(ctx: ServiceContext): ServicePlan {
  const env = serviceEnv(ctx);
  if (ctx.platform === "linux") return systemd(ctx, env);
  if (ctx.platform === "darwin") return launchAgent(ctx, env);
  if (ctx.platform === "win32") return scheduledTask(ctx, env);
  throw new ServiceError(`Runyard can't install a service on ${ctx.platform}.`);
}

export function uninstallPlan(
  ctx: Pick<ServiceContext, "platform" | "uid" | "home" | "dataDir">,
): ServicePlan {
  if (ctx.platform === "linux") {
    return {
      kind: "systemd",
      summary: `Stop and remove the ${SERVICE_NAME} systemd service.`,
      files: [],
      commands: [
        { argv: ["systemctl", "disable", "--now", SERVICE_NAME], sudo: true, ignoreFailure: true },
        { argv: ["rm", "-f", UNIT_PATH], sudo: true },
        { argv: ["systemctl", "daemon-reload"], sudo: true },
      ],
      logs: `journalctl -u ${SERVICE_NAME}`,
    };
  }
  if (ctx.platform === "darwin") {
    const plist = plistPath(ctx.home);
    return {
      kind: "launchagent",
      summary: `Stop and remove the ${LAUNCHD_LABEL} LaunchAgent.`,
      files: [],
      commands: [
        {
          argv: ["launchctl", "bootout", `gui/${ctx.uid}/${LAUNCHD_LABEL}`],
          sudo: false,
          ignoreFailure: true,
        },
        { argv: ["rm", "-f", plist], sudo: false },
      ],
      logs: join(ctx.dataDir, "runyard.log"),
    };
  }
  if (ctx.platform === "win32") {
    return {
      kind: "scheduled-task",
      summary: `Stop and remove the ${WINDOWS_TASK} scheduled task.`,
      files: [],
      commands: [
        {
          argv: powershell(
            `Stop-ScheduledTask -TaskName '${WINDOWS_TASK}' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName '${WINDOWS_TASK}' -Confirm:$false`,
          ),
          sudo: false,
        },
      ],
      logs: join(ctx.dataDir, "runyard.log"),
    };
  }
  throw new ServiceError(`Runyard can't manage a service on ${ctx.platform}.`);
}

/** Linux: a system unit running as the user, so it starts at boot without a login. */
function systemd(ctx: ServiceContext, env: Record<string, string>): ServicePlan {
  const unit = [
    "[Unit]",
    "Description=Runyard: self-hosted CI runner control",
    "After=network-online.target tailscaled.service",
    "Wants=network-online.target",
    "",
    "[Service]",
    `User=${ctx.user}`,
    ...Object.entries(env).map(([k, v]) => `Environment=${systemdQuote(`${k}=${v}`)}`),
    // `$` is expanded in ExecStart, so it's doubled there.
    `ExecStart=${systemdQuote(ctx.binary).replace(/\$/g, "$$$$")}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
  return {
    kind: "systemd",
    summary: `Install ${UNIT_PATH}, running ${ctx.binary} as ${ctx.user} at boot.`,
    files: [{ path: UNIT_PATH, content: unit, sudo: true, mode: 0o644 }],
    commands: [
      { argv: ["systemctl", "daemon-reload"], sudo: true },
      { argv: ["systemctl", "enable", "--now", SERVICE_NAME], sudo: true },
      // Picks up a new binary or settings when reinstalling over a running service.
      { argv: ["systemctl", "restart", SERVICE_NAME], sudo: true },
    ],
    logs: `journalctl -u ${SERVICE_NAME}`,
  };
}

/** macOS: a LaunchAgent, which starts at login (as the Tailscale app does). */
function launchAgent(ctx: ServiceContext, env: Record<string, string>): ServicePlan {
  const log = join(ctx.dataDir, "runyard.log");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(ctx.binary)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
  .join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
  const path = plistPath(ctx.home);
  const domain = `gui/${ctx.uid}`;
  return {
    kind: "launchagent",
    summary: `Install ${path}, running ${ctx.binary} whenever ${ctx.user} is logged in.`,
    files: [{ path, content: plist, sudo: false, mode: 0o644 }],
    commands: [
      // Replaces a loaded copy, so reinstalling picks up changes.
      {
        argv: ["launchctl", "bootout", `${domain}/${LAUNCHD_LABEL}`],
        sudo: false,
        ignoreFailure: true,
      },
      { argv: ["launchctl", "bootstrap", domain, path], sudo: false },
    ],
    logs: log,
  };
}

/** Windows: a scheduled task at logon as the user, with no stored password and no time limit. */
function scheduledTask(ctx: ServiceContext, env: Record<string, string>): ServicePlan {
  const log = join(ctx.dataDir, "runyard.log");
  const launcher = join(ctx.dataDir, "runyard-service.ps1");
  const script = [
    "# Generated by `runyard service install`. Starts Runyard with its settings.",
    ...Object.entries(env).map(([k, v]) => `$env:${k} = ${psQuote(v)}`),
    `& ${psQuote(ctx.binary)} *>> ${psQuote(log)}`,
    "",
  ].join("\r\n");
  const register = [
    `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psQuote(`-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${launcher}"`)}`,
    `$trigger = New-ScheduledTaskTrigger -AtLogOn -User ${psQuote(ctx.user)}`,
    "$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew",
    `$principal = New-ScheduledTaskPrincipal -UserId ${psQuote(ctx.user)} -LogonType Interactive -RunLevel Limited`,
    `Stop-ScheduledTask -TaskName '${WINDOWS_TASK}' -ErrorAction SilentlyContinue`,
    `Register-ScheduledTask -TaskName '${WINDOWS_TASK}' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null`,
    `Start-ScheduledTask -TaskName '${WINDOWS_TASK}'`,
  ].join("; ");
  return {
    kind: "scheduled-task",
    summary: `Register the ${WINDOWS_TASK} scheduled task, running ${ctx.binary} whenever ${ctx.user} logs on.`,
    files: [{ path: launcher, content: script, sudo: false, mode: 0o600 }],
    commands: [{ argv: powershell(register), sudo: false }],
    logs: log,
  };
}

export function statusCommand(ctx: Pick<ServiceContext, "platform" | "uid">): string[] {
  if (ctx.platform === "linux") return ["systemctl", "status", "--no-pager", SERVICE_NAME];
  if (ctx.platform === "darwin") return ["launchctl", "print", `gui/${ctx.uid}/${LAUNCHD_LABEL}`];
  if (ctx.platform === "win32") {
    return powershell(
      `Get-ScheduledTask -TaskName '${WINDOWS_TASK}' | Select-Object TaskName, State | Format-List; Get-ScheduledTaskInfo -TaskName '${WINDOWS_TASK}' | Select-Object LastRunTime, LastTaskResult | Format-List`,
    );
  }
  throw new ServiceError(`Runyard can't manage a service on ${ctx.platform}.`);
}

export function plistPath(home: string) {
  return join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function powershell(command: string): string[] {
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command];
}

/** systemd's double-quoted form: backslashes and quotes escaped, `%` doubled so it isn't a specifier. */
export function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
