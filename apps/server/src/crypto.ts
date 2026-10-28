/**
 * AES-256-GCM for secrets at rest. The additional data binds each ciphertext to
 * its row, so a ciphertext copied into another row fails to decrypt.
 */
export type Sealed = { iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> };

export const KEY_BYTES = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.byteLength !== KEY_BYTES)
    throw new Error(`The secret key must be ${KEY_BYTES} bytes, got ${raw.byteLength}.`);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(key: CryptoKey, plaintext: string, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/** Throws if the key is wrong or the ciphertext, IV or additional data changed. */
export async function open(key: CryptoKey, sealed: Sealed, aad: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv, additionalData: encoder.encode(aad) },
    key,
    sealed.ciphertext,
  );
  return decoder.decode(plaintext);
}
