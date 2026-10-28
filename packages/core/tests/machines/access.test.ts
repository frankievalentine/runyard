import { describe, expect, test } from "vite-plus/test";
import { accessSteps, nextAccessStep, sshUser, type MachineView } from "../../src/index.ts";

const machine = (over: Partial<MachineView> = {}): MachineView =>
  ({
    id: "m1",
    name: "Builder",
    description: "",
    sshTarget: "ci@builder",
    transport: "openssh",
    os: "linux",
    tailnet: null,
    connection: { state: "pending" },
    health: null,
    diagnostics: null,
    alerts: [],
    maintenanceUntil: null,
    ...over,
  }) as MachineView;
const states = (m: MachineView) =>
  accessSteps(m, "ssh-ed25519 AAAA runyard@x").map((s) => [s.id, s.state]);

describe("getting into a machine over SSH", () => {
  test("each failure leaves off at the step SSH reached, in protocol order", () => {
    const failing = (problem: "connectionRefused" | "hostKeyUnknown" | "loginRefused") =>
      machine({ connection: { state: "error", detail: "x", problem } });
    expect(states(failing("connectionRefused"))).toEqual([
      ["sshServer", "current"],
      ["hostKey", "todo"],
      ["authorize", "todo"],
      ["connected", "todo"],
    ]);
    expect(states(failing("hostKeyUnknown")).map(([, s]) => s)).toEqual([
      "done",
      "current",
      "todo",
      "todo",
    ]);
    expect(states(failing("loginRefused")).map(([, s]) => s)).toEqual([
      "done",
      "done",
      "current",
      "todo",
    ]);
  });

  test("a machine that has connected once has every step done", () => {
    const m = machine({
      connection: { state: "stale", checkedAt: 1, reason: "x", problem: "unreachable" },
      health: {} as MachineView["health"],
    });
    expect(states(m).every(([, s]) => s === "done")).toBe(true);
    expect(nextAccessStep(m)).toBeNull();
  });

  test("commands follow the OS and carry Runyard's key; Windows admins get their own file", () => {
    const login = machine({
      os: "windows",
      connection: { state: "error", detail: "refused", problem: "loginRefused" },
    });
    const authorize = accessSteps(login, "ssh-ed25519 AAAA runyard@x").find(
      (s) => s.id === "authorize",
    )!;
    expect(authorize.commands.map((c) => c.text).join("\n")).toContain(
      "administrators_authorized_keys",
    );
    expect(authorize.commands[0]?.text).toContain("ssh-ed25519 AAAA runyard@x");
    expect(authorize.detail).toContain("as ci");
    const unknownOs = accessSteps(machine({ os: null }), null).find((s) => s.id === "sshServer")!;
    expect(unknownOs.commands).toHaveLength(3);
  });

  test("Tailscale SSH has no host key or key to authorize", () => {
    const m = machine({
      transport: "tailscale",
      connection: { state: "error", detail: "x", problem: "hostKeyUnknown" },
    });
    expect(states(m)).toEqual([
      ["sshServer", "current"],
      ["authorize", "todo"],
      ["connected", "todo"],
    ]);
  });

  test("an offline tailnet device is stuck at the start; the checklist names the step", () => {
    const m = machine({ connection: { state: "offline", lastSeen: null } });
    expect(nextAccessStep(m)?.id).toBe("sshServer");
    expect(nextAccessStep(m)?.detail).toContain("offline");
    expect(sshUser("ci@box")).toBe("ci");
    expect(sshUser("box")).toBeNull();
  });
});
