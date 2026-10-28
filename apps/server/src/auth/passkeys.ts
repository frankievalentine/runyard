import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { passkeys } from "../db/schema.ts";
import { randomToken } from "./tokens.ts";
import { findById, UserError, type User } from "./users.ts";

export type Passkey = typeof passkeys.$inferSelect;
export type PasskeyView = {
  id: string;
  name: string;
  rpId: string;
  createdAt: number;
  lastUsedAt: number | null;
};
export type Relying = { origin: string; rpId: string };

const CHALLENGE_MS = 5 * 60 * 1000;
/** Sign-in options are unauthenticated, so pending challenges are capped. */
const MAX_CHALLENGES = 1000;

type Pending = {
  challenge: string;
  purpose: "register" | "login";
  userId?: string;
  relying: Relying;
  expires: number;
};

/** Single-use WebAuthn challenges, in memory, each bound to its purpose, user and origin. */
export class Challenges {
  private pending = new Map<string, Pending>();

  put(entry: Omit<Pending, "expires">, now = Date.now()): string {
    for (const [id, p] of this.pending) if (p.expires <= now) this.pending.delete(id);
    while (this.pending.size >= MAX_CHALLENGES)
      this.pending.delete(this.pending.keys().next().value!);
    const id = randomToken(16);
    this.pending.set(id, { ...entry, expires: now + CHALLENGE_MS });
    return id;
  }

  take(id: string, purpose: Pending["purpose"], now = Date.now()): Pending {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    if (!entry || entry.purpose !== purpose || entry.expires <= now) {
      throw new UserError("That passkey request expired. Try again.");
    }
    return entry;
  }
}

export function toPasskeyView(p: Passkey): PasskeyView {
  return {
    id: p.id,
    name: p.name,
    rpId: p.rpId,
    createdAt: p.createdAt.getTime(),
    lastUsedAt: p.lastUsedAt?.getTime() ?? null,
  };
}

export function listPasskeys(db: Db, userId: string) {
  return db
    .select()
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(passkeys.createdAt)
    .all();
}

export function deletePasskey(db: Db, userId: string, id: string): boolean {
  const deleted = db
    .delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id })
    .all();
  return deleted.length > 0;
}

/** The WebAuthn user handle: the user's ID, never their name. */
function userHandle(user: User) {
  return new TextEncoder().encode(user.id);
}

export async function registrationOptions(
  db: Db,
  challenges: Challenges,
  user: User,
  relying: Relying,
) {
  const existing = listPasskeys(db, user.id).filter((p) => p.rpId === relying.rpId);
  const options = await generateRegistrationOptions({
    rpName: "Runyard",
    rpID: relying.rpId,
    userID: userHandle(user),
    userName: user.username ?? user.tailscaleLogin ?? user.id,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.id,
      transports: parseTransports(p.transports),
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeId = challenges.put({
    challenge: options.challenge,
    purpose: "register",
    userId: user.id,
    relying,
  });
  return { challengeId, options };
}

export async function register(
  db: Db,
  challenges: Challenges,
  user: User,
  input: { challengeId: string; name: string; response: RegistrationResponseJSON },
): Promise<Passkey> {
  const pending = challenges.take(input.challengeId, "register");
  if (pending.userId !== user.id)
    throw new UserError("That passkey request belongs to someone else.");
  const result = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: pending.challenge,
    expectedOrigin: pending.relying.origin,
    expectedRPID: pending.relying.rpId,
    requireUserVerification: true,
  }).catch((error: unknown) => {
    throw new UserError(
      `The passkey couldn't be verified: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!result.verified) throw new UserError("The passkey couldn't be verified.");
  const { credential } = result.registrationInfo;
  const passkey: Passkey = {
    id: credential.id,
    userId: user.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
    rpId: pending.relying.rpId,
    name: input.name,
    createdAt: new Date(),
    lastUsedAt: null,
  };
  db.insert(passkeys).values(passkey).run();
  return passkey;
}

/** Options for a discoverable sign-in: the browser offers whichever passkeys it holds for this host. */
export async function loginOptions(challenges: Challenges, relying: Relying) {
  const options = await generateAuthenticationOptions({
    rpID: relying.rpId,
    userVerification: "required",
  });
  return {
    challengeId: challenges.put({ challenge: options.challenge, purpose: "login", relying }),
    options,
  };
}

/** The signed-in user, or a `UserError` that doesn't reveal which check failed. */
export async function login(
  db: Db,
  challenges: Challenges,
  input: { challengeId: string; response: AuthenticationResponseJSON },
): Promise<User> {
  const pending = challenges.take(input.challengeId, "login");
  const refused = new UserError("That passkey isn't registered for this Runyard.");
  const passkey = db.select().from(passkeys).where(eq(passkeys.id, input.response.id)).get();
  if (!passkey || passkey.rpId !== pending.relying.rpId) throw refused;
  const user = findById(db, passkey.userId);
  if (!user) throw refused;
  const handle = input.response.response.userHandle;
  if (handle && handle !== isoBase64URL.fromBuffer(userHandle(user))) throw refused;

  const result = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: pending.challenge,
    expectedOrigin: pending.relying.origin,
    expectedRPID: pending.relying.rpId,
    credential: {
      id: passkey.id,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: parseTransports(passkey.transports),
    },
    requireUserVerification: true,
  }).catch(() => {
    throw refused;
  });
  if (!result.verified) throw refused;
  db.update(passkeys)
    .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, passkey.id))
    .run();
  return user;
}

function parseTransports(json: string | null): AuthenticatorTransportFuture[] | undefined {
  return json ? (JSON.parse(json) as AuthenticatorTransportFuture[]) : undefined;
}
