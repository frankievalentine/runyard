import { expect, test } from "bun:test";
import { importKey, open, seal } from "./crypto.ts";

const newKey = () => importKey(crypto.getRandomValues(new Uint8Array(32)));

test("round-trips and never reuses an IV", async () => {
  const key = await newKey();
  const a = await seal(key, "token", "github.app");
  const b = await seal(key, "token", "github.app");
  expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
  expect(await open(key, a, "github.app")).toBe("token");
});

test("fails for another row, another key or tampered ciphertext", async () => {
  const key = await newKey();
  const sealed = await seal(key, "token", "github.app");
  expect(open(key, sealed, "forgejo.token")).rejects.toThrow();
  expect(open(await newKey(), sealed, "github.app")).rejects.toThrow();
  const tampered = new Uint8Array(sealed.ciphertext);
  tampered[0]! ^= 1;
  expect(open(key, { iv: sealed.iv, ciphertext: tampered }, "github.app")).rejects.toThrow();
});

test("rejects keys of the wrong length", () => {
  expect(importKey(new Uint8Array(16))).rejects.toThrow("32 bytes");
});
