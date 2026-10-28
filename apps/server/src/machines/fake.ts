import type { CommandResult, CommandRunner } from "../command.ts";
import { TailscaleCli } from "../tailscale.ts";

type Answer = string | CommandResult | ((stdin: string) => string | CommandResult);

/**
 * A fake for everything the monitor runs: `tailscale status` answers with
 * `status`, and SSH sessions answer per target from `machines`. Records every
 * command line so tests can check what would have run.
 */
export class FakeMachines {
  status: object | string = { BackendState: "Running", Peer: {} };
  machines = new Map<string, Answer>();
  calls: string[][] = [];

  readonly run: CommandRunner = async (argv, options) => {
    this.calls.push([...argv]);
    if (argv[0] === "tailscale" && argv[1] === "status") {
      return {
        code: 0,
        stdout: typeof this.status === "string" ? this.status : JSON.stringify(this.status),
        stderr: "",
      };
    }
    const target = argv[0] === "tailscale" ? argv[2] : argv[argv.indexOf("--") + 1];
    const answer = target === undefined ? undefined : this.machines.get(target);
    if (answer === undefined)
      return { code: 255, stdout: "", stderr: `ssh: Could not resolve hostname ${target}` };
    const value = typeof answer === "function" ? answer(options?.stdin ?? "") : answer;
    return typeof value === "string" ? { code: 0, stdout: value, stderr: "" } : value;
  };

  readonly tailscale = new TailscaleCli(this.run, "tailscale");
  readonly programs = { ssh: "ssh", tailscale: "tailscale" };
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
