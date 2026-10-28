import { describe, expect, test } from "bun:test";
import {
  installPlan,
  serviceEnv,
  systemdQuote,
  uninstallPlan,
  type ServiceContext,
} from "./plan.ts";

const base: ServiceContext = {
  platform: "linux",
  binary: "/home/ci/.local/bin/runyard",
  user: "ci",
  uid: 1000,
  home: "/home/ci",
  dataDir: "/home/ci/.local/share/runyard",
  env: { PATH: "/usr/local/bin:/usr/bin:/bin", RUNYARD_PORT: "8080", HOME: "/home/ci" },
  tailscale: "/usr/bin/tailscale",
};

describe("service plans", () => {
  test("carry Runyard's settings and tool paths, never a literal secret key", () => {
    expect(serviceEnv(base)).toEqual({
      RUNYARD_PORT: "8080",
      RUNYARD_DATA_DIR: "/home/ci/.local/share/runyard",
      RUNYARD_TAILSCALE: "/usr/bin/tailscale",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      RUNYARD_SERVICE: "1",
    });
    expect(() => serviceEnv({ ...base, env: { RUNYARD_SECRET_KEY: "abc" } })).toThrow(
      "RUNYARD_SECRET_KEY_FILE",
    );
  });

  test("Linux: a system unit running as the user, installed and started with sudo", () => {
    const plan = installPlan(base);
    const unit = plan.files[0]!;
    expect(unit).toMatchObject({
      path: "/etc/systemd/system/runyard.service",
      sudo: true,
      mode: 0o644,
    });
    expect(unit.content).toContain("User=ci\n");
    expect(unit.content).toContain('Environment="RUNYARD_PORT=8080"');
    expect(unit.content).toContain('ExecStart="/home/ci/.local/bin/runyard"');
    expect(plan.commands.map((c) => [c.argv.join(" "), c.sudo])).toEqual([
      ["systemctl daemon-reload", true],
      ["systemctl enable --now runyard", true],
      ["systemctl restart runyard", true],
    ]);
  });

  test("systemd quoting keeps odd paths intact", () => {
    expect(systemdQuote('a "b" \\c 100%')).toBe('"a \\"b\\" \\\\c 100%%"');
    const plan = installPlan({ ...base, binary: "/opt/my $app/runyard" });
    expect(plan.files[0]!.content).toContain('ExecStart="/opt/my $$app/runyard"');
  });

  test("macOS: a LaunchAgent for the user, replacing a loaded copy", () => {
    const plan = installPlan({
      ...base,
      platform: "darwin",
      binary: "/Users/ci/bin/runyard",
      home: "/Users/ci",
      uid: 501,
      dataDir: "/Users/ci/Library/Application Support/Runyard",
      tailscale: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      env: { PATH: "/usr/bin:/bin", RUNYARD_ORIGIN: "https://a.example?x=1&y=<2>" },
    });
    const plist = plan.files[0]!;
    expect(plist.path).toBe("/Users/ci/Library/LaunchAgents/dev.runyard.plist");
    expect(plist.sudo).toBe(false);
    expect(plist.content).toContain("<string>/Users/ci/bin/runyard</string>");
    expect(plist.content).toContain("<string>https://a.example?x=1&amp;y=&lt;2&gt;</string>");
    expect(plist.content).toContain(
      "<string>/Applications/Tailscale.app/Contents/MacOS/Tailscale</string>",
    );
    expect(plist.content).toContain(
      "<string>/Users/ci/Library/Application Support/Runyard/runyard.log</string>",
    );
    expect(plan.commands.map((c) => c.argv.join(" "))).toEqual([
      "launchctl bootout gui/501/dev.runyard",
      "launchctl bootstrap gui/501 /Users/ci/Library/LaunchAgents/dev.runyard.plist",
    ]);
    expect(plan.commands[0]?.ignoreFailure).toBe(true);
  });

  test("Windows: a logon task with no time limit, started by a launcher holding the settings", () => {
    const plan = installPlan({
      ...base,
      platform: "win32",
      binary: "C:\\Users\\ci\\runyard.exe",
      user: "BOX\\ci",
      home: "C:\\Users\\ci",
      dataDir: "C:\\Users\\ci\\AppData\\Roaming\\Runyard",
      tailscale: null,
      env: { RUNYARD_ORIGIN: "https://it's.example" },
    });
    const launcher = plan.files[0]!;
    expect(launcher.content).toContain("$env:RUNYARD_ORIGIN = 'https://it''s.example'");
    expect(launcher.content).toContain("& 'C:\\Users\\ci\\runyard.exe' *>> ");
    const register = plan.commands[0]!.argv.at(-1)!;
    expect(register).toContain("New-ScheduledTaskTrigger -AtLogOn -User 'BOX\\ci'");
    expect(register).toContain("-ExecutionTimeLimit ([TimeSpan]::Zero)");
    expect(register).toContain("-LogonType Interactive");
    expect(register).not.toContain("-Password");
  });

  test("uninstall leaves the data directory alone", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const plan = uninstallPlan({ ...base, platform });
      expect(plan.commands.map((c) => c.argv.join(" ")).join("\n")).not.toContain(base.dataDir);
    }
  });

  test("other platforms are refused", () => {
    expect(() => installPlan({ ...base, platform: "freebsd" })).toThrow("can't install a service");
  });
});
