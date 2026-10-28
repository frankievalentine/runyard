import { BOAT_ACTIVE_STATES, type BoatLimits, type BoatSandbox } from "@runyard/core";
import type { Fetch } from "../github/client.ts";

export const BOAT_API = "https://boat.dev/api/v1";
const TIMEOUT_MS = 20_000;
const MAX_PAGES = 10;

export class BoatError extends Error {}

type RawSandbox = {
  id: string;
  name?: string | null;
  state: string;
  type?: string;
  vcpu?: number | null;
  memoryGB?: number | null;
  createdAt: string;
  cost?: { dollars?: number } | null;
};
type RawLimits = {
  activeSandboxes: number;
  maxActiveSandboxes: number;
  starts?: { unlimited?: boolean; minute?: { limit: number | null; used: number | null } };
  sandboxPlanKey?: string;
};

/** boat's API with a read-only key: VMs and account limits. Runyard never creates or changes VMs. */
export class BoatApi {
  constructor(
    private readonly fetch: Fetch,
    private readonly token: string,
  ) {}

  private async get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetch(
        new Request(`${BOAT_API}${path}`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.token}`,
            "User-Agent": "runyard",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      );
    } catch (error) {
      throw new BoatError(
        `Couldn't reach boat: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (res.status === 401)
      throw new BoatError("boat rejected the API key (401). It may have expired or been revoked.");
    if (res.status === 403)
      throw new BoatError(
        "boat refused this API key (403). It needs sandbox and account read access.",
      );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new BoatError(`boat returned ${res.status}${body?.message ? `: ${body.message}` : ""}`);
    }
    return res.json();
  }

  /** VMs that are, or are about to be, billing, with this month's cost. */
  async runningSandboxes(): Promise<BoatSandbox[]> {
    const out: BoatSandbox[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({
        state: BOAT_ACTIVE_STATES.join(","),
        include: "cost",
        limit: "200",
      });
      if (cursor) query.set("cursor", cursor);
      const body = (await this.get(`/sandboxes?${query.toString()}`)) as {
        sandboxes: RawSandbox[];
        pageInfo?: { nextCursor: string | null; hasMore: boolean };
      };
      for (const s of body.sandboxes) {
        out.push({
          id: s.id,
          name: s.name ?? s.id,
          state: s.state,
          type: s.type ?? "default",
          vcpu: s.vcpu ?? null,
          memoryGB: s.memoryGB ?? null,
          createdAt: Date.parse(s.createdAt),
          // The per-VM cost shape isn't documented; anything else reads as unknown.
          dollars: typeof s.cost?.dollars === "number" ? s.cost.dollars : null,
        });
      }
      cursor = body.pageInfo?.hasMore ? body.pageInfo.nextCursor : null;
      if (!cursor) break;
    }
    return out;
  }

  async limits(): Promise<BoatLimits> {
    const raw = (await this.get("/limits")) as RawLimits;
    const minute = raw.starts?.minute;
    return {
      activeSandboxes: raw.activeSandboxes,
      maxActiveSandboxes: raw.maxActiveSandboxes,
      startsThisMinute:
        raw.starts?.unlimited || minute?.limit == null
          ? null
          : { used: minute.used ?? 0, limit: minute.limit },
      plan: raw.sandboxPlanKey ?? "unknown",
    };
  }
}
