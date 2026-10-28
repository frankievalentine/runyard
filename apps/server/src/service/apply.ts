import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { dataDir } from "../config.ts";
import { ServiceError, type ServiceContext, type ServicePlan } from "./plan.ts";

/** Whether this process is the compiled binary rather than `bun src/main.ts`. */
export function isCompiled(): boolean {
  return Bun.main.startsWith("/$bunfs/") || /[\\/]~BUN[\\/]/.test(Bun.main);
}

export function currentContext(env: NodeJS.ProcessEnv = process.env): ServiceContext {
  if (!isCompiled()) {
    throw new ServiceError(
      "`runyard service` needs the compiled runyard binary, not `bun src/main.ts`.",
    );
  }
  const platform = process.platform;
  const info = userInfo();
  return {
    platform,
    binary: process.execPath,
    user:
      platform === "win32" && env.USERDOMAIN
        ? `${env.USERDOMAIN}\\${info.username}`
        : info.username,
    uid: process.getuid?.() ?? 0,
    home: homedir(),
    dataDir: dataDir(env),
    env,
    tailscale: findTailscale(env, platform),
  };
}

function findTailscale(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  if (env.RUNYARD_TAILSCALE) return env.RUNYARD_TAILSCALE;
  const found = Bun.which("tailscale");
  if (found) return found;
  const app = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  return platform === "darwin" && existsSync(app) ? app : null;
}

/** Prints and carries out a plan in the terminal; sudo prompts for a password itself. */
export async function applyPlan(
  plan: ServicePlan,
  options: { dryRun: boolean; log?: (line: string) => void },
) {
  const log = options.log ?? console.log;
  const root = process.getuid?.() === 0;
  const withSudo = (argv: string[], sudo: boolean) => (sudo && !root ? ["sudo", ...argv] : argv);
  log(plan.summary);
  const staging = options.dryRun ? null : await mkdtemp(join(tmpdir(), "runyard-service-"));
  try {
    for (const file of plan.files) {
      log(`  write ${file.path}`);
      if (!staging) continue;
      if (file.sudo) {
        const temp = join(staging, "file");
        await writeFile(temp, file.content);
        await exec(withSudo(["install", "-m", file.mode.toString(8), temp, file.path], true));
      } else {
        await mkdir(dirname(file.path), { recursive: true });
        await writeFile(file.path, file.content);
        if (process.platform !== "win32") await chmod(file.path, file.mode);
      }
    }
    for (const command of plan.commands) {
      const argv = withSudo(command.argv, command.sudo);
      log(`  run ${argv.join(" ")}`);
      if (staging) await exec(argv, command.ignoreFailure);
    }
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

async function exec(argv: string[], ignoreFailure = false) {
  const proc = Bun.spawn(argv, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0 && !ignoreFailure)
    throw new ServiceError(`${argv.join(" ")} failed (exit ${code}).`);
}
