import type { Timed } from "../machines/derive.ts";

/** A boat VM as its API lists it. */
export type BoatSandbox = {
  id: string;
  name: string;
  state: string;
  /** small, default, large or xlarge. */
  type: string;
  vcpu: number | null;
  memoryGB: number | null;
  createdAt: number;
  /** List-price cost this UTC month, when boat reports it. */
  dollars: number | null;
};

export type BoatLimits = {
  activeSandboxes: number;
  maxActiveSandboxes: number;
  /** Starts this minute against the plan's cap; null when unlimited. */
  startsThisMinute: { used: number; limit: number } | null;
  plan: string;
};

/** What Runyard has read from boat with a read-only key. */
export type BoatObservation = {
  sandboxes: Timed<BoatSandbox[]> | null;
  limits: Timed<BoatLimits> | null;
  error: string | null;
};

/** Read like GitHub's runners: stale after missing a few polls. */
export const BOAT_STALE_AFTER_MS = 150_000;
