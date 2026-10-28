import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importKey } from "./crypto.ts";
import { openDatabase } from "./db/index.ts";
import { loadSecretKey, SecretStore } from "./secrets.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "runyard-secrets-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const randomKey = () => importKey(crypto.getRandomValues(new Uint8Array(32)));

test("stores, replaces and deletes secrets", async () => {
  const store = await SecretStore.open(openDatabase(":memory:"), await randomKey());
  expect(await store.get("github.app")).toBeUndefined();
  await store.set("github.app", "one");
  await store.set("github.app", "two");
  expect(await store.get("github.app")).toBe("two");
  store.delete("github.app");
  expect(await store.get("github.app")).toBeUndefined();
});

test("refuses a different key for an existing database", async () => {
  const path = join(dir, "runyard.db");
  await SecretStore.open(openDatabase(path), await randomKey());
  expect(SecretStore.open(openDatabase(path), await randomKey())).rejects.toThrow("doesn't match");
});

test("reserves internal ids", async () => {
  const store = await SecretStore.open(openDatabase(":memory:"), await randomKey());
  expect(store.get("_keycheck")).rejects.toThrow("Invalid secret id");
});

test("generates a private key file once and reuses it", async () => {
  const path = join(dir, "secret.key");
  const db = join(dir, "runyard.db");
  await SecretStore.open(openDatabase(db), await loadSecretKey({}, dir));
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  // The same file must decrypt what the first key wrote.
  await SecretStore.open(openDatabase(db), await loadSecretKey({}, dir));
});

test("refuses a key file other users can read", async () => {
  await loadSecretKey({}, dir);
  await chmod(join(dir, "secret.key"), 0o644);
  expect(loadSecretKey({}, dir)).rejects.toThrow("chmod 600");
});

test("validates RUNYARD_SECRET_KEY", async () => {
  expect(loadSecretKey({ RUNYARD_SECRET_KEY: "c2hvcnQ=" }, dir)).rejects.toThrow("32-byte key");
  const good = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  await loadSecretKey({ RUNYARD_SECRET_KEY: good }, dir);
  expect(await Bun.file(join(dir, "secret.key")).exists()).toBe(false);
});
