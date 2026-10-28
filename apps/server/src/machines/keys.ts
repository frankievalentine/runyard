import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../command.ts";

/**
 * Runyard's own SSH key and known hosts, in the data directory: machines
 * authorize this key, and host keys trusted from the dashboard go in this
 * known_hosts. Both sit beside the user's own, which keep working.
 */
export type RunyardSsh = { dir: string; identity: string; knownHosts: string };

export function runyardSshPaths(dataDir: string): RunyardSsh {
  const dir = join(dataDir, "ssh");
  return { dir, identity: join(dir, "id_ed25519"), knownHosts: join(dir, "known_hosts") };
}

/** OpenSSH's key generator, next to the ssh it runs, so PATH can't substitute another. */
export function sshKeygenProgram(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.RUNYARD_SSH_KEYGEN ??
    (existsSync("/usr/bin/ssh-keygen") ? "/usr/bin/ssh-keygen" : "ssh-keygen")
  );
}

/**
 * Creates Runyard's ed25519 key the first time; afterwards it's left alone.
 * Returns an error sentence when ssh-keygen can't make one.
 */
export async function ensureRunyardKey(
  run: CommandRunner,
  keygen: string,
  paths: RunyardSsh,
): Promise<string | null> {
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  if (!existsSync(paths.knownHosts)) await writeFile(paths.knownHosts, "", { mode: 0o600 });
  if (existsSync(paths.identity)) return null;
  const res = await run(
    [keygen, "-q", "-t", "ed25519", "-N", "", "-C", `runyard@${hostname()}`, "-f", paths.identity],
    { timeoutMs: 15_000 },
  );
  if (res.code !== 0)
    return `Couldn't create Runyard's SSH key with ${keygen}: ${res.stderr.trim() || `exit ${res.code}`}`;
  await chmod(paths.identity, 0o600);
  return null;
}

export type PublicKey = { type: string; key: string; line: string; fingerprint: string };

/** Parses `type base64 [comment]`, with OpenSSH's SHA256 fingerprint. Null if it isn't one. */
export function parsePublicKey(line: string): PublicKey | null {
  const [type, key] = line.trim().split(/\s+/);
  if (!type || !key || !/^(ssh-|ecdsa-sha2-|sk-)[a-z0-9@.-]+$/.test(type)) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) return null;
  const blob = Buffer.from(key, "base64");
  // The blob starts with its own type name; a mismatch means it isn't a key of that type.
  const length = blob.length >= 4 ? blob.readUInt32BE(0) : 0;
  if (length === 0 || blob.subarray(4, 4 + length).toString() !== type) return null;
  const digest = new Bun.CryptoHasher("sha256").update(blob).digest("base64").replace(/=+$/, "");
  return { type, key, line: `${type} ${key}`, fingerprint: `SHA256:${digest}` };
}

/** Runyard's public key, for machines to authorize. Null until it exists. */
export async function runyardPublicKey(paths: RunyardSsh): Promise<PublicKey | null> {
  const file = Bun.file(`${paths.identity}.pub`);
  if (!(await file.exists())) return null;
  const text = (await file.text()).trim();
  const parsed = parsePublicKey(text);
  // Keep the comment: it names the Runyard install in authorized_keys.
  return parsed ? { ...parsed, line: text } : null;
}
