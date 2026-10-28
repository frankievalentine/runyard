/**
 * Runs Runyard against a fictional fleet: a fake runner answers `tailscale
 * status` and every SSH session, so nothing real is contacted. For UI work
 * and screenshots: `bun apps/server/scripts/demo.ts`, then open the URL and
 * enter the setup code it prints. Data lives in a fresh temporary directory.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Glob } from "bun";
import { createMachine, listMachines } from "../src/machines/store.ts";
import { FakeMachines, macReport } from "../src/machines/fake.ts";
import { start } from "../src/server.ts";

const GIB = 1_073_741_824;
process.env.RUNYARD_DATA_DIR ??= await mkdtemp(join(tmpdir(), "runyard-demo-"));
process.env.RUNYARD_TAILNET = "off";

const fake = new FakeMachines();
const node = (id: string, host: string, os: string, online: boolean, extra: object = {}) => ({
  ID: id,
  HostName: host,
  DNSName: `${host}.demo.ts.net.`,
  OS: os,
  TailscaleIPs: [`100.64.0.${id.length + host.length}`],
  Online: online,
  LastSeen: new Date(Date.now() - 42 * 60_000).toISOString(),
  ...extra,
});
fake.status = {
  BackendState: "Running",
  Self: { ID: "nControl", HostName: "control" },
  CurrentTailnet: { Name: "demo.example" },
  Peer: {
    a: node("nMini", "studio-mini", "macOS", true),
    b: node("nLinux", "linux-builder", "linux", true, {
      sshHostKeys: ["ssh-ed25519 AAAA"],
      Tags: ["tag:ci"],
    }),
    c: node("nWin", "win-builder", "windows", false),
    d: node("nPi", "lab-pi", "linux", true),
    e: node("nPhone", "pixel", "android", true),
  },
};

const linux = (freeGiB: number) =>
  [
    "RFM\tos\tlinux",
    "RFM\tos_version\tUbuntu 24.04.1 LTS",
    "RFM\tcores\t16",
    `RFM\tcpu\t${(40 + Math.random() * 30).toFixed(2)}`,
    "RFM\tload\t5.10 4.22 3.90",
    "RFM\tmemory_total\t67108864000",
    "RFM\tmemory_available\t21474836480",
    "RFM\tuptime\t1209600",
    "RFM\tboot_id\tL1",
    `RFM\tdisk\t/\t${500 * GIB}\t${freeGiB * GIB}`,
    "RFM_END",
    "RFM\tdiag:identity\tci",
    "RFM\tdiag:architecture\tx86_64",
    "RFM\tdiag:tailscale_install\tcli-daemon",
    "RFM\tdiag:tailscale_backend\tRunning",
    "RFM\tdiag:tailscale_ssh\ttrue",
    "RFM\tdiag:tailscale_startup\tenabled",
    "RFM\tdiag:target_sleep\tmasked",
    "RFM\tdiag:idle_action\tignore",
    "RFM\tdiag:complete\t1",
  ].join("\n");

fake.machines.set("ci@studio-mini.demo.ts.net", () =>
  macReport(180).replace("RFM\tcpu\t23.50", `RFM\tcpu\t${(10 + Math.random() * 20).toFixed(2)}`),
);
fake.machines.set("linux-builder.demo.ts.net", () => linux(22));
fake.machines.set("admin@lab-server.internal", {
  code: 255,
  stdout: "",
  stderr: "admin@lab-server.internal: Permission denied (publickey,password).",
});

// Serves the built dashboard when there is one (`vp run -r build`); otherwise use `vp run dev`.
const dist = resolve(import.meta.dir, "../../dashboard/dist");
const files = (await Bun.file(join(dist, "index.html")).exists())
  ? [...new Glob("**/*").scanSync({ cwd: dist, onlyFiles: true })]
  : [];
const dashboard = files.length ? new Map(files.map((f) => [`/${f}`, join(dist, f)])) : undefined;

const { db, monitor } = await start(dashboard, { run: fake.run, programs: fake.programs });
if (listMachines(db).length === 0) {
  createMachine(db, {
    name: "Studio mini",
    sshTarget: "ci@studio-mini.demo.ts.net",
    transport: "openssh",
    tailscaleNodeId: "nMini",
    expectedOs: "macos",
  });
  createMachine(db, {
    name: "Linux builder",
    sshTarget: "linux-builder.demo.ts.net",
    transport: "tailscale",
    tailscaleNodeId: "nLinux",
    expectedOs: "linux",
    description: "Primary Linux CI host",
  });
  createMachine(db, {
    name: "Windows builder",
    sshTarget: "ci@win-builder.demo.ts.net",
    transport: "openssh",
    tailscaleNodeId: "nWin",
    expectedOs: "windows",
  });
  createMachine(db, {
    name: "Lab server",
    sshTarget: "admin@lab-server.internal",
    transport: "openssh",
  });
}
// Check right away instead of waiting for the next minute-long round.
await monitor.checkNow();
console.log("Demo fleet: every answer is fake; nothing real is contacted.");
