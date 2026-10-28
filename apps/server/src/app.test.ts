import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.ts";

test("GET /api/health reports ok", async () => {
  const res = await createApp().request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true });
});

describe("dashboard", () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "runyard-dashboard-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>Runyard</title>");
    await writeFile(join(dir, "assets", "index-abc.js"), "console.log(1)");
    app = createApp(
      new Map([
        ["/index.html", join(dir, "index.html")],
        ["/assets/index-abc.js", join(dir, "assets", "index-abc.js")],
      ]),
    );
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
