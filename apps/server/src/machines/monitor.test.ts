import { describe, expect, test } from "bun:test";
import { openDatabase } from "../db/index.ts";
import { FakeMachines, macReport } from "./fake.ts";
import { MachineMonitor } from "./monitor.ts";
import { OPENSSH_OPTIONS } from "./ssh.ts";
import { createMachine, listEvents, updateMachine } from "./store.ts";

function setup() {
  const db = openDatabase(":memory:");
  const fake = new FakeMachines();
  const clock = { now: 1_000_000 };
  const monitor = new MachineMonitor({
    db,
    run: fake.run,
    programs: fake.programs,
    tailscale: fake.tailscale,
    now: () => clock.now,
  });
  return { db, fake, clock, monitor };
}

const peers = (online: boolean) => ({
  BackendState: "Running",
  Self: { ID: "self" },
  Peer: {
    a: {
      ID: "n1",
      HostName: "mini",
      DNSName: "mini.tail1.ts.net.",
      OS: "macOS",
      TailscaleIPs: ["100.64.0.2"],
      Online: online,
    },
  },
});

describe("MachineMonitor", () => {
  test("checks a machine over hardened OpenSSH and publishes its health", async () => {
    const { db, fake, monitor } = setup();
    const machine = createMachine(db, { name: "Mini", sshTarget: "ci@mini", transport: "openssh" });
    fake.machines.set("ci@mini", macReport());
    const views: unknown[] = [];
    monitor.subscribe((v) => views.push(v));
    await monitor.checkMachines();

    const ssh = fake.calls.find((c) => c[0] === "ssh")!;
    expect(ssh).toEqual([
      "ssh",
      ...OPENSSH_OPTIONS,
      "-o",
      "ConnectTimeout=15",
      "--",
      "ci@mini",
      "bash -s",
    ]);
    const view = monitor.view.machines[0]!;
    expect(view).toMatchObject({ id: machine.id, os: "macos", connection: { state: "connected" } });
    expect(view.health).toMatchObject({ cpuPercent: 23.5, stale: false });
    expect(view.diagnostics?.checks.find((c) => c.id === "ssh-identity")?.value).toBe("ci");
    expect(views.length).toBeGreaterThan(0);
    expect(listEvents(db, { limit: 10 }).map((e) => e.kind)).toEqual(["monitoringStarted"]);
  });

  test("keeps the last report and shows the failure when a check fails", async () => {
    const { db, fake, clock, monitor } = setup();
    createMachine(db, { name: "Mini", sshTarget: "ci@mini", transport: "openssh" });
    fake.machines.set("ci@mini", macReport());
    await monitor.checkMachines();
    fake.machines.set("ci@mini", {
      code: 255,
      stdout: "",
      stderr: "ci@mini: Permission denied (publickey).",
    });
    clock.now += 60_000;
    await monitor.checkMachines();
    const view = monitor.view.machines[0]!;
    expect(view.connection).toMatchObject({ state: "stale" });
    expect(view.connection.state === "stale" && view.connection.reason).toContain(
      "SSH refused the login",
    );
    expect(view.health?.stale).toBe(true);
    expect(listEvents(db, { limit: 10 })[0]?.kind).toBe("sshUnavailable");
  });

  test("skips offline tailnet peers and uses tailscale ssh for Tailscale SSH machines", async () => {
    const { db, fake, monitor } = setup();
    createMachine(db, {
      name: "Mini",
      sshTarget: "mini.tail1.ts.net",
      transport: "tailscale",
      tailscaleNodeId: "n1",
    });
    fake.status = peers(false);
    fake.machines.set("mini.tail1.ts.net", macReport());
    await monitor.pollTailnet();
    await monitor.checkMachines();
    expect(fake.calls.some((c) => c[1] === "ssh")).toBe(false);
    expect(monitor.view.machines[0]?.connection.state).toBe("offline");

    fake.status = peers(true);
    await monitor.pollTailnet();
    await monitor.checkMachines();
    expect(fake.calls.find((c) => c[1] === "ssh")).toEqual([
      "tailscale",
      "ssh",
      "mini.tail1.ts.net",
      "bash -s",
    ]);
  });

  test("talks PowerShell to Windows machines, with the script as one base64 line", async () => {
    const { db, fake, monitor } = setup();
    createMachine(db, {
      name: "Win",
      sshTarget: "ci@win",
      transport: "openssh",
      expectedOs: "windows",
    });
    let stdin = "";
    fake.machines.set("ci@win", (input) => {
      stdin = input;
      return "RFM\tos\twindows\r\nRFM\tdisk\tC:\\\t100\t50\r\nRFM_END\r\n";
    });
    await monitor.checkMachines();
    const ssh = fake.calls.find((c) => c[0] === "ssh")!;
    expect(ssh.at(-1)).toStartWith("powershell.exe -NoLogo");
    expect(stdin.trim()).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(stdin.trim(), "base64").toString()).toContain("Win32_OperatingSystem");
    expect(monitor.view.machines[0]?.health?.disks[0]?.mountPoint).toBe("C:\\");
  });

  test("raises and records a low-disk alert across distinct readings", async () => {
    const { db, fake, clock, monitor } = setup();
    createMachine(db, { name: "Mini", sshTarget: "ci@mini", transport: "openssh" });
    fake.machines.set("ci@mini", macReport(10));
    await monitor.checkMachines();
    clock.now += 60_000;
    await monitor.checkMachines();
    expect(monitor.view.alerts).toMatchObject([{ kind: "lowDisk", machineName: "Mini" }]);
    expect(listEvents(db, { limit: 1 })[0]?.kind).toBe("lowDisk");
  });

  test("baselines survive a restart; a new SSH target restarts them", async () => {
    const { db, fake, monitor } = setup();
    const machine = createMachine(db, { name: "Mini", sshTarget: "ci@mini", transport: "openssh" });
    fake.machines.set("ci@mini", macReport(300, "B1"));
    await monitor.checkMachines();

    const restarted = new MachineMonitor({
      db,
      run: fake.run,
      programs: fake.programs,
      tailscale: fake.tailscale,
    });
    fake.machines.set("ci@mini", macReport(300, "B2"));
    await restarted.checkMachines();
    expect(listEvents(db, { limit: 10 }).map((e) => e.kind)).toEqual([
      "rebooted",
      "monitoringStarted",
    ]);

    updateMachine(db, machine.id, { sshTarget: "ci@mini2" });
    restarted.configChanged();
    expect(listEvents(db, { limit: 1 })[0]?.kind).toBe("targetChanged");
  });

  test("maintenance mutes alerts and is recorded", async () => {
    const { db, monitor } = setup();
    const machine = createMachine(db, { name: "Mini", sshTarget: "ci@mini", transport: "openssh" });
    monitor.setMaintenance(machine.id, true);
    expect(monitor.view.machines[0]?.maintenanceUntil).toBe(1_000_000 + 60 * 60_000);
    expect(listEvents(db, { limit: 1 })[0]?.kind).toBe("maintenanceStarted");
  });

  test("a tailnet that can't be read is reported without dropping the last snapshot", async () => {
    const { fake, monitor } = setup();
    fake.status = peers(true);
    await monitor.pollTailnet();
    fake.status = { BackendState: "Stopped" };
    await monitor.pollTailnet();
    monitor.tick();
    expect(monitor.view.tailnet.error).toContain("not connected");
  });
});
