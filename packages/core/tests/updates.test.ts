import { describe, expect, test } from "vite-plus/test";
import { isNewerVersion, updateSteps } from "../src/index.ts";

describe("isNewerVersion", () => {
  test("compares each part as a number", () => {
    expect(isNewerVersion("0.3.0", "0.4.0")).toBe(true);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.10.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "0.3.0")).toBe(false);
  });

  test("takes a tag's leading v", () => {
    expect(isNewerVersion("0.3.0", "v0.3.1")).toBe(true);
  });

  test("puts a prerelease before its release", () => {
    expect(isNewerVersion("0.4.0-rc.1", "0.4.0")).toBe(true);
    expect(isNewerVersion("0.4.0", "0.4.0-rc.1")).toBe(false);
    expect(isNewerVersion("0.4.0-rc.2", "0.4.0-rc.10")).toBe(true);
  });

  test("never calls something that isn't a version newer", () => {
    expect(isNewerVersion("0.3.0", "nightly")).toBe(false);
    expect(isNewerVersion("dev", "0.4.0")).toBe(false);
  });
});

describe("updateSteps", () => {
  const base = { version: "0.4.0", platform: "linux" };

  test("a service reinstalls into the running binary's folder, then restarts", () => {
    const steps = updateSteps({ ...base, kind: "service", binary: "/home/me/.local/bin/runyard" });
    expect(steps.command).toBe(
      "curl -fsSL https://frankievalentine.github.io/runyard/install.sh | RUNYARD_INSTALL_DIR='/home/me/.local/bin' sh && '/home/me/.local/bin/runyard' service install",
    );
  });

  test("quotes a folder with a quote in it", () => {
    const steps = updateSteps({ ...base, kind: "terminal", binary: "/opt/it's/runyard" });
    expect(steps.command).toContain(`RUNYARD_INSTALL_DIR='/opt/it'\\''s' sh`);
  });

  test("a Windows service stops before the binary is replaced", () => {
    const steps = updateSteps({
      ...base,
      platform: "win32",
      kind: "service",
      binary: "C:\\Users\\me\\AppData\\Local\\Programs\\Runyard\\runyard.exe",
    });
    expect(steps.command).toMatch(
      /^Stop-ScheduledTask -TaskName Runyard; \$env:RUNYARD_INSTALL_DIR=/,
    );
    expect(steps.command).toContain("install.ps1 | iex; & '");
  });

  test("Docker pulls the image and mentions a pinned version", () => {
    const steps = updateSteps({ ...base, kind: "docker", binary: "/usr/local/bin/runyard" });
    expect(steps.command).toContain("compose.yaml pull");
    expect(steps.note).toContain("set it to 0.4.0");
  });

  test("a checkout has no command", () => {
    expect(updateSteps({ ...base, kind: "source", binary: "/usr/bin/bun" }).command).toBeNull();
  });
});
