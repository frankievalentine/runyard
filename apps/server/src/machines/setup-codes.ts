/** How long a machine's setup command works. */
export const SETUP_CODE_MS = 15 * 60_000;
// No 0/O or 1/I: the code may be read off one screen and typed on another.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const hash = (code: string) => new Bun.CryptoHasher("sha256").update(code).digest("hex");

/**
 * Single-use codes for machines' setup commands, one per machine, kept only
 * as hashes and in memory: a restart voids them, and a new code replaces the
 * machine's earlier one.
 */
export class MachineSetupCodes {
  private codes = new Map<string, { machineId: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(machineId: string): { code: string; expiresAt: number } {
    for (const [h, entry] of this.codes)
      if (entry.machineId === machineId || entry.expiresAt <= this.now()) this.codes.delete(h);
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
    const expiresAt = this.now() + SETUP_CODE_MS;
    this.codes.set(hash(code), { machineId, expiresAt });
    return { code, expiresAt };
  }

  /** The machine a code was issued for, using it up; null if it's unknown or expired. */
  redeem(code: string): string | null {
    const h = hash(code);
    const entry = this.codes.get(h);
    this.codes.delete(h);
    return entry && entry.expiresAt > this.now() ? entry.machineId : null;
  }
}
