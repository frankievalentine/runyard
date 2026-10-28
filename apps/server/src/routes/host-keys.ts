import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, type AppEnv } from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import { HostKeys, knownHostsName, primaryKey } from "../machines/host-keys.ts";
import { parsePublicKey } from "../machines/keys.ts";
import type { MachineMonitor } from "../machines/monitor.ts";
import { getMachine } from "../machines/store.ts";
import { json } from "./validate.ts";

/**
 * Trusting a machine's SSH host key from the dashboard: Runyard reads it
 * (ssh-keyscan, no sign-in), a person compares the fingerprint, and only a
 * key with that fingerprint, read again, goes into Runyard's known_hosts.
 */
export function hostKeyRoutes({
  db,
  monitor,
  hostKeys,
}: {
  db: Db;
  monitor: MachineMonitor;
  hostKeys: HostKeys;
}) {
  const machineFor = (id: string) => {
    const machine = getMachine(db, id);
    if (!machine) return { error: "No such machine.", status: 404 as const };
    if (machine.transport === "tailscale")
      return { error: "Tailscale SSH checks host keys itself.", status: 400 as const };
    return { machine };
  };
  const read = async (machineId: string, target: string) => {
    const resolved = await hostKeys.resolve(target);
    const keys = await hostKeys.scan(resolved);
    const name = knownHostsName(resolved);
    const trusted = await hostKeys.trusted(name);
    const published = monitor
      .tailnetHostKeys(machineId)
      .map((l) => parsePublicKey(l)?.fingerprint)
      .filter(Boolean);
    return { resolved, keys, name, trusted, published };
  };
  return new Hono<AppEnv>()
    .post("/machines/:id/host-key/scan", requireAdmin(), async (c) => {
      const found = machineFor(c.req.param("id"));
      if ("error" in found) return c.json({ error: found.error }, found.status);
      try {
        const { resolved, keys, name, trusted, published } = await read(
          found.machine.id,
          found.machine.sshTarget,
        );
        const key = primaryKey(keys)!;
        const offered = new Set(keys.map((k) => k.fingerprint));
        return c.json({
          host: name,
          type: key.type,
          fingerprint: key.fingerprint,
          trusted: trusted.some((t) => t.fingerprint === key.fingerprint),
          // Runyard trusts other keys for this name, and the machine offers none of them.
          changed: trusted.length > 0 && !trusted.some((t) => offered.has(t.fingerprint)),
          tailscale: published.length
            ? published.includes(key.fingerprint)
              ? ("match" as const)
              : ("different" as const)
            : null,
          port: resolved.port,
        });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
      }
    })
    .post(
      "/machines/:id/host-key/trust",
      requireAdmin(),
      json(
        z.object({
          fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
          replace: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const found = machineFor(c.req.param("id"));
        if ("error" in found) return c.json({ error: found.error }, found.status);
        const { fingerprint, replace = false } = c.req.valid("json");
        try {
          // Read again: only the key the person just compared is trusted.
          const { keys, name, trusted } = await read(found.machine.id, found.machine.sshTarget);
          const key = keys.find((k) => k.fingerprint === fingerprint);
          if (!key)
            return c.json(
              { error: "The machine now offers a different key. Read it again and compare." },
              409,
            );
          const offered = new Set(keys.map((k) => k.fingerprint));
          if (trusted.length > 0 && !trusted.some((t) => offered.has(t.fingerprint)) && !replace)
            return c.json(
              {
                error: `Runyard trusts a different key for ${name}. Replace it only if you know why it changed.`,
              },
              409,
            );
          await hostKeys.trust(name, key, replace);
          void monitor.checkNow(found.machine.id);
          return c.json({ ok: true, host: name });
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
        }
      },
    );
}
