import { describe, expect, test } from "vite-plus/test";
import {
  evaluateReadiness,
  readinessProblems,
  type MachineReport,
  type ReadinessNeeds,
} from "../../src/index.ts";

const NOW = 1_800_000_000_000;
const report = (os: MachineReport["os"], facts: Record<string, string>) =>
  ({
    os,
    diagnostics: { readiness_complete: "1", epoch: String(NOW / 1000), ...facts },
  }) as unknown as MachineReport;
const none: ReadinessNeeds = { labels: [], forgejoHost: false };
const status = (r: ReturnType<typeof evaluateReadiness>, id: string) =>
  r?.items.find((i) => i.id === id)?.status;
const posixTools = Object.fromEntries(
  ["git", "curl", "tar", "unzip", "zip", "xz", "zstd", "jq", "gpg", "cc", "make", "python3"].map(
    (t) => [`tool_${t}`, `/usr/bin/${t}`],
  ),
);

describe("runner readiness", () => {
  test("a Mac shows whether Homebrew is there, without counting it as a problem", () => {
    const mac = (facts: Record<string, string>) =>
      evaluateReadiness(report("macos", { ...posixTools, xcode_clt: "/x", ...facts }), NOW, none);
    expect(status(mac({}), "homebrew")).toBe("warn");
    expect(mac({})?.items.find((i) => i.id === "homebrew")?.detail).toContain("brew.sh");
    expect(readinessProblems(mac({})).map((i) => i.id)).not.toContain("homebrew");
    expect(status(mac({ tool_brew: "/opt/homebrew/bin/brew" }), "homebrew")).toBe("ok");
    expect(status(evaluateReadiness(report("linux", posixTools), NOW, none), "homebrew")).toBe(
      undefined,
    );
  });

  test("waits for a check that collected it", () => {
    expect(
      evaluateReadiness({ os: "linux", diagnostics: {} } as unknown as MachineReport, NOW, none),
    ).toBeNull();
  });

  test("a bare Linux machine is missing what jobs need, with how to install it", () => {
    const r = evaluateReadiness(report("linux", { reach_0: "github.com 000" }), NOW, none);
    expect(readinessProblems(r).map((i) => i.id)).toEqual([
      "tool-git",
      "tool-curl",
      "tool-tar",
      "reach-github.com",
    ]);
    expect(r?.items.find((i) => i.id === "tool-git")?.command).toBe("sudo apt install -y git");
    expect(r?.items.find((i) => i.id === "tool-cc")).toMatchObject({
      tier: "recommended",
      status: "warn",
    });
    expect(r?.items.find((i) => i.id === "tool-cc")?.command).toContain("build-essential");
  });

  test("a ready machine has no problems; a drifting clock is one", () => {
    const ready = report("linux", {
      ...posixTools,
      reach_0: "github.com 301",
      docker_server: "27.1",
    });
    expect(readinessProblems(evaluateReadiness(ready, NOW, none))).toEqual([]);
    expect(evaluateReadiness(ready, NOW, none)?.capabilities).toEqual(["docker"]);
    const drifted = evaluateReadiness(ready, NOW + 600_000, none);
    expect(status(drifted, "clock")).toBe("missing");
    expect(status(evaluateReadiness(ready, NOW + 120_000, none), "clock")).toBe("warn");
  });

  test("Forgejo host mode needs Node; Macs need the Command Line Tools", () => {
    const linux = report("linux", posixTools);
    expect(
      status(evaluateReadiness(linux, NOW, { labels: [], forgejoHost: true }), "tool-node"),
    ).toBe("missing");
    const mac = evaluateReadiness(report("macos", posixTools), NOW, none);
    expect(status(mac, "xcode-clt")).toBe("missing");
    expect(mac?.items.find((i) => i.id === "xcode-clt")?.command).toBe("xcode-select --install");
  });

  test("labels are checked against what the machine has", () => {
    const mac = report("macos", {
      ...posixTools,
      xcode_clt: "/Applications/Xcode.app/Contents/Developer",
      xcode_version: "Xcode 16.2",
      docker_cli: "present",
    });
    const r = evaluateReadiness(mac, NOW, {
      labels: ["xcode", "Xcode-16", "xcode-15", "docker", "gpu", "my-team"],
      forgejoHost: false,
    });
    expect(r?.items.filter((i) => i.tier === "label").map((i) => [i.id, i.status])).toEqual([
      ["label-xcode", "ok"],
      ["label-xcode-16", "ok"],
      ["label-xcode-15", "missing"],
      ["label-docker", "missing"],
      ["label-gpu", "missing"],
    ]);
    expect(r?.items.find((i) => i.id === "docker")?.value).toBe(
      "Installed, not usable by this account",
    );
    expect(r?.capabilities).toEqual(["xcode-16"]);
  });
});
