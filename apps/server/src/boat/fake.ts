import { Hono } from "hono";
import type { Fetch } from "../github/client.ts";

type Sandbox = {
  id: string;
  name: string;
  state: string;
  type: string;
  vcpu: number;
  memoryGB: number;
  createdAt: string;
  cost?: { since: string; seconds: number; dollars: number };
};

/** A stand-in for boat's API (shapes from docs.boat.dev). */
export class FakeBoat {
  token = "boat_test_readonly_key";
  sandboxes: Sandbox[] = [];
  limits = {
    ok: true,
    type: "limits.info",
    canStart: true,
    activeSandboxes: 0,
    maxActiveSandboxes: 100,
    starts: { unlimited: false, minute: { limit: 12, used: 0, remaining: 12 } },
    sandboxPlanKey: "box_20",
  };
  /** Every request's method and path, to prove Runyard only reads. */
  requests: string[] = [];
  readonly fetch: Fetch;

  constructor() {
    const app = new Hono().basePath("/api/v1");
    app.use("*", async (c, next) => {
      this.requests.push(`${c.req.method} ${new URL(c.req.url).pathname}`);
      if (c.req.header("authorization") !== `Bearer ${this.token}`) {
        return c.json({ ok: false, code: "unauthorized", message: "Invalid API key" }, 401);
      }
      await next();
    });
    app.get("/limits", (c) => c.json(this.limits));
    app.get("/sandboxes", (c) => {
      const states = (c.req.query("state") ?? "").split(",").filter(Boolean);
      const list = this.sandboxes.filter((s) => states.length === 0 || states.includes(s.state));
      const withCost = c.req.query("include") === "cost";
      return c.json({
        ok: true,
        type: "sandbox.list",
        sandboxes: list.map((s) => (withCost ? s : { ...s, cost: undefined })),
        pageInfo: { nextCursor: null, hasMore: false, limit: 200 },
      });
    });
    this.fetch = async (request) => app.fetch(request);
  }
}
