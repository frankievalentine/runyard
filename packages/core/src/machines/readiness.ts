import type { MachineReport, OsFamily } from "./model.ts";

/** How much an item matters: jobs fail without required ones; labels are what a pool promises. */
export type ReadinessTier = "required" | "recommended" | "label";
export type ReadinessStatus = "ok" | "missing" | "warn" | "unknown";

export type ReadinessItem = {
  id: string;
  tier: ReadinessTier;
  title: string;
  status: ReadinessStatus;
  value: string;
  /** What it's for, and how to get it when it's missing. */
  detail: string;
};

export type Readiness = {
  items: ReadinessItem[];
  /** Labels this machine can honestly carry, from what it has: docker, xcode-16, gpu. */
  capabilities: string[];
  /** macOS: Homebrew is installed, so Runyard can install tools with it. */
  homebrew: boolean;
};

/** What the machine's pools ask of it. */
export type ReadinessNeeds = {
  labels: string[];
  /** A Forgejo pool runs its jobs on the machine itself, where JavaScript actions need Node. */
  forgejoHost: boolean;
};

/** Clock drift past which TLS and runner tokens start failing. */
const DRIFT_WARN_SECS = 60;
const DRIFT_BAD_SECS = 300;

type Tool = { fact: string; title: string; why: string; apt?: string; brew?: string };

const POSIX_REQUIRED: Tool[] = [
  { fact: "git", title: "git", why: "Checkout and most build scripts use it." },
  { fact: "curl", title: "curl", why: "Actions and setup steps download with it." },
  { fact: "tar", title: "tar", why: "Caches, artifacts and tool downloads are tarballs." },
];
const POSIX_RECOMMENDED: Tool[] = [
  { fact: "unzip", title: "unzip", why: "Some actions and tools ship as zip files." },
  { fact: "zip", title: "zip", why: "Packaging steps often zip their output." },
  { fact: "xz", title: "xz", why: "Some toolchains ship as .tar.xz.", apt: "xz-utils" },
  { fact: "zstd", title: "zstd", why: "actions/cache compresses with it when present." },
  { fact: "jq", title: "jq", why: "Workflow scripts commonly parse JSON with it." },
  {
    fact: "gpg",
    title: "gpg",
    why: "Verifying downloads and signing.",
    apt: "gnupg",
    brew: "gnupg",
  },
  {
    fact: "cc",
    title: "C compiler",
    why: "Native modules and many builds compile C.",
    apt: "build-essential",
  },
  { fact: "make", title: "make", why: "Many builds run make.", apt: "build-essential" },
  { fact: "python3", title: "Python 3", why: "Many build tools and scripts need it." },
];
const NODE: Tool = {
  fact: "node",
  title: "Node.js",
  why: "forgejo-runner in host mode runs JavaScript actions (like actions/checkout) with the machine's Node.",
  apt: "nodejs",
  brew: "node",
};
const WINDOWS_REQUIRED: Tool[] = [
  { fact: "git", title: "git", why: "Checkout and most build scripts use it." },
  { fact: "curl", title: "curl", why: "Actions and setup steps download with it." },
  { fact: "tar", title: "tar", why: "Caches, artifacts and tool downloads are tarballs." },
];
const WINDOWS_RECOMMENDED: Tool[] = [
  { fact: "python", title: "Python", why: "Many build tools and scripts need it." },
];

function howToInstall(os: OsFamily, tool: Tool): string {
  if (os === "macos")
    return tool.fact === "git" || tool.fact === "cc" || tool.fact === "make"
      ? "Install the Command Line Tools: xcode-select --install"
      : `Install it with Homebrew: brew install ${tool.brew ?? tool.fact}`;
  if (os === "windows") return "Install it with winget or its installer.";
  return `Install it with your package manager, such as: sudo apt install -y ${tool.apt ?? tool.fact}`;
}

/**
 * Whether a machine has what CI jobs commonly need, from its last check:
 * required tools, a sane clock and the forges in reach, recommended tools,
 * and anything its pools' labels promise. Null until a check has collected
 * it. No I/O.
 */
export function evaluateReadiness(
  report: MachineReport,
  readAt: number,
  needs: ReadinessNeeds,
): Readiness | null {
  const facts = report.diagnostics;
  if (facts.readiness_complete !== "1") return null;
  const os = report.os;
  const has = (key: string) => Boolean(facts[key]);
  const items: ReadinessItem[] = [];
  const tool = (t: Tool, tier: ReadinessTier) =>
    items.push({
      id: `tool-${t.fact}`,
      tier,
      title: t.title,
      status: has(`tool_${t.fact}`) ? "ok" : tier === "required" ? "missing" : "warn",
      value: has(`tool_${t.fact}`)
        ? t.fact === "git" && facts.tool_git_version
          ? facts.tool_git_version
          : "Installed"
        : "Not found",
      detail: has(`tool_${t.fact}`) ? t.why : `${t.why} ${howToInstall(os, t)}`,
    });

  const windows = os === "windows";
  for (const t of windows ? WINDOWS_REQUIRED : POSIX_REQUIRED) tool(t, "required");
  if (os === "macos")
    items.push({
      id: "xcode-clt",
      tier: "required",
      title: "Command Line Tools",
      status: has("xcode_clt") ? "ok" : "missing",
      value: facts.xcode_clt || "Not installed",
      detail: has("xcode_clt")
        ? "git, clang and make for builds on macOS."
        : "git, clang and make for builds on macOS. Install them with xcode-select --install (it opens a dialog on the Mac).",
    });
  if (needs.forgejoHost) tool(NODE, "required");

  const epoch = Number(facts.epoch);
  if (Number.isFinite(epoch) && epoch > 0) {
    const drift = Math.round(Math.abs(epoch - readAt / 1000));
    items.push({
      id: "clock",
      tier: "required",
      title: "Clock",
      status: drift <= DRIFT_WARN_SECS ? "ok" : drift <= DRIFT_BAD_SECS ? "warn" : "missing",
      value: drift <= DRIFT_WARN_SECS ? "In sync" : `Off by ${drift} seconds`,
      detail:
        drift <= DRIFT_WARN_SECS
          ? "Within a minute of Runyard's clock."
          : "TLS and runner tokens fail when the clock drifts. Turn on network time (timedatectl set-ntp true on Linux).",
    });
  }

  for (const [key, value] of Object.entries(facts)) {
    if (!key.startsWith("reach_")) continue;
    const [host, code] = value.split(" ");
    if (!host) continue;
    const unknown = code === "unknown";
    const reached = Boolean(code) && code !== "000" && !unknown;
    items.push({
      id: `reach-${host}`,
      tier: "required",
      title: `Reaches ${host}`,
      status: unknown ? "unknown" : reached ? "ok" : "missing",
      value: unknown ? "Not checked" : reached ? "Yes" : "No",
      detail: unknown
        ? "Checked with curl, which isn't installed."
        : reached
          ? "Runners talk to the forge over HTTPS."
          : `Runners can't take jobs without reaching ${host} over HTTPS. Check the machine's DNS, firewall and proxy.`,
    });
  }

  for (const t of windows ? WINDOWS_RECOMMENDED : POSIX_RECOMMENDED) tool(t, "recommended");
  const dockerOk = has("docker_server");
  items.push({
    id: "docker",
    tier: "recommended",
    title: "Docker",
    status: dockerOk ? "ok" : "warn",
    value: dockerOk
      ? `Engine ${facts.docker_server}`
      : has("docker_cli")
        ? "Installed, not usable by this account"
        : "Not installed",
    detail: dockerOk
      ? "Container jobs, service containers and Docker builds can run."
      : has("docker_cli")
        ? "The daemon isn't running, or this account isn't in the docker group."
        : "Needed for container jobs (container:, services:), Docker builds and Forgejo's Docker mode.",
  });

  const capabilities: string[] = [];
  if (dockerOk) capabilities.push("docker");
  const xcode = /^Xcode (\d+)(?:\.(\d+))?/.exec(facts.xcode_version ?? "");
  if (xcode) capabilities.push(`xcode-${xcode[1]}`);
  if (has("nvidia_gpu")) capabilities.push("gpu");

  for (const label of new Set(needs.labels.map((l) => l.toLowerCase()))) {
    const rule = labelRule(label, facts, dockerOk);
    if (rule)
      items.push({
        id: `label-${label}`,
        tier: "label",
        title: `Label ${label}`,
        status: rule.ok ? "ok" : "missing",
        value: rule.value,
        detail: rule.ok
          ? `A pool gives this machine ${label}, and it has ${rule.what}.`
          : `A pool gives this machine ${label}, but it doesn't have ${rule.what}. Jobs asking for ${label} would fail here.`,
      });
  }
  return { items, capabilities, homebrew: has("tool_brew") };
}

/** What a known label promises, checked against the facts; null for labels Runyard can't check. */
function labelRule(
  label: string,
  facts: Record<string, string>,
  dockerOk: boolean,
): { ok: boolean; value: string; what: string } | null {
  if (label === "docker")
    return {
      ok: dockerOk,
      value: dockerOk ? "Docker works" : "No usable Docker",
      what: "a usable Docker",
    };
  const xcode = /^xcode(?:-(\d+(?:\.\d+)?))?$/.exec(label);
  if (xcode) {
    const installed = /^Xcode (\S+)/.exec(facts.xcode_version ?? "")?.[1] ?? null;
    const wanted = xcode[1];
    const ok =
      installed !== null && (!wanted || installed === wanted || installed.startsWith(`${wanted}.`));
    return {
      ok,
      value: installed ? `Xcode ${installed}` : "No Xcode",
      what: wanted ? `Xcode ${wanted}` : "Xcode",
    };
  }
  if (label === "gpu" || label === "cuda" || label === "nvidia")
    return {
      ok: Boolean(facts.nvidia_gpu),
      value: facts.nvidia_gpu || "No NVIDIA GPU found",
      what: "an NVIDIA GPU with nvidia-smi",
    };
  return null;
}

/** The items that keep a machine from serving its pools. */
export function readinessProblems(readiness: Readiness | null): ReadinessItem[] {
  return (readiness?.items ?? []).filter(
    (i) =>
      (i.tier === "required" || i.tier === "label") &&
      (i.status === "missing" || i.status === "warn"),
  );
}
