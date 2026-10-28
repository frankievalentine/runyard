import { safeEqual } from "./tokens.ts";

/** Crockford base32: 32 symbols, so `byte % 32` is unbiased, and no I, L, O or U to misread. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * The one-time code that claims a fresh install. It exists only in memory and
 * the server log, so creating the first admin needs access to the machine's
 * output, not just network access to the dashboard.
 */
export class SetupCode {
  private code: string | undefined;

  constructor(private readonly announce: (code: string) => void) {}

  /** Generates and announces a new code: 12 symbols, 60 bits. */
  issue() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const chars = [...bytes].map((b) => ALPHABET[b % 32]).join("");
    this.code = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
    this.announce(this.code);
  }

  get active(): boolean {
    return this.code !== undefined;
  }

  /** Accepts the code ignoring case, spaces, dashes and Crockford look-alikes. */
  matches(input: string): boolean {
    if (!this.code) return false;
    return safeEqual(normalize(input), normalize(this.code));
  }

  consume() {
    this.code = undefined;
  }
}

function normalize(code: string) {
  return code.replace(/[\s-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}
