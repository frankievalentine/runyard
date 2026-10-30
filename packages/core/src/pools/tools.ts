import type { OsFamily } from "../machines/model.ts";
import type { Readiness } from "../machines/readiness.ts";
import type { ForgeKind } from "../model.ts";
import type { Pool } from "./model.ts";

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
  | "docker"
  | "node";

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
      "Docker Engine from your distribution's packages, with the runner's account in the docker group. Linux only.",

    tools: ["docker"],
  },
};

export const TOOL_IDS = new Set<string>([
  ...Object.values(TOOL_PROFILES).flatMap((p) => p.tools),
  "node",
]);

/** The tools a set of profiles calls for, in profile order. */
export function profileTools(profiles: readonly ToolProfile[]): ToolId[] {
  return [...new Set(profiles.flatMap((p) => TOOL_PROFILES[p]?.tools ?? []))];
}

/** A tool as people know it, for review lines: Node.js rather than its command. */
export const toolName = (tool: ToolId): string => (tool === "node" ? "Node.js" : tool);

/** A tool a pool's runners can't do without, and why. */

export type RequiredTool = { tool: ToolId; title: string; why: string };

/**
 * What a pool needs on its machines because of how its runners run, whatever
 * its tool profiles: Node.js for Forgejo jobs on the machine (JavaScript
 * actions run with it), Docker for Forgejo jobs in containers. Given a
 * machine's operating system, only what applies there: forgejo-runner runs on
 * Linux only.
 */
export function poolRequiredTools(
  pool: Pick<Pool, "scopes" | "forgejoMode">,
  forgeKinds: ReadonlyMap<string, ForgeKind>,
  os?: OsFamily | null,
): RequiredTool[] {
  if (!pool.scopes.some((s) => forgeKinds.get(s.forgeId) === "forgejo")) return [];
  if (os && os !== "linux") return [];
  return pool.forgejoMode.kind === "host"
    ? [{ tool: "node", title: "Node.js", why: "for Forgejo jobs on the machine" }]
    : [{ tool: "docker", title: "Docker", why: "for Forgejo jobs in containers" }];
}

/** Every tool a pool's machines' reviews install where missing: its profiles' and its runners' needs. */
export function poolTools(
  pool: Pick<Pool, "scopes" | "forgejoMode" | "toolProfiles">,
  forgeKinds: ReadonlyMap<string, ForgeKind>,
  os?: OsFamily | null,
): ToolId[] {
  return [
    ...new Set([
      ...profileTools(pool.toolProfiles),
      ...poolRequiredTools(pool, forgeKinds, os).map((r) => r.tool),
    ]),
  ];
}

/**
 * Whether the last readiness check found a tool. Docker counts only when it's
 * usable; another tool counts once found, even with a warning (an old Node.js),
 * since installing it again wouldn't change that.
 */
export function hasTool(readiness: Readiness, tool: ToolId): boolean {
  const id = tool === "docker" ? "docker" : `tool-${tool}`;
  const item = readiness.items.find((i) => i.id === id);
  if (!item) return false;
  return item.status === "ok" || (tool !== "docker" && item.value !== "Not found");
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
        "Install the Command Line Tools on the Mac: xcode-select --install (it opens a dialog).",
    });
  if (missing.includes("docker"))
    blocked.push({
      tools: ["docker"],
      reason: "Install Docker Desktop, OrbStack or colima.",
    });
  const brewable = missing.filter((t) => !MAC_CLT.has(t) && t !== "docker");
  if (brewable.length && !readiness.homebrew) {
    blocked.push({
      tools: brewable,
      reason: "Runyard installs these with Homebrew. Install it from brew.sh first.",
    });
    return { install: [], blocked };
  }
  return { install: brewable, blocked };
}
