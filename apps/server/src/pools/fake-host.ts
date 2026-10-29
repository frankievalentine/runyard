import type { CommandResult } from "../command.ts";

type Dir = {
  cleanup?: string;
  /** Runyard's job hooks are set up, as cleanup-configure leaves them. */
  history?: boolean;
  configured: boolean;
  service: "active" | "inactive" | "uninstalled";
  name: string | null;
};

/**
 * A stand-in for a machine that runs Runyard's runner scripts. It reads the
 * real scripts sent over SSH stdin: answers probes for the paths they list,
 * and applies install, start and remove to an in-memory set of directories.
 * Records each script's RF_* values so tests can check what was sent.
 */
export class FakeRunnerHost {
  dirs = new Map<string, Dir>();
  received: {
    op:
      | "probe"
      | "install"
      | "start"
      | "remove"
      | "configure"
      | "template-probe"
      | "jit-log"
      | "template-install"
      | "template-remove"
      | "jit-start"
      | "sweep"
      | "tools-install"
      | "cleanup-configure";
    env: Record<string, string>;
  }[] = [];
  /** Installed templates by path, with their version. */
  templates = new Map<string, string>();
  /** One-job runners started, by name: alive until a test ends them. */
  jobs = new Map<string, "alive" | "exited">();
  /** Kept one-job runner logs, by runner name. */
  logs = new Map<string, string>();
  /** Makes the next operation script fail with this output. */
  failNext: string | null = null;

  answer = (stdin: string): string | CommandResult => {
    if (stdin.includes("RT_END")) {
      this.received.push({ op: "template-probe", env: {} });
      const paths = [...stdin.matchAll(/^path=(.+)$/gm)].map((m) => unquote(m[1]!));
      const rows = paths.map((p, i) => {
        const version = this.templates.get(p);
        return `RT\t${i}\t${version ? "true" : "false"}\t${version ?? ""}`;
      });
      return `${rows.join("\n")}\nRT_END\n`;
    }
    if (stdin.includes("RJ_END")) {
      this.received.push({ op: "sweep", env: {} });
      const rows = [...this.jobs].map(([name, state]) => `RJ\t${state}\t${name}`);
      for (const [name, state] of this.jobs) if (state === "exited") this.jobs.delete(name);
      return `${rows.join("\n")}\nRJ_END\n`;
    }
    if (stdin.includes("No log for")) {
      const name = /^export RF_NAME=(.+)$/m.exec(stdin)?.[1];
      const log = name ? this.logs.get(unquote(name)) : undefined;
      this.received.push({ op: "jit-log", env: {} });
      return log ?? { code: 4, stdout: "", stderr: `No log for ${name} on this machine.` };
    }
    if (stdin.includes("RF_PROBE_END")) {
      this.received.push({ op: "probe", env: {} });
      const paths = [...stdin.matchAll(/^path=(.+)$/gm)].map((m) => unquote(m[1]!));
      const rows = paths.map((path, i) => {
        const d = this.dirs.get(path);
        const service = d?.configured ? d.service : "missing";
        return `RF1\t${i}\t${d?.configured ? "true" : "false"}\t${service}\t${d?.configured ? "2.329.0" : ""}\t${d?.name ?? ""}\t${d?.cleanup ?? ""}\t${d?.history ? "1" : ""}`;
      });
      return `${rows.join("\n")}\nRF_PROBE_END\n`;
    }
    const env = Object.fromEntries(
      [...stdin.matchAll(/^export (RF_[A-Z_]+)=(.+)$/gm)].map((m) => [m[1]!, unquote(m[2]!)]),
    );
    if ("RF_CLEANUP" in env) {
      this.received.push({ op: "cleanup-configure", env });
      const dir = this.dirs.get(env.RF_ROOT!);
      if (dir) {
        dir.cleanup = env.RF_CLEANUP === "off" ? "" : env.RF_CLEANUP;
        dir.history = true;
      }
      return `cleanup ${env.RF_CLEANUP}`;
    }
    if ("RF_TOOLS" in env) {
      this.received.push({ op: "tools-install", env });
      return `Installed: ${env.RF_TOOLS}`;
    }
    if ("RF_JOB_DIR" in env) {
      this.received.push({ op: "jit-start", env });
      if (this.failNext) {
        const output = this.failNext;
        this.failNext = null;
        return { code: 1, stdout: "", stderr: output };
      }
      this.jobs.set(env.RF_NAME!, "alive");
      return `started ${env.RF_NAME}`;
    }
    if ("RF_KIND" in env || stdin.includes("isn't a Runyard template")) {
      const op = "RF_KIND" in env ? "template-install" : "template-remove";
      this.received.push({ op, env });
      if (this.failNext) {
        const output = this.failNext;
        this.failNext = null;
        return { code: 1, stdout: "", stderr: output };
      }
      if (op === "template-install") this.templates.set(env.RF_ROOT!, env.RF_VERSION!);
      else this.templates.delete(env.RF_ROOT!);
      return `${op} ${env.RF_ROOT}`;
    }
    // forgejo-remove carries no token, so its rename of .runner identifies it.
    const op =
      "RF_ASSET_URL" in env || "RF_BINARY_URL" in env
        ? "install"
        : "RF_TOKEN" in env || stdin.includes(".runner.removed")
          ? "remove"
          : stdin.includes(".runner.new")
            ? "configure"
            : "start";
    this.received.push({ op, env });
    if (this.failNext) {
      const output = this.failNext;
      this.failNext = null;
      return { code: 1, stdout: "", stderr: output };
    }
    const path = env.RF_ROOT!;
    if (op === "install")
      this.dirs.set(path, { configured: true, service: "active", name: env.RF_NAME! });
    if (op === "start") this.dirs.get(path)!.service = "active";
    if (op === "remove")
      this.dirs.set(path, { configured: false, service: "uninstalled", name: null });
    return `${op} ${env.RF_NAME}`;
  };
}

/** `"$HOME"/'a/b'` → `~/a/b`, and `'x'` → `x`, matching how Runyard quotes values. */
function unquote(value: string): string {
  if (value.startsWith('"$HOME"/')) return `~/${unquote(value.slice(8))}`;
  if (value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replace(/'\\''/g, "'");
  return value;
}
