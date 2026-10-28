import type { OsFamily } from "../machines/model.ts";
import type { RunnerKind, Scope } from "../model.ts";

/** Runner capacity: labels, the machines it runs on (with runners per machine) and the scopes it serves. */
export type Pool = {
  id: string;
  /** Lowercase letters, digits and dashes; part of runner names, labels and paths. */
  name: string;
  labels: string[];
  machines: { machineId: string; slots: number }[];
  scopes: Scope[];
  /** Where Forgejo runners run jobs: on the machine, or in Docker containers from an image. */
  forgejoMode: ForgejoMode;
  /**
   * Persistent pools keep registered runners; on-demand pools keep only a runner
   * template per machine and start a one-job runner for each matching queued job.
   */
  mode: PoolMode;
  /** On demand only: no new runners start while paused. */
  paused: boolean;
};

export type PoolMode = "persistent" | "onDemand";

/**
 * The runner software an on-demand pool needs on one machine: unpacked, never
 * configured. One-job runners are copied from it.
 */
export type DesiredTemplate = {
  /** Stable identity: pool, machine and runner program. */
  key: string;
  poolId: string;
  poolName: string;
  machineId: string;
  os: OsFamily;
  runnerKind: RunnerKind;
  path: string;
  /** The pool's scopes this runner program serves. */
  scopes: Scope[];
  labels: string[];
  forgejoMode?: ForgejoMode;
};

/** A template Runyard installed, kept so it can be removed when no longer wanted. */
export type TemplateRecord = {
  key: string;
  machineId: string;
  poolId: string;
  poolName: string;
  /** One of the scopes it served, for display. */
  scope: Scope;
  runnerKind: RunnerKind;
  path: string;
  serviceMode: ServiceMode;
};

/** A probe of a template directory. */
export type LocalTemplate = { path: string; present: boolean; version: string | null };

export type ForgejoMode = { kind: "host" } | { kind: "docker"; image: string };

/** How a runner runs on its machine, from fleet's service modes. */
export type ServiceMode = "launchagent" | "systemd" | "windows-service";

export function serviceModeFor(os: OsFamily): ServiceMode | null {
  if (os === "macos") return "launchagent";
  if (os === "linux") return "systemd";
  if (os === "windows") return "windows-service";
  return null;
}

/** One runner that should exist: derived from pools, never authored. */
export type DesiredRunner = {
  /** Stable identity: pool, machine, scope and slot. */
  key: string;
  poolId: string;
  poolName: string;
  machineId: string;
  scope: Scope;
  slot: number;
  /** The name it registers with. Unique within its scope. */
  name: string;
  /** Its exact directory on the machine, under the Runyard runner root. */
  path: string;
  /** Labels Runyard sets, besides the ones GitHub adds itself. */
  labels: string[];
  serviceMode: ServiceMode;
  /** Which runner program: GitHub's actions/runner or forgejo-runner. */
  runnerKind: RunnerKind;
  /** Forgejo only: how each label runs jobs. */
  forgejoMode?: ForgejoMode;
};

/** What the machine reports for a runner directory, from the read-only probe. */
export type LocalRunner = {
  path: string;
  configured: boolean;
  /** `active`/`running`, `inactive`/`stopped`, `uninstalled`, `missing` or `unknown`. */
  service: string;
  version: string | null;
  /** The runner name in the directory's `.runner`, when configured. */
  agentName: string | null;
};

/** What GitHub reports for a runner with the desired name in the desired scope. */
export type RemoteRunner = {
  id: number;
  name: string;
  status: "online" | "offline";
  busy: boolean;
  labels: string[];
};

/** Fleet's guard: a running service is active (systemd), running (Windows) or active (launchctl). */
export function isActive(service: string): boolean {
  return service === "active" || service === "running";
}
