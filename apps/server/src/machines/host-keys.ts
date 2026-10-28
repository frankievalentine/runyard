import { readFile, writeFile } from "node:fs/promises";
import type { CommandRunner } from "../command.ts";
import { parsePublicKey, type PublicKey } from "./keys.ts";
import { validateTarget, type SshPrograms } from "./ssh.ts";

/** Where `ssh` really connects for a target, after the user's ~/.ssh/config. */
export type Resolved = { host: string; port: number; user: string; alias: string | null };

/** The host name ssh looks a target up under in known_hosts. */
export function knownHostsName(r: Resolved): string {
  if (r.alias) return r.alias;
  return r.port === 22 ? r.host : `[${r.host}]:${r.port}`;
}

/** Host key types in the order ssh prefers them; the first one present is the one to confirm. */
const PREFERENCE = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "rsa-sha2-512",
  "ssh-rsa",
];

export function primaryKey(keys: PublicKey[]): PublicKey | null {
  const rank = (k: PublicKey) => {
    const i = PREFERENCE.indexOf(k.type);
    return i === -1 ? PREFERENCE.length : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** A name ssh-keyscan and known_hosts can take as is: no option-looking or spaced names. */
function plainHost(host: string): boolean {
  return /^[A-Za-z0-9._:%[\]-]+$/.test(host) && !host.startsWith("-");
}

/**
 * Reads machines' host keys and trusts them in Runyard's own known_hosts,
 * only after a person confirms the fingerprint (or the machine's setup
 * command reports them). Reading is ssh-keyscan: it never signs in.
 */
export class HostKeys {
  constructor(
    private readonly deps: {
      run: CommandRunner;
      programs: SshPrograms;
      /** Runyard's known_hosts. */
      file: string;
    },
  ) {}

  /** What ssh resolves a target to, from `ssh -G`. */
  async resolve(target: string): Promise<Resolved> {
    const problem = validateTarget(target);
    if (problem) throw new Error(problem);
    const res = await this.deps.run([this.deps.programs.ssh, "-G", "--", target], {
      timeoutMs: 10_000,
    });
    if (res.code !== 0)
      throw new Error(`ssh couldn't read the settings for ${target}: ${res.stderr.trim()}`);
    const settings = new Map<string, string>();
    for (const line of res.stdout.split(/\r?\n/)) {
      const [key, ...rest] = line.trim().split(/\s+/);
      if (key && rest.length && !settings.has(key)) settings.set(key.toLowerCase(), rest.join(" "));
    }
    const host = settings.get("hostname") ?? target.slice(target.lastIndexOf("@") + 1);
    if (!plainHost(host)) throw new Error(`Runyard can't read host keys for ${host}.`);
    return {
      host,
      port: Number(settings.get("port") ?? 22) || 22,
      user: settings.get("user") ?? "",
      alias: settings.get("hostkeyalias") ?? null,
    };
  }

  /** The host keys the machine offers, read with ssh-keyscan. */
  async scan(r: Resolved): Promise<PublicKey[]> {
    const keyscan = this.deps.programs.keyscan ?? "ssh-keyscan";
    const res = await this.deps.run([keyscan, "-T", "10", "-p", String(r.port), "--", r.host], {
      timeoutMs: 20_000,
    });
    const keys: PublicKey[] = [];
    for (const line of res.stdout.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [, type, key] = line.trim().split(/\s+/);
      const parsed = type && key ? parsePublicKey(`${type} ${key}`) : null;
      if (parsed && !keys.some((k) => k.fingerprint === parsed.fingerprint)) keys.push(parsed);
    }
    if (keys.length === 0)
      throw new Error(
        `Couldn't read a host key from ${r.host} port ${r.port}${res.stderr.trim() ? `: ${res.stderr.trim().split("\n").at(-1)}` : "."} Check that its SSH server is on.`,
      );
    return keys;
  }

  /** Keys Runyard already trusts for a known_hosts name. */
  async trusted(name: string): Promise<PublicKey[]> {
    const out: PublicKey[] = [];
    for (const line of (await this.lines()).filter((l) => names(l).includes(name))) {
      const parsed = parsePublicKey(line.split(/\s+/).slice(1, 3).join(" "));
      if (parsed) out.push(parsed);
    }
    return out;
  }

  /** Adds a key for a name; with `replace`, Runyard's earlier keys for that name go first. */
  async trust(name: string, key: PublicKey, replace: boolean) {
    if (!plainHost(name.replace(/^\[|\]:\d+$/g, "")))
      throw new Error(`Runyard can't trust keys for ${name}.`);
    const kept = (await this.lines()).filter((l) => !replace || !names(l).includes(name));
    if (kept.some((l) => names(l).includes(name) && l.includes(key.key))) return;
    await writeFile(this.deps.file, [...kept, `${name} ${key.line}`].join("\n") + "\n", {
      mode: 0o600,
    });
  }

  private async lines(): Promise<string[]> {
    const text = await readFile(this.deps.file, "utf8").catch(() => "");
    return text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  }
}

function names(line: string): string[] {
  return (line.split(/\s+/)[0] ?? "").split(",");
}
