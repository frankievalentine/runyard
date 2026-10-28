import type { CommandResult } from "../command.ts";

type Dir = {
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
  received: { op: "probe" | "install" | "start" | "remove"; env: Record<string, string> }[] = [];
  /** Makes the next operation script fail with this output. */
  failNext: string | null = null;

  answer = (stdin: string): string | CommandResult => {
    if (stdin.includes("RF_PROBE_END")) {
      this.received.push({ op: "probe", env: {} });
      const paths = [...stdin.matchAll(/^path=(.+)$/gm)].map((m) => unquote(m[1]!));
      const rows = paths.map((path, i) => {
        const d = this.dirs.get(path);
        const service = d?.configured ? d.service : "missing";
        return `RF1\t${i}\t${d?.configured ? "true" : "false"}\t${service}\t${d?.configured ? "2.329.0" : ""}\t${d?.name ?? ""}`;
      });
      return `${rows.join("\n")}\nRF_PROBE_END\n`;
    }
    const env = Object.fromEntries(
      [...stdin.matchAll(/^export (RF_[A-Z_]+)=(.+)$/gm)].map((m) => [m[1]!, unquote(m[2]!)]),
    );
    const op = stdin.includes("RF_ASSET_URL")
      ? "install"
      : stdin.includes("RF_TOKEN")
        ? "remove"
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
