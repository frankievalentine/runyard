import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { api, call } from "../api.ts";

/** Passkeys need a secure context (HTTPS or localhost); plain-HTTP access keeps passwords only. */
export function passkeysAvailable(): boolean {
  return window.isSecureContext && browserSupportsWebAuthn();
}

export async function signInWithPasskey() {
  const { challengeId, options } = await call(api.passkeys.login.options.$post());
  const response = await startAuthentication({ optionsJSON: options }).catch(rethrowCancel);
  return call(api.passkeys.login.verify.$post({ json: { challengeId, response } }));
}

export async function addPasskey(name: string) {
  const { challengeId, options } = await call(api.passkeys.register.options.$post());
  const response = await startRegistration({ optionsJSON: options }).catch(rethrowCancel);
  return call(api.passkeys.register.verify.$post({ json: { challengeId, name, response } }));
}

/** The browser reports a dismissed prompt as NotAllowedError; say so plainly. */
function rethrowCancel(error: unknown): never {
  if (error instanceof Error && error.name === "NotAllowedError") {
    throw new Error("The passkey prompt was dismissed or timed out.");
  }
  throw error;
}
