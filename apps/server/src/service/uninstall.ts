import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { openDatabase, type Db } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { runCommand } from "../command.ts";
import { secrets } from "../db/schema.ts";
import { listConnections } from "../forgejo/store.ts";
import { listGithubApps } from "../github/store.ts";
import { listMachines } from "../machines/store.ts";
import { listDispatches, listRegistrations, listTemplates } from "../pools/store.ts";
import { TailscaleCli } from "../tailscale.ts";
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

/** What Runyard still has outside this machine, read from its database. */
export type OutThere = {
  machines: { name: string; runners: number; software: number; running: number }[];
  githubApps: { name: string; owner: string }[];
  forgejo: { host: string; login: string }[];
  boat: boolean;
};

/** Everything Runyard set up outside this machine; null when there's no database. */
export function outThere(dataDir: string): OutThere | null {
  const path = join(dataDir, "runyard.db");
  if (!existsSync(path)) return null;
  const db = openDatabase(path);
  try {
    return readOutThere(db);
  } finally {
    // Closed before --purge deletes it; Windows can't delete an open file.
    db.$client.close();
  }
}

function readOutThere(db: Db): OutThere {
  const registrations = listRegistrations(db);
  const templates = listTemplates(db);
  const running = listDispatches(db).filter((d) => d.state === "starting" || d.state === "running");
  return {
    machines: listMachines(db).map((m) => ({
      name: m.name,
      runners: registrations.filter((r) => r.machineId === m.id).length,
      software: templates.filter((t) => t.machineId === m.id).length,
      running: running.filter((d) => d.machineId === m.id).length,
    })),
    githubApps: listGithubApps(db).map((a) => ({ name: a.name, owner: a.owner })),
    forgejo: listConnections(db).map((c) => ({ host: new URL(c.baseUrl).host, login: c.login })),
    boat: db.select().from(secrets).where(eq(secrets.id, "boat.token")).get() !== undefined,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Each machine and connection left, as indented lines: what to do in the dashboard
 * before uninstalling, or by hand once Runyard is gone.
 */
export function leftoverLines(left: OutThere, when: "before" | "after"): string[] {
  const lines: string[] = [];
  if (left.machines.length)
    lines.push(
      when === "before"
        ? "  Machines:"
        : "  Machines, with Runyard's key and runner folder (run the teardown command on each):",
    );
  for (const m of left.machines) {
    const has = [
      m.runners && plural(m.runners, "runner"),
      m.software && `runner software for ${plural(m.software, "pool")}`,
      m.running && `${m.running} running a job`,
    ].filter(Boolean);
    const what = has.length ? ` (${has.join(", ")})` : "";
    if (when === "after") lines.push(`    ${m.name}${what}`);
    else lines.push(`    ${m.name}${what}: Remove${has.length ? " (it removes them first)" : ""}`);
  }
  const before = when === "before";
  const connections = [
    ...left.githubApps.map(
      (a) =>
        `    GitHub App "${a.name}" (${a.owner}): ${before ? "remove it, then " : ""}delete it on GitHub`,
    ),
    ...left.forgejo.map(
      (c) =>
        `    Forgejo at ${c.host} (${c.login}): ${before ? "remove it, then " : ""}revoke its token on Forgejo`,
    ),
    ...(left.boat
      ? [`    boat.dev: ${before ? "Disconnect, then " : ""}delete its API key on boat.dev`]
      : []),
  ];
  if (connections.length) lines.push("  Connections:", ...connections);
  return lines;
}

/** Where the dashboard answers, for pointing people at it; the tailnet address when serving there. */
async function dashboardAddress(env: NodeJS.ProcessEnv, tailscale: TailscaleCli | null) {
  if (env.RUNYARD_ORIGIN) return `${env.RUNYARD_ORIGIN.replace(/\/$/, "")}/`;
  if (tailscale && env.RUNYARD_TAILNET !== "off") {
    const self = await tailscale.self();
    if (!(self instanceof Error) && self.canCert)
      return `https://${self.dnsName}:${env.RUNYARD_TAILNET_PORT ?? 7443}/`;
  }
  return `http://127.0.0.1:${env.RUNYARD_PORT ?? 7420}/`;
}

/** The public URL Funnel serves Runyard's webhooks at, or null when it doesn't or can't tell. */
async function funnelUrl(env: NodeJS.ProcessEnv, tailscale: TailscaleCli | null) {
  if (!tailscale) return null;
  const res = await tailscale.funnelFor(Number(env.RUNYARD_WEBHOOK_PORT ?? 7444));
  return res instanceof Error ? null : res.url;
}

/**
 * `runyard uninstall`: removes the service and the binary, and with --purge
 * the data directory. Refuses while Runyard still has machines or connections,
 * listing each and what to do with it, unless --force: runners would stay
 * registered, and Runyard's key on each machine, with nothing left to remove them.
 */
export async function uninstall(
  ctx: ServiceContext,
  options: {
    purge: boolean;
    force: boolean;
    dryRun: boolean;
    log?: (line: string) => void;
    /** The Tailscale CLI; tests pass a fake. */
    tailscale?: TailscaleCli | null;
  },
) {
  const log = options.log ?? console.log;
  const tailscale =
    options.tailscale !== undefined
      ? options.tailscale
      : ctx.tailscale
        ? new TailscaleCli(runCommand, ctx.tailscale)
        : null;
  const left = outThere(ctx.dataDir);
  const lines = left ? leftoverLines(left, "before") : [];
  const funnel = await funnelUrl(ctx.env, tailscale);
  const funnelLine = (when: string) =>
    `  Funnel serves webhooks at ${funnel}: run \`tailscale funnel reset\`${when}`;
  if (lines.length && !options.force)
    throw new ServiceError(
      [
        "Runyard still has machines or connections. Remove them first, in the dashboard at",
        `${await dashboardAddress(ctx.env, tailscale)}:`,
        ...lines,
        ...(funnel ? [funnelLine(" once Runyard is gone")] : []),
        "Or add --force to uninstall anyway: runners stay registered, and Runyard's key stays on each machine.",
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

  const after = [
    ...(left ? leftoverLines(left, "after") : []),
    ...(funnelLine ? [funnelLine] : []),
  ];
  log(
    [
      "",
      options.dryRun ? "Nothing was changed (--dry-run)." : "Runyard is uninstalled.",
      ...(after.length
        ? ["Outside this machine, these stay until you remove them by hand:", ...after]
        : []),
      // Removing an app in Runyard leaves it on GitHub, where Runyard can no longer see it.
      ...(left?.githubApps.length
        ? []
        : ["Delete each GitHub App Runyard created on GitHub, if you haven't."]),
    ].join("\n"),
  );
}
