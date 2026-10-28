import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

/**
 * A software WebAuthn authenticator for tests: one P-256 passkey with user
 * verification, "none" attestation, and real signatures, so the server's
 * verification runs unmodified.
 */
export class SoftAuthenticator {
  private keys!: CryptoKeyPair;
  readonly credentialId = crypto.getRandomValues(new Uint8Array(16));
  private counter = 0;
  private userHandle = "";

  async register(
    options: PublicKeyCredentialCreationOptionsJSON,
    origin: string,
  ): Promise<RegistrationResponseJSON> {
    this.keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    this.userHandle = options.user.id;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", this.keys.publicKey));
    const cosePublicKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, raw.slice(1, 33)],
        [-3, raw.slice(33, 65)],
      ]),
    );
    const idLength = new Uint8Array([
      this.credentialId.length >> 8,
      this.credentialId.length & 0xff,
    ]);
    const authData = concat(
      await this.authData(options.rp.id!, 0x45), // user present, user verified, attested credential data
      new Uint8Array(16), // AAGUID
      idLength,
      this.credentialId,
      cosePublicKey,
    );
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]) as Map<string, never>,
    );
    const id = isoBase64URL.fromBuffer(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: clientData("webauthn.create", options.challenge, origin),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  async authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    origin: string,
  ): Promise<AuthenticationResponseJSON> {
    const clientDataJSON = clientData("webauthn.get", options.challenge, origin);
    const authData = await this.authData(options.rpId!, 0x05); // user present, user verified
    const clientHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", isoBase64URL.toBuffer(clientDataJSON)),
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.keys.privateKey,
        concat(authData, clientHash),
      ),
    );
    const id = isoBase64URL.fromBuffer(this.credentialId);
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON,
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(toDer(signature)),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
    };
  }

  private async authData(rpId: string, flags: number) {
    const rpIdHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)),
    );
    const count = ++this.counter;
    const counter = new Uint8Array([
      count >>> 24,
      (count >>> 16) & 0xff,
      (count >>> 8) & 0xff,
      count & 0xff,
    ]);
    return concat(rpIdHash, new Uint8Array([flags]), counter);
  }
}

function clientData(type: string, challenge: string, origin: string) {
  return isoBase64URL.fromUTF8String(
    JSON.stringify({ type, challenge, origin, crossOrigin: false }),
  );
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** WebCrypto signs ECDSA as raw r‖s; WebAuthn expects an ASN.1 DER SEQUENCE of two INTEGERs. */
function toDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const integer = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const trimmed = bytes.slice(i);
    const body = trimmed[0]! & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, body.length]), body);
  };
  const seq = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(new Uint8Array([0x30, seq.length]), seq);
}
