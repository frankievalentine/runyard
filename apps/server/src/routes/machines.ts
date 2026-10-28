import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { requireAdmin, requireUser, type AppEnv } from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import { osFamilies, transports } from "../db/schema.ts";
import type { MachineMonitor } from "../machines/monitor.ts";
import { validateTarget } from "../machines/ssh.ts";
import {
  createMachine,
  deleteMachine,
  getMachine,
  ignorePeer,
  listEvents,
  machineForNode,
  unignorePeer,
  updateMachine,
} from "../machines/store.ts";
import { json } from "./validate.ts";

const sshTarget = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = validateTarget(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
const name = z.string().trim().min(1, "Name the machine.").max(80);
const description = z.string().trim().max(500);

/** Machines, the tailnet's other peers, events and the live view stream. */
export function machineRoutes({ db, monitor }: { db: Db; monitor: MachineMonitor }) {
  // Mounted at the API root, so sign-in is required per route: unknown paths stay 404.
  const user = requireUser();
  return new Hono<AppEnv>()
    .get("/fleet", user, (c) => c.json(monitor.view))
    .get("/stream", user, (c) =>
      streamSSE(c, async (stream) => {
        const send = (view: unknown) =>
          stream.writeSSE({ event: "fleet", data: JSON.stringify(view) });
        const unsubscribe = monitor.subscribe((view) => void send(view));
        stream.onAbort(unsubscribe);
        await send(monitor.view);
        // A comment line every 25 seconds keeps proxies from closing an idle stream.
        while (!stream.aborted) {
          await stream.sleep(25_000);
          await stream.write(": keepalive\n\n");
        }
      }),
    )
    .get("/events", user, async (c) => {
      const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
      const before = Number(c.req.query("before")) || undefined;
      return c.json(
        listEvents(db, { machineId: c.req.query("machine") || undefined, before, limit }),
      );
    })
    .post("/check", user, async (c) => {
      await monitor.checkNow();
      return c.json(monitor.view);
    })
    .post("/machines/:id/check", user, async (c) => {
      if (!getMachine(db, c.req.param("id"))) return c.json({ error: "No such machine." }, 404);
      await monitor.checkNow(c.req.param("id"));
      return c.json(monitor.view);
    })
    .post(
      "/machines",
      requireAdmin(),
      json(
        z.object({
          name,
          description: description.optional(),
          sshTarget,
          transport: z.enum(transports),
          expectedOs: z.enum(osFamilies).nullable().optional(),
        }),
      ),
      async (c) => {
        const machine = createMachine(db, c.req.valid("json"));
        monitor.configChanged();
        void monitor.checkNow(machine.id);
        return c.json(machine, 201);
      },
    )
    .post("/peers/:nodeId/add", requireAdmin(), async (c) => {
      const nodeId = c.req.param("nodeId");
      const peer =
        monitor.view.discovered.find((p) => p.nodeId === nodeId) ??
        monitor.view.ignored.find((p) => p.nodeId === nodeId);
      if (!peer) return c.json({ error: "That device isn't on the tailnet." }, 404);
      if (machineForNode(db, nodeId))
        return c.json({ error: "That device is already a Runyard machine." }, 409);
      unignorePeer(db, nodeId);
      const machine = createMachine(db, {
        name: peer.name,
        sshTarget: peer.address,
        transport: peer.tailscaleSsh ? "tailscale" : "openssh",
        expectedOs: peer.os === "other" ? null : peer.os,
        tailscaleNodeId: nodeId,
      });
      monitor.configChanged();
      void monitor.checkNow(machine.id);
      return c.json(machine, 201);
    })
    .patch(
      "/machines/:id",
      requireAdmin(),
      json(
        z.object({
          name: name.optional(),
          description: description.optional(),
          sshTarget: sshTarget.optional(),
          transport: z.enum(transports).optional(),
          expectedOs: z.enum(osFamilies).nullable().optional(),
        }),
      ),
      (c) => {
        const id = c.req.param("id");
        if (!getMachine(db, id)) return c.json({ error: "No such machine." }, 404);
        updateMachine(db, id, c.req.valid("json"));
        monitor.configChanged();
        return c.json(getMachine(db, id)!);
      },
    )
    .delete("/machines/:id", requireAdmin(), (c) => {
      const id = c.req.param("id");
      if (!getMachine(db, id)) return c.json({ error: "No such machine." }, 404);
      deleteMachine(db, id);
      monitor.configChanged(id);
      return c.json({ ok: true });
    })
    .post("/machines/:id/maintenance", requireAdmin(), json(z.object({ on: z.boolean() })), (c) => {
      const id = c.req.param("id");
      if (!getMachine(db, id)) return c.json({ error: "No such machine." }, 404);
      monitor.setMaintenance(id, c.req.valid("json").on);
      return c.json({ ok: true });
    })
    .post("/peers/:nodeId/ignore", requireAdmin(), (c) => {
      const nodeId = c.req.param("nodeId");
      const peer = monitor.view.discovered.find((p) => p.nodeId === nodeId);
      if (!peer) return c.json({ error: "That device isn't listed under Other machines." }, 404);
      ignorePeer(db, nodeId, peer.name);
      monitor.configChanged();
      return c.json({ ok: true });
    })
    .delete("/peers/:nodeId/ignore", requireAdmin(), (c) => {
      unignorePeer(db, c.req.param("nodeId"));
      monitor.configChanged();
      return c.json({ ok: true });
    });
}
