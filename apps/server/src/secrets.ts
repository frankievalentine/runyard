import { eq } from "drizzle-orm";
import { chmod, mkdir, open as openFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { importKey, KEY_BYTES, open, seal } from "./crypto.ts";
import type { Db } from "./db/index.ts";
import { secrets } from "./db/schema.ts";

/** Detects a key that doesn't match the database before any real secret is read. */
const KEY_CHECK_ID = "_keycheck";
const KEY_CHECK_VALUE = "runyard";

/**
 * Loads the secret key from `RUNYARD_SECRET_KEY` (base64), else from
 * `RUNYARD_SECRET_KEY_FILE` or `<data dir>/secret.key`, generating that file on
 * first start. A generated key file beside the database only protects a copy of
 * the database on its own; keep the key elsewhere to separate the two.
 */
export async function loadSecretKey(env: NodeJS.ProcessEnv, dataDir: string): Promise<CryptoKey> {
  if (env.RUNYARD_SECRET_KEY)
    return importKey(decodeKey(env.RUNYARD_SECRET_KEY, "RUNYARD_SECRET_KEY"));
  const path = env.RUNYARD_SECRET_KEY_FILE ?? join(dataDir, "secret.key");
  const file = Bun.file(path);
  if (await file.exists()) {
    await assertPrivate(path);
    return importKey(decodeKey((await file.text()).trim(), path));
  }
  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // `wx` fails if another process created the file first, rather than overwriting its key.
  const handle = await openFile(path, "wx", 0o600);
  try {
    await handle.writeFile(`${Buffer.from(raw).toString("base64")}\n`);
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
  return importKey(raw);
}

function decodeKey(text: string, source: string): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array(Buffer.from(text, "base64"));
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error(
      `${source} must hold a base64-encoded ${KEY_BYTES}-byte key (\`openssl rand -base64 32\`).`,
    );
  }
  return raw;
}

async function assertPrivate(path: string) {
  if (process.platform === "win32") return;
  const mode = (await stat(path)).mode & 0o777;
  if (mode & 0o077) {
    throw new Error(
      `${path} is readable by other users (mode ${mode.toString(8)}). Restrict it with \`chmod 600 ${path}\`.`,
    );
  }
}

/** Encrypted key-value storage for credentials. Values are never logged or returned by the API. */
export class SecretStore {
  private constructor(
    private readonly db: Db,
    private readonly key: CryptoKey,
  ) {}

  /** Refuses a key that differs from the one the database's secrets were written with. */
  static async open(db: Db, key: CryptoKey): Promise<SecretStore> {
    const store = new SecretStore(db, key);
    const check = await store.read(KEY_CHECK_ID).catch(() => {
      throw new Error(
        "The secret key doesn't match the one this database's secrets were encrypted with.",
      );
    });
    if (check === undefined) await store.write(KEY_CHECK_ID, KEY_CHECK_VALUE);
    else if (check !== KEY_CHECK_VALUE) throw new Error("The database's key check is corrupt.");
    return store;
  }

  async get(id: string): Promise<string | undefined> {
    assertUserId(id);
    return this.read(id);
  }

  async set(id: string, value: string): Promise<void> {
    assertUserId(id);
    return this.write(id, value);
  }

  delete(id: string) {
    assertUserId(id);
    this.db.delete(secrets).where(eq(secrets.id, id)).run();
  }

  private async read(id: string): Promise<string | undefined> {
    const row = this.db.select().from(secrets).where(eq(secrets.id, id)).get();
    if (!row) return undefined;
    return open(
      this.key,
      { iv: new Uint8Array(row.iv), ciphertext: new Uint8Array(row.ciphertext) },
      id,
    );
  }

  private async write(id: string, value: string) {
    const { iv, ciphertext } = await seal(this.key, value, id);
    const values = {
      iv: Buffer.from(iv),
      ciphertext: Buffer.from(ciphertext),
      updatedAt: new Date(),
    };
    this.db
      .insert(secrets)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: secrets.id, set: values })
      .run();
  }
}

function assertUserId(id: string) {
  if (!id || id.startsWith("_")) throw new Error(`Invalid secret id ${JSON.stringify(id)}.`);
}
