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

  test("Windows names what stands in for each tool, installs with winget, and flags one account's tools", () => {
    const r = evaluateReadiness(
      report("windows", {
        tool_git: "C:\\Program Files\\Git\\cmd\\git.exe",
        tool_curl: "C:\\Windows\\System32\\curl.exe",
        tool_jq_account: "C:\\Users\\ci\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe",
      }),
      NOW,
      none,
    );
    const item = (id: string) => r?.items.find((i) => i.id === id);
    expect(item("tool-tar")).toMatchObject({
      status: "missing",
      detail: expect.stringContaining("comes with Windows"),
    });
    expect(item("tool-tar")?.command).toBeUndefined();
    expect(item("tool-unzip")).toMatchObject({
      title: "unzip (7-Zip)",
      command: "winget install -e --id 7zip.7zip --scope machine",
    });
    expect(item("tool-cc")?.title).toBe("C compiler (gcc)");
    expect(item("tool-python3")).toMatchObject({
      title: "Python 3 (python, from uv)",
      detail: expect.stringContaining("installs Python 3.13 with uv"),
    });
    expect(item("tool-python3")?.command).toBeUndefined();
    expect(item("tool-jq")).toMatchObject({
      status: "warn",
      value: "Only for this account",
      detail: expect.stringContaining("install it for every account"),
      command: "winget install -e --id jqlang.jq --scope machine",
    });
  });

  test("Windows says when the runner can't read a tool, and whether a review can fix it", () => {
    const r = (installs: string[]) =>
      evaluateReadiness(
        report("windows", {
          tool_jq: "C:\\Program Files\\WinGet\\Links\\jq.exe",
          tool_jq_runner: "fix:C:\\Program Files\\WinGet\\Packages\\jqlang.jq_x\\jq.exe",
          tool_xz: "C:\\Tools\\xz.exe",
          tool_xz_runner: "manual:C:\\Tools\\xz.exe",
        }),
        NOW,
        { ...none, installs },
      );
    const item = (installs: string[], id: string) => r(installs)?.items.find((i) => i.id === id);
    expect(item(["jq"], "tool-jq")).toMatchObject({
      status: "warn",
      value: "Runner can't run it",
      repairable: true,
      detail: expect.stringContaining("This machine's review fixes it."),
    });
    expect(item(["jq"], "tool-jq")?.command).toBeUndefined();
    // Not in a pool's tools: the person gets the command.
    expect(item([], "tool-jq")?.command).toContain('icacls "C:\\Program Files\\WinGet\\Packages');
    expect(item([], "tool-xz")).toMatchObject({
      value: "Runner can't run it",
      command: expect.stringContaining("icacls"),
    });
    expect(item([], "tool-xz")?.repairable).toBeUndefined();
  });

  test("Windows needs a PowerShell policy that lets the runner run its script files", () => {
    const policy = (ps_policy: string, ps_policy_source: string) =>
      evaluateReadiness(report("windows", { ps_policy, ps_policy_source }), NOW, none)?.items.find(
        (i) => i.id === "powershell-scripts",
      );
    expect(policy("RemoteSigned", "machine")).toMatchObject({
      status: "ok",
      value: "RemoteSigned",
    });
    expect(policy("Restricted", "default")).toMatchObject({
      tier: "required",
      status: "missing",
      value: "Restricted (Windows default)",
      command: "Set-ExecutionPolicy RemoteSigned -Scope LocalMachine",
    });
    const group = policy("AllSigned", "group");
    expect(group).toMatchObject({ status: "missing", value: "AllSigned (Group Policy)" });
    expect(group?.command).toBeUndefined();
    expect(
      evaluateReadiness(report("linux", {}), NOW, none)?.items.some(
        (i) => i.id === "powershell-scripts",
      ),
    ).toBe(false);
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

  test("a tool the pools install says so instead of how; an old Node.js warns", () => {
    const linux = report("linux", posixTools);
    const node = (r: ReturnType<typeof evaluateReadiness>) =>
      r?.items.find((i) => i.id === "tool-node");
    const installs = node(
      evaluateReadiness(linux, NOW, { labels: [], forgejoHost: true, installs: ["node"] }),
    );
    expect(installs?.status).toBe("missing");
    expect(installs?.command).toBeUndefined();

    expect(installs?.detail).toContain("This machine's review installs it.");

    const old = report("linux", {
      ...posixTools,
      tool_node: "/usr/bin/node",
      tool_node_version: "v18.19.0",
    });
    expect(node(evaluateReadiness(old, NOW, { labels: [], forgejoHost: true }))).toMatchObject({
      status: "warn",
      value: "Node 18.19.0",
    });
    const current = report("linux", {
      ...posixTools,
      tool_node: "/usr/bin/node",
      tool_node_version: "v20.19.2",
    });
    expect(
      status(evaluateReadiness(current, NOW, { labels: [], forgejoHost: true }), "tool-node"),
    ).toBe("ok");
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
