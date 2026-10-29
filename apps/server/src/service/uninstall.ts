import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { openDatabase } from "../db/index.ts";
import { dependents } from "../pools/dependents.ts";
import { applyPlan } from "./apply.ts";
import { ServiceError, uninstallPlan, type ServiceContext } from "./plan.ts";

/**
 * Why a data directory isn't safe to delete with --purge, or null. Only a
 * directory that is evidently Runyard's goes: named for it, or holding its
 * database, and never the home directory or a filesystem root.
 */
export function purgeProblem(dataDir: string, home: string): string | null {
  const dir = resolve(dataDir);
  if (dir === resolve(home) || dir === resolve("/") || /^[A-Za-z]:\\?$/.test(dir))
    return `Refusing to delete ${dir}: it isn't a directory of Runyard's own.`;
  if (!/runyard/i.test(basename(dir)) && !existsSync(join(dir, "runyard.db")))
    return `Refusing to delete ${dir}: it doesn't look like Runyard's data directory.`;
  return null;
}

/** What Runyard still has on machines, read from its database; empty when there's none. */
export function remainingOutThere(dataDir: string): string[] {
  const path = join(dataDir, "runyard.db");
  if (!existsSync(path)) return [];
  return dependents(openDatabase(path), {});
}

/**
 * `runyard uninstall`: removes the service and the binary, and with --purge
 * the data directory. Refuses while Runyard still has runners on machines,
 * unless --force: they'd stay registered with nothing left to remove them.
 */
export async function uninstall(
  ctx: ServiceContext,
  options: { purge: boolean; force: boolean; dryRun: boolean; log?: (line: string) => void },
) {
  const log = options.log ?? console.log;
  const left = remainingOutThere(ctx.dataDir);
  if (left.length && !options.force)
    throw new ServiceError(
      [
        `Runyard still has ${left.length} thing${left.length === 1 ? "" : "s"} on your machines: ${left.slice(0, 8).join(", ")}${left.length > 8 ? ", …" : ""}.`,
        "Decommission each machine in the dashboard and run its review first, so they're removed;",
        "or pass --force to leave them behind.",
      ].join("\n"),
    );
  if (options.purge) {
    const problem = purgeProblem(ctx.dataDir, ctx.home);
    if (problem) throw new ServiceError(problem);
  }

  await applyPlan(uninstallPlan(ctx), { dryRun: options.dryRun, log });

  if (ctx.platform === "win32") log(`  delete ${ctx.binary} by hand once this command exits`);
  else {
    log(`  remove ${ctx.binary}`);
    if (!options.dryRun) await rm(ctx.binary, { force: true });
  }

  if (options.purge) {
    log(`  remove ${ctx.dataDir} (database, Runyard's SSH key and known hosts, secret key file)`);
    if (!options.dryRun) await rm(ctx.dataDir, { recursive: true, force: true });
    if (ctx.env.RUNYARD_SECRET_KEY_FILE)
      log(`  ${ctx.env.RUNYARD_SECRET_KEY_FILE} is outside it and stays; delete it yourself.`);
  } else log(`Runyard's data stays in ${ctx.dataDir}; add --purge to delete it.`);

  log(
    [
      "",
      options.dryRun ? "Nothing was changed (--dry-run)." : "Runyard is uninstalled.",
      "Outside this machine, these stay until you remove them:",
      "  - each GitHub App Runyard created: delete it in its settings on GitHub",
      "  - Runyard's key on your machines: run each machine's teardown command",
      "  - a Tailscale Funnel for webhooks, if you set one up: tailscale funnel reset",
    ].join("\n"),
  );
}
