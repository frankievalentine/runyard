import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testApp } from "./testing.ts";

test("GET /api/health reports ok", async () => {
  const res = await (await testApp()).app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true });
});

describe("dashboard", () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof testApp>>["app"];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "runyard-dashboard-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>Runyard</title>");
    await writeFile(join(dir, "assets", "index-abc.js"), "console.log(1)");
    app = (
      await testApp({
        dashboard: new Map([
          ["/index.html", join(dir, "index.html")],
          ["/assets/index-abc.js", join(dir, "assets", "index-abc.js")],
        ]),
      })
    ).app;
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  test("serves index.html for client-side routes", async () => {
    for (const path of ["/", "/machines/studio"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(await res.text()).toContain("<title>Runyard</title>");
    }
  });

  test("caches hashed assets forever", async () => {
    const res = await app.request("/assets/index-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  test("404s missing files and unknown API routes instead of serving the app", async () => {
    expect((await app.request("/assets/missing.js")).status).toBe(404);
    const api = await app.request("/api/nope");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: "Not found." });
  });
});

test("health names the dashboard build, which changes with its files", async () => {
  const { dashboardBuild } = await import("./app.ts");
  const a = dashboardBuild(
    new Map([
      ["/index.html", "x"],
      ["/assets/index-abc.js", "y"],
    ]),
  );
  const b = dashboardBuild(
    new Map([
      ["/index.html", "x"],
      ["/assets/index-def.js", "y"],
    ]),
  );
  expect(a).toMatch(/^[0-9a-f]{12}$/);
  expect(a).not.toBe(b);
  expect(dashboardBuild()).toBeNull();
});
