/**
 * Services that start a fresh VM per job when a workflow asks for their
 * labels. Their runners exist only while a job runs, so a queued job never
 * has a matching runner ahead of time. Labels are matched exactly.
 */
export const ON_DEMAND_SERVICES: readonly { name: string; labels: readonly string[] }[] = [
  // https://docs.boat.dev/ci.md
  { name: "boat", labels: ["boat", "boat-small", "boat-large", "boat-xlarge"] },
];

/** The service a job's or runner's labels ask for, if any. */
export function onDemandService(labels: readonly string[]): string | null {
  const have = new Set(labels.map((l) => l.toLowerCase()));
  return ON_DEMAND_SERVICES.find((s) => s.labels.some((l) => have.has(l)))?.name ?? null;
}
