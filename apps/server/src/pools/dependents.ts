import type { Db } from "../db/index.ts";
import { listDispatches, listRegistrations, listTemplates } from "./store.ts";

/**
 * What Runyard still has out in the world for a machine or a forge: runners
 * it registered, on-demand runner software it installed, and one-job runners
 * still going. Removing the machine or the forge's credentials first would
 * leave these behind with no way for Runyard to remove them.
 */
export function dependents(db: Db, filter: { machineId?: string; forgeId?: string }) {
  const matches = (x: { machineId: string; scope: { forgeId: string } }) =>
    (!filter.machineId || x.machineId === filter.machineId) &&
    (!filter.forgeId || x.scope.forgeId === filter.forgeId);
  const runners = listRegistrations(db)
    .filter(matches)
    .map((r) => r.runnerName);
  const templates = listTemplates(db)
    .filter(matches)
    .map((t) => `${t.poolName} runner software`);
  const running = listDispatches(db)
    .filter((d) => (d.state === "starting" || d.state === "running") && matches(d))
    .map((d) => `${d.runnerName} (running a job)`);
  return [...runners, ...templates, ...running];
}

/** The refusal for removing something that still has dependents, naming them. */
export function stillInUse(what: string, names: string[], how: string): string {
  const shown =
    names.slice(0, 5).join(", ") + (names.length > 5 ? `, and ${names.length - 5} more` : "");
  return `${what} still has ${shown}. ${how}`;
}
