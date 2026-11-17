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

/** A name for a new passkey from the device it's made on, which the person can change. */
export function suggestedPasskeyName(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android phone";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows PC";
  if (/Linux/.test(userAgent)) return "Linux computer";
  return "This device";
}
