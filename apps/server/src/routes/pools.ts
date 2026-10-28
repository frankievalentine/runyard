import {
  desiredRunners,
  isValidScopeTarget,
  nameCollisions,
  POOL_NAME,
  type OsFamily,
} from "@runyard/core";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, requireUser, type AppEnv } from "../auth/identity.ts";
import type { Db } from "../db/index.ts";
import { getMachine, listMachines } from "../machines/store.ts";
import type { MachineMonitor } from "../machines/monitor.ts";
import { EngineError, type PoolEngine } from "../pools/engine.ts";
import {
  allowPublicRepo,
  deletePool,
  listPools,
  revokePublicRepo,
  savePool,
  type PoolInput,
} from "../pools/store.ts";
import { json } from "./validate.ts";

const label = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,50}$/, "Labels use letters, digits, dots, dashes and underscores.");
const poolSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(POOL_NAME, "Pool names use lowercase letters, digits and dashes (up to 24)."),
  labels: z.array(label).max(20),
  machines: z
    .array(z.object({ machineId: z.string(), slots: z.number().int().min(1).max(16) }))
    .max(100),
  scopes: z
    .array(
      z.object({ forgeId: z.string(), kind: z.enum(["org", "repo"]), target: z.string().trim() }),
    )
    .min(1, "Choose at least one organization or repository.")
    .max(50),
});

export type PoolDeps = { db: Db; engine: PoolEngine; monitor: MachineMonitor };

/** Pools, reviews and their execution, and public-repository overrides. */
export function poolRoutes({ db, engine, monitor }: PoolDeps) {
  /** Refuses a definition with unknown machines, bad targets, or runners that would share a name. */
  const check = (input: PoolInput, id?: string): string | null => {
    for (const m of input.machines)
      if (!getMachine(db, m.machineId)) return "One of the machines no longer exists.";
    for (const s of input.scopes)
      if (!isValidScopeTarget(s.kind, s.target)) return `${s.target} isn't a valid ${s.kind}.`;
    const others = listPools(db).filter((p) => p.id !== id);
    if (others.some((p) => p.name === input.name))
      return `There's already a pool called ${input.name}.`;
    // A machine not checked yet still has the OS it was added with.
    const seen = new Map(monitor.view.machines.map((m) => [m.id, m.os]));
    const info = new Map(
      listMachines(db).map((m) => [
        m.id,
        { name: m.name, os: (seen.get(m.id) ?? m.expectedOs) as OsFamily | null },
      ]),
    );
    const collisions = nameCollisions(
      desiredRunners([...others, { id: id ?? "new", ...input }], info),
    );
    return collisions[0] ?? null;
  };
  const errors = (fn: () => Promise<Response>) =>
    fn().catch((error: unknown) => {
      if (error instanceof EngineError)
        return Response.json({ error: error.message }, { status: 409 });
      throw error;
    });

  return new Hono<AppEnv>()
    .post("/pools", requireAdmin(), json(poolSchema), (c) => {
      const input = c.req.valid("json");
      const problem = check(input);
      if (problem) return c.json({ error: problem }, 400);
      const id = savePool(db, input);
      monitor.configChanged();
      return c.json({ id }, 201);
    })
    .put("/pools/:id", requireAdmin(), json(poolSchema), (c) => {
      const id = c.req.param("id");
      if (!listPools(db).some((p) => p.id === id)) return c.json({ error: "No such pool." }, 404);
      const input = c.req.valid("json");
      const problem = check(input, id);
      if (problem) return c.json({ error: problem }, 400);
      savePool(db, input, id);
      monitor.configChanged();
      return c.json({ id });
    })
    .delete("/pools/:id", requireAdmin(), (c) => {
      deletePool(db, c.req.param("id"));
      monitor.configChanged();
      return c.json({ ok: true });
    })
    .post("/machines/:id/review", requireAdmin(), (c) =>
      errors(async () => c.json(await engine.review(c.req.param("id")))),
    )
    .post(
      "/reviews/:id/execute",
      requireAdmin(),
      json(z.object({ sudoPassword: z.string().max(1024).optional() })),
      (c) =>
        errors(async () =>
          c.json(await engine.execute(c.req.param("id"), c.req.valid("json")), 202),
        ),
    )
    .get("/operations", requireUser(), (c) => c.json(engine.recentOperations()))
    .get("/operations/:id", requireUser(), (c) => {
      const op = engine.operation(c.req.param("id"));
      return op ? c.json(op) : c.json({ error: "No such operation." }, 404);
    })
    .post(
      "/public-repos",
      requireAdmin(),
      json(z.object({ forgeId: z.string(), repo: z.string().trim(), confirm: z.string().trim() })),
      (c) => {
        const { forgeId, repo, confirm } = c.req.valid("json");
        if (!isValidScopeTarget("repo", repo))
          return c.json({ error: `${repo} isn't a repository.` }, 400);
        if (confirm !== repo) return c.json({ error: `Type ${repo} exactly to confirm.` }, 400);
        const user = c.get("identity").user!;
        allowPublicRepo(db, forgeId, repo, user.username ?? user.tailscaleLogin ?? user.id);
        return c.json({ ok: true });
      },
    )
    .delete(
      "/public-repos",
      requireAdmin(),
      json(z.object({ forgeId: z.string(), repo: z.string() })),
      (c) => {
        const { forgeId, repo } = c.req.valid("json");
        revokePublicRepo(db, forgeId, repo);
        return c.json({ ok: true });
      },
    );
}
