import { describe, expect, test } from "vite-plus/test";
import { evaluateDiagnostics, type MachineReport } from "../../src/index.ts";

function report(
  os: MachineReport["os"],
  diagnostics: Record<string, string>,
  disks: MachineReport["disks"] = [],
) {
  return {
    os,
    osVersion: null,
    cpuPercent: null,
    loadAverage: null,
    logicalCores: null,
    memoryTotalBytes: null,
    memoryAvailableBytes: null,
    uptimeSecs: null,
    bootId: null,
    disks,
    diagnostics,
    warnings: [],
  } satisfies MachineReport;
}

const byId = (r: MachineReport) => Object.fromEntries(evaluateDiagnostics(r).map((c) => [c.id, c]));

describe("evaluateDiagnostics", () => {
  test("a well-configured Mac passes the risky settings", () => {
    const checks = byId(
      report(
        "macos",
        {
          tailscale_install: "mac-standalone",
          tailscale_backend: "Running",
          ac_sleep: "0",
          ac_autorestart: "1",
        },
        [{ mountPoint: "/", totalBytes: 100, availableBytes: 50 }],
      ),
    );
    expect(checks["tailscale-state"]?.status).toBe("pass");
    expect(checks["tailscale-ssh"]).toMatchObject({ status: "info", value: "Not supported" });
    expect(checks["power-sleep"]).toMatchObject({ status: "pass", value: "Never" });
    expect(checks["power-recovery"]?.status).toBe("pass");
    expect(checks["disk-space"]?.status).toBe("pass");
  });

  test("warns about sleep, a stopped daemon and low disk", () => {
    const checks = byId(
      report("macos", { tailscale_backend: "Stopped", ac_sleep: "10", battery_sleep: "1" }, [
        { mountPoint: "/", totalBytes: 100, availableBytes: 5 },
      ]),
    );
    expect(checks["tailscale-state"]?.status).toBe("warn");
    expect(checks["power-sleep"]).toMatchObject({ status: "warn", value: "After 10 minutes" });
    expect(checks["power-sleep"]?.detail).toContain("Battery: after 1 minutes.");
    expect(checks["disk-space"]?.status).toBe("warn");
  });

  test("Linux sleep is blocked only when systemd masks it", () => {
    const masked = byId(report("linux", { target_sleep: "masked", idle_action: "suspend" }));
    expect(masked["power-sleep"]?.status).toBe("pass");
    expect(masked["power-idle"]?.status).toBe("info");
    const open = byId(report("linux", { target_sleep: "enabled", idle_action: "suspend" }));
    expect(open["power-sleep"]?.status).toBe("unknown");
    expect(open["power-idle"]?.status).toBe("warn");
  });

  test("a container leaves sleep to its host", () => {
    const lxc = byId(
      report("linux", { container: "lxc", target_sleep: "static", idle_action: "ignore" }),
    );
    expect(lxc["power-sleep"]).toMatchObject({
      status: "info",
      value: "Managed by the host (lxc container)",
    });
    expect(lxc["power-idle"]).toBeUndefined();
    const own = byId(report("linux", { container: "none", target_sleep: "masked" }));
    expect(own["power-sleep"]?.status).toBe("pass");
  });

  test("Windows reports unattended mode, startup and power plan settings", () => {
    const checks = byId(
      report("windows", {
        tailscale_unattended: "false",
        tailscale_startup: "Auto",
        ac_hibernate: "0",
        ac_lid: "1",
      }),
    );
    expect(checks["tailscale-unattended"]?.status).toBe("warn");
    expect(checks["tailscale-startup"]?.status).toBe("pass");
    expect(checks["power-hibernate"]?.status).toBe("pass");
    expect(checks["power-lid"]?.value).toBe("Sleep");
  });

  test("unread facts are unknown, not failures", () => {
    const checks = evaluateDiagnostics(report("linux", {}));
    expect(checks.every((c) => c.status === "unknown" || c.status === "info")).toBe(true);
  });
});
