import { expect, test } from "bun:test";
import { app } from "./app.ts";

test("GET /api/health reports ok", async () => {
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true });
});
