import { Hono, type Context } from "hono";
import { z } from "zod";
import windowsScript from "../../scripts/machine-setup.ps1" with { type: "text" };
import windowsTeardown from "../../scripts/machine-teardown.ps1" with { type: "text" };
import posixTeardown from "../../scripts/machine-teardown.sh" with { type: "text" };
import posixScript from "../../scripts/machine-setup.sh" with { type: "text" };
import { requestOrigin, requireAdmin, type AppEnv, type Listener } from "../auth/identity.ts";
import type { FailureLimiter } from "../auth/rate-limit.ts";
import type { Db } from "../db/index.ts";
import { knownHostsName, type HostKeys } from "../machines/host-keys.ts";
import { parsePublicKey, runyardPublicKey, type RunyardSsh } from "../machines/keys.ts";
import type { MachineMonitor } from "../machines/monitor.ts";
import type { MachineSetupCodes } from "../machines/setup-codes.ts";
import { getMachine, updateMachine } from "../machines/store.ts";
import { json } from "./validate.ts";

/** Only an HTTPS origin with a plain host goes into the scripts. */
export const HTTPS_ORIGIN = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** A machine's setup commands for one code. */
export function setupCommands(
  origin: string,
  { code, expiresAt }: { code: string; expiresAt: number },
) {
  return {
    posix: `curl -fsSL ${origin}/api/machine-setup/script.sh | sh -s -- ${code}`,
    // A fresh Linux machine, as root: also creates the account and installs the SSH server.
    prepare: `curl -fsSL ${origin}/api/machine-setup/script.sh | sh -s -- ${code} --prepare`,
    windows: `& ([scriptblock]::Create((irm ${origin}/api/machine-setup/script.ps1))) ${code}`,
    expiresAt,
  };
}
const LIMIT_KEY = "machine-setup";

export type MachineSetupDeps = {
  db: Db;
  listener: Listener;
  monitor: MachineMonitor;
  limiter: FailureLimiter;
  ssh: RunyardSsh;
  hostKeys: HostKeys;
  machineSetup: MachineSetupCodes;
};

/**
 * The one-line setup command: a machine runs Runyard's script with a
 * single-use code, which authorizes Runyard's key there and reports the
 * account, OS and host keys back. Only over HTTPS, where the script and the
 * report can't be changed in transit.
 */
export function machineSetupRoutes(deps: MachineSetupDeps) {
  const { db, listener, monitor, limiter, ssh, hostKeys, machineSetup } = deps;
  const httpsOrigin = (c: Context) => {
    try {
      const { origin } = requestOrigin(c, listener);
      return HTTPS_ORIGIN.test(origin) ? origin : null;
    } catch {
      return null;
    }
  };
  const script = async (c: Context, template: string, type: string) => {
    const origin = httpsOrigin(c);
    const key = await runyardPublicKey(ssh);
    if (!origin || !key)
      return c.text(
        type === "ps1"
          ? "Write-Error 'Runyard serves this script over HTTPS only.'; exit 1\n"
          : "echo 'Runyard serves this script over HTTPS only.' >&2; exit 1\n",
        200,
      );
    // Both values are plain: the origin matches HTTPS_ORIGIN, and the key's comment is kept safe.
    const body = template
      .replaceAll("__RUNYARD_ORIGIN__", origin)
      .replaceAll("__RUNYARD_KEY__", key.line);
    return c.text(body, 200, { "Cache-Control": "no-store" });
  };

  return (
    new Hono<AppEnv>()
      .post("/machines/:id/setup-command", requireAdmin(), async (c) => {
        const machine = getMachine(db, c.req.param("id"));
        if (!machine) return c.json({ error: "No such machine." }, 404);
        const origin = httpsOrigin(c);
        if (!origin)
          return c.json(
            {
              error:
                "The setup command needs Runyard's HTTPS address, such as its tailnet URL. Open the dashboard there, or follow the steps by hand.",
            },
            400,
          );
        if (!(await runyardPublicKey(ssh)))
          return c.json({ error: "Runyard has no SSH key of its own; see Getting started." }, 400);
        return c.json(setupCommands(origin, machineSetup.issue(machine.id)));
      })
      .get("/machine-setup/script.sh", (c) => script(c, posixScript, "sh"))
      .get("/machine-setup/script.ps1", (c) => script(c, windowsScript, "ps1"))
      // The reverse: removes Runyard's key and what setup left, once its runners are gone.
      .get("/machine-setup/teardown.sh", (c) => script(c, posixTeardown, "sh"))
      .get("/machine-setup/teardown.ps1", (c) => script(c, windowsTeardown, "ps1"))
      .post(
        "/machine-setup/report",
        json(
          z.object({
            code: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
            user: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
            os: z.enum(["macos", "linux", "windows"]),
            hostKeys: z.array(z.string().max(4096)).max(16),
            /** The script ran with --prepare and created the account it reports. */
            prepared: z.boolean().optional(),
          }),
        ),
        async (c) => {
          if (!httpsOrigin(c)) return c.json({ error: "Over HTTPS only." }, 400);
          if (limiter.blocked(LIMIT_KEY))
            return c.json({ error: "Too many tries. Wait a few minutes." }, 429);
          const report = c.req.valid("json");
          const machineId = machineSetup.redeem(report.code.toUpperCase());
          const machine = machineId ? getMachine(db, machineId) : undefined;
          if (!machine) {
            limiter.fail(LIMIT_KEY);
            return c.json({ error: "That code expired or was already used." }, 403);
          }
          const notes: string[] = [];
          let target = machine.sshTarget;
          const at = target.lastIndexOf("@");
          if (at === -1) target = `${report.user}@${target}`;
          else if (target.slice(0, at) !== report.user)
            notes.push(
              report.prepared
                ? `The script prepared ${report.user}, but Runyard signs in as ${target.slice(0, at)}. Change the SSH target to ${report.user}@${target.slice(at + 1)} on the machine's page.`
                : `The script ran as ${report.user}, but Runyard signs in as ${target.slice(0, at)}; that account needs the key too.`,
            );
          updateMachine(db, machine.id, {
            sshTarget: target,
            ...(machine.expectedOs ? {} : { expectedOs: report.os }),
            // The script authorized Runyard's key, so sign in with it alone.
            ...(machine.transport === "openssh" ? { runyardKeyOnly: true } : {}),
          });
          // Tailscale SSH checks host keys itself; for OpenSSH, trust exactly what the machine reported.
          if (machine.transport === "openssh") {
            const keys = report.hostKeys
              .map((line) => parsePublicKey(line))
              .filter((k) => k !== null);
            if (keys.length) {
              const name = knownHostsName(await hostKeys.resolve(target));
              for (const [i, key] of keys.entries()) await hostKeys.trust(name, key, i === 0);
            } else
              notes.push("No host keys came with the report; trust the key from the dashboard.");
          }
          monitor.configChanged();
          void monitor.checkNow(machine.id);
          // The script asks for plain text, to print the notes as they are.
          if (c.req.header("Accept")?.includes("text/plain")) return c.text(notes.join("\n"));
          return c.json({ ok: true, notes });
        },
      )
  );
}
