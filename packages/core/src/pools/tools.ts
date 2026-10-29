import type { OsFamily } from "../machines/model.ts";
import type { Readiness } from "../machines/readiness.ts";

/** Tools a pool can have installed on its machines, as the readiness check names them. */
export type ToolId =
  | "git"
  | "curl"
  | "tar"
  | "unzip"
  | "zip"
  | "xz"
  | "zstd"
  | "jq"
  | "gpg"
  | "cc"
  | "make"
  | "python3"
  | "docker";

export type ToolProfile = "essentials" | "build" | "docker";

export const TOOL_PROFILES: Record<
  ToolProfile,
  { title: string; detail: string; tools: ToolId[] }
> = {
  essentials: {
    title: "Essentials",
    detail: "git, curl, tar, unzip, zip, xz, zstd, jq and gpg.",
    tools: ["git", "curl", "tar", "unzip", "zip", "xz", "zstd", "jq", "gpg"],
  },
  build: {
    title: "Build tools",
    detail: "A C compiler, make and Python 3.",
    tools: ["cc", "make", "python3"],
  },
  docker: {
    title: "Docker",
    detail:
      "Docker Engine from the distribution's packages, running, with the runner's account in the docker group. Linux only.",
    tools: ["docker"],
  },
};

export const TOOL_IDS = new Set<string>(Object.values(TOOL_PROFILES).flatMap((p) => p.tools));

/** The tools a set of profiles calls for, in profile order. */
export function profileTools(profiles: readonly ToolProfile[]): ToolId[] {
  return [...new Set(profiles.flatMap((p) => TOOL_PROFILES[p]?.tools ?? []))];
}

/** Whether the last readiness check found a tool. */
export function hasTool(readiness: Readiness, tool: ToolId): boolean {
  const id = tool === "docker" ? "docker" : `tool-${tool}`;
  return readiness.items.some((i) => i.id === id && i.status === "ok");
}

/** Tools that come with the Command Line Tools on a Mac rather than Homebrew. */
const MAC_CLT: ReadonlySet<ToolId> = new Set(["git", "cc", "make", "python3"]);

/** How a machine's missing tools can be installed: what Runyard can do, and what needs a person. */
export function toolInstallPlan(
  os: OsFamily,
  readiness: Readiness,
  wanted: readonly ToolId[],
): { install: ToolId[]; blocked: { tools: ToolId[]; reason: string }[] } {
  const missing = wanted.filter((t) => !hasTool(readiness, t));
  if (missing.length === 0) return { install: [], blocked: [] };
  if (os === "linux") return { install: missing, blocked: [] };
  if (os !== "macos")
    return {
      install: [],
      blocked: [{ tools: missing, reason: "Tool profiles install on Linux and macOS for now." }],
    };
  const blocked: { tools: ToolId[]; reason: string }[] = [];
  const clt = missing.filter((t) => MAC_CLT.has(t));
  if (clt.length)
    blocked.push({
      tools: clt,
      reason:
        "These come with the Command Line Tools. Install them on the Mac with xcode-select --install (it opens a dialog).",
    });
  if (missing.includes("docker"))
    blocked.push({
      tools: ["docker"],
      reason: "Docker on a Mac needs Docker Desktop, OrbStack or colima; install one by hand.",
    });
  const brewable = missing.filter((t) => !MAC_CLT.has(t) && t !== "docker");
  if (brewable.length && !readiness.homebrew) {
    blocked.push({
      tools: brewable,
      reason:
        'Runyard installs these with Homebrew, which isn\'t installed. Install it on the Mac first: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    });
    return { install: [], blocked };
  }
  return { install: brewable, blocked };
}
