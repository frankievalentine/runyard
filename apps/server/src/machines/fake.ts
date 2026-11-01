import type { CommandResult, CommandRunner } from "../command.ts";
import { TailscaleCli } from "../tailscale.ts";

type Answer =
  | string
  | CommandResult
  | ((stdin: string) => string | CommandResult | Promise<string | CommandResult>);

/**
 * A fake for everything the monitor runs: `tailscale status` answers with
 * `status`, and SSH sessions answer per target from `machines`. Records every
 * command line so tests can check what would have run.
 */
export class FakeMachines {
  status: object | string = { BackendState: "Running", Peer: {} };
  machines = new Map<string, Answer>();
  /** Host keys each host offers to ssh-keyscan, as `type base64` lines. */
  hostKeys = new Map<string, string[]>();
  /** What `ssh -G` reports for targets that a ~/.ssh/config would rename. */
  resolved = new Map<string, { hostname: string; port?: number; user?: string }>();
  calls: string[][] = [];

  /** What `tailscale funnel status --json` prints: nothing served, unless a test or the demo sets it. */
  funnel = "{}";
  readonly run: CommandRunner = async (argv, options) => {
    this.calls.push([...argv]);
    if (argv[1] === "-V") return { code: 0, stdout: "", stderr: "OpenSSH_9.9p2, LibreSSL 3.3.6\n" };
    if (argv[0] === "tailscale" && argv[1] === "funnel")
      return { code: 0, stdout: this.funnel, stderr: "" };
    if (argv[0] === "tailscale" && argv[1] === "status") {
      return {
        code: 0,
        stdout: typeof this.status === "string" ? this.status : JSON.stringify(this.status),
        stderr: "",
      };
    }
    if (argv[0] === "ssh-keyscan") {
      const host = argv.at(-1)!;
      const keys = this.hostKeys.get(host) ?? [];
      return keys.length
        ? { code: 0, stdout: keys.map((k) => `${host} ${k}\n`).join(""), stderr: "" }
        : { code: 1, stdout: "", stderr: `${host}: Connection refused` };
    }
    if (argv[0] === "ssh" && argv[1] === "-G") {
      const target = argv.at(-1)!;
      const at = target.lastIndexOf("@");
      const r = this.resolved.get(target);
      const lines = [
        `user ${r?.user ?? (at > 0 ? target.slice(0, at) : "runyard")}`,
        `hostname ${r?.hostname ?? target.slice(at + 1)}`,
        `port ${r?.port ?? 22}`,
      ];
      return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
    }
    const target = argv[0] === "tailscale" ? argv[2] : argv[argv.indexOf("--") + 1];
    const answer = target === undefined ? undefined : this.machines.get(target);
    if (answer === undefined)
      return { code: 255, stdout: "", stderr: `ssh: Could not resolve hostname ${target}` };
    const value = typeof answer === "function" ? await answer(options?.stdin ?? "") : answer;
    return typeof value === "string" ? { code: 0, stdout: value, stderr: "" } : value;
  };

  readonly tailscale = new TailscaleCli(this.run, "tailscale");
  readonly programs = { ssh: "ssh", tailscale: "tailscale", keyscan: "ssh-keyscan" };
}

/** A complete macOS report with the given free disk space, for tests. */
export function macReport(freeGiB = 300, bootId = "B1") {
  const gib = 1_073_741_824;
  return [
    "RFM\tos\tmacos",
    "RFM\tos_version\t15.6",
    "RFM\tcores\t12",
    "RFM\tcpu\t23.50",
    "RFM\tload\t1.5 2.0 0.8",
    "RFM\tmemory_total\t24000000000",
    "RFM\tmemory_available\t8000000000",
    "RFM\tuptime\t86400",
    `RFM\tboot_id\t${bootId}`,
    `RFM\tdisk\t/\t${500 * gib}\t${freeGiB * gib}`,
    "RFM_END",
    "RFM\tdiag:identity\tci",
    "RFM\tdiag:tailscale_backend\tRunning",
    "RFM\tdiag:complete\t1",
    "",
  ].join("\n");
}
