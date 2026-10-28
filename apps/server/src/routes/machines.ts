import { isValidScopeTarget, scopeKey, type Scope } from "@runyard/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { requireAdmin, requireUser, type AppEnv } from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import { osFamilies, transports } from "../db/schema.ts";
import {
  assignRunner,
  cancelMigration,
  listAssignments,
  startMigration,
} from "../machines/assignments.ts";
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
import { listPools, listRegistrations } from "../pools/store.ts";
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
  return (
    new Hono<AppEnv>()
      .get("/yard", user, (c) => c.json(monitor.view))
      .get("/stream", user, (c) =>
        streamSSE(c, async (stream) => {
          const send = (view: unknown) =>
            stream.writeSSE({ event: "yard", data: JSON.stringify(view) });
          const unsubscribe = monitor.subscribe((view) => void send(view));
          stream.onAbort(unsubscribe);
          await send(monitor.view);
          // A comment line every 8 seconds keeps an idle stream open: Bun.serve closes
          // connections silent for 10 seconds, and proxies close them too.
          while (!stream.aborted) {
            await stream.sleep(8_000);
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
      .post(
        "/peers/:nodeId/add",
        requireAdmin(),
        json(
          z.object({
            // Optional: without one, the machine's setup command fills it in.
            user: z
              .string()
              .trim()
              .regex(/^[A-Za-z0-9._-]{0,64}$/, "Use a plain user name.")
              .optional(),
          }),
        ),
        async (c) => {
          const nodeId = c.req.param("nodeId");
          const { user: sshUser } = c.req.valid("json");
          const peer =
            monitor.view.discovered.find((p) => p.nodeId === nodeId) ??
            monitor.view.ignored.find((p) => p.nodeId === nodeId);
          if (!peer) return c.json({ error: "That device isn't on the tailnet." }, 404);
          if (machineForNode(db, nodeId))
            return c.json({ error: "That device is already a Runyard machine." }, 409);
          unignorePeer(db, nodeId);
          const machine = createMachine(db, {
            name: peer.name,
            sshTarget: sshUser ? `${sshUser}@${peer.address}` : peer.address,
            transport: peer.tailscaleSsh ? "tailscale" : "openssh",
            expectedOs: peer.os === "other" ? null : peer.os,
            tailscaleNodeId: nodeId,
          });
          monitor.configChanged();
          void monitor.checkNow(machine.id);
          return c.json(machine, 201);
        },
      )
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
      // Places a runner Runyard didn't register on a machine, for display; null takes it off.
      .put(
        "/runners/assignment",
        requireAdmin(),
        json(
          z.object({
            scope: z.object({
              forgeId: z.string(),
              kind: z.enum(["user", "org", "repo"]),
              target: z.string(),
            }),
            runnerName: z.string().trim().min(1).max(255),
            machineId: z.string().nullable(),
          }),
        ),
        (c) => {
          const { scope, runnerName, machineId } = c.req.valid("json");
          if (!isValidScopeTarget(scope.kind, scope.target))
            return c.json({ error: "That isn't a valid scope." }, 400);
          if (machineId !== null && !getMachine(db, machineId))
            return c.json({ error: "No such machine." }, 404);
          const user = c.get("identity").user!;
          assignRunner(
            db,
            scope,
            runnerName,
            machineId,
            user.username ?? user.tailscaleLogin ?? user.id,
          );
          monitor.tick();
          return c.json({ ok: true });
        },
      )
      // Moves an assigned runner into a pool (it's retired once a pool runner stands in); null cancels.
      .put(
        "/runners/migration",
        requireAdmin(),
        json(
          z.object({
            scope: z.object({
              forgeId: z.string(),
              kind: z.enum(["user", "org", "repo"]),
              target: z.string(),
            }),
            runnerName: z.string().trim().min(1).max(255),
            poolId: z.string().nullable(),
            path: z
              .string()
              .trim()
              .max(500)
              // Shown in the cleanup steps only, but kept to a plain absolute path.
              .refine(
                (v) =>
                  v === "" ||
                  (/^(?:\/|~\/|[A-Za-z]:\\)/.test(v) &&
                    !Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)).some(
                      (c) => c < 0x20,
                    )),
                "Give an absolute path, or leave it empty.",
              )
              .nullable()
              .optional(),
          }),
        ),
        (c) => {
          const { scope, runnerName, poolId, path } = c.req.valid("json");
          if (!isValidScopeTarget(scope.kind, scope.target))
            return c.json({ error: "That isn't a valid scope." }, 400);
          if (poolId === null) {
            cancelMigration(db, scope, runnerName);
            monitor.tick();
            return c.json({ ok: true });
          }
          const key = `${scopeKey(scope)}:${runnerName.toLowerCase()}`;
          const sameRunner = (s: Scope, name: string) =>
            `${scopeKey(s)}:${name.toLowerCase()}` === key;
          if (listRegistrations(db).some((r) => sameRunner(r.scope, r.runnerName)))
            return c.json({ error: "Runyard already manages this runner." }, 400);
          const assignment = listAssignments(db).find((a) => sameRunner(a.scope, a.runnerName));
          if (!assignment)
            return c.json({ error: "Choose the machine it runs on first, under Runs on." }, 400);
          const pool = listPools(db).find((p) => p.id === poolId);
          if (!pool) return c.json({ error: "No such pool." }, 404);
          if (pool.mode !== "persistent")
            return c.json(
              {
                error: "Choose a persistent pool: an on-demand pool keeps no runner to take over.",
              },
              400,
            );
          if (!pool.machines.some((m) => m.machineId === assignment.machineId))
            return c.json({ error: `Pool ${pool.name} doesn't run on that machine.` }, 400);
          if (!pool.scopes.some((s) => scopeKey(s) === scopeKey(scope)))
            return c.json({ error: `Pool ${pool.name} doesn't serve ${scope.target}.` }, 400);
          const user = c.get("identity").user!;
          startMigration(
            db,
            {
              scope,
              runnerName,
              machineId: assignment.machineId,
              poolId,
              path: path || null,
            },
            user.username ?? user.tailscaleLogin ?? user.id,
          );
          monitor.tick();
          return c.json({ ok: true });
        },
      )
      .post(
        "/machines/:id/maintenance",
        requireAdmin(),
        json(z.object({ on: z.boolean() })),
        (c) => {
          const id = c.req.param("id");
          if (!getMachine(db, id)) return c.json({ error: "No such machine." }, 404);
          monitor.setMaintenance(id, c.req.valid("json").on);
          return c.json({ ok: true });
        },
      )
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
      })
  );
}
