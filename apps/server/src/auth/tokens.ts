import { createHash, timingSafeEqual } from "node:crypto";

/** A random URL-safe token with `bytes` of entropy. */
export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Compares secrets without leaking where they differ; hashing first equalizes lengths. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}
