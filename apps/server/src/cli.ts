import pkg from "../package.json" with { type: "json" };
import type { DashboardAssets } from "./dashboard.ts";
import { start } from "./server.ts";
import { applyPlan, currentContext } from "./service/apply.ts";
import { installPlan, ServiceError, statusCommand, uninstallPlan } from "./service/plan.ts";
import { uninstall } from "./service/uninstall.ts";

const HELP = `Runyard ${pkg.version}: self-hosted CI runner control

Usage:
  runyard                      Start the server (the same as \`runyard serve\`)
  runyard service install      Run Runyard as a background service for this user
  runyard service uninstall    Stop and remove the service
  runyard service status       Show the service's state
  runyard uninstall            Remove the service and this binary; --purge also deletes Runyard's data
  runyard version

Add --dry-run to install or uninstall to print what would change. uninstall refuses while
Runyard still has runners on your machines (decommission them first), unless --force.
Settings come from RUNYARD_* environment variables; install carries them into the service.`;

/** The runyard command line. With no command it serves. */
export async function main(argv: string[], dashboard?: DashboardAssets): Promise<void> {
  const [command, sub, ...rest] = argv;
  if (!command || command === "serve") {
    await start(dashboard);
    return;
  }
  if (command === "version" || command === "--version") return console.log(pkg.version);
  if (command === "help" || command === "--help" || command === "-h") return console.log(HELP);
  if (command === "uninstall") {
    const flags = [sub, ...rest].filter(Boolean) as string[];
    try {
      await uninstall(currentContext(), {
        purge: flags.includes("--purge"),
        force: flags.includes("--force"),
        dryRun: flags.includes("--dry-run"),
      });
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      console.error(error.message);
      process.exit(1);
    }
    return;
  }
  if (command === "service") {
    try {
      await service(sub, rest);
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      console.error(error.message);
      process.exit(1);
    }
    return;
  }
  console.error(`Unknown command: ${command}\n\n${HELP}`);
  process.exit(2);
}

async function service(sub: string | undefined, flags: string[]) {
  const dryRun = flags.includes("--dry-run");
  const ctx = currentContext();
  if (sub === "install") {
    const plan = installPlan(ctx);
    await applyPlan(plan, { dryRun });
    if (dryRun) return;
    console.log(`\nRunyard is running as a service. Its log: ${plan.logs}`);
    console.log("A fresh install prints its setup code there.");
    if (ctx.platform === "linux") {
      console.log(
        "For the tailnet HTTPS listener, let this user fetch certificates: `sudo tailscale set --operator=$USER`.",
      );
    }
    return;
  }
  if (sub === "uninstall") {
    await applyPlan(uninstallPlan(ctx), { dryRun });
    if (!dryRun) console.log(`\nRemoved. Runyard's data stays in ${ctx.dataDir}.`);
    return;
  }
  if (sub === "status") {
    const proc = Bun.spawn(statusCommand(ctx), { stdout: "inherit", stderr: "inherit" });
    process.exitCode = await proc.exited;
    return;
  }
  throw new ServiceError("Usage: runyard service install|uninstall|status [--dry-run]");
}
