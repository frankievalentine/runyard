import type { Context } from "hono";

/** URL path (`/index.html`, `/assets/x.js`) to a file Bun can read; embedded in the compiled binary. */
export type DashboardAssets = ReadonlyMap<string, string>;

/**
 * Serves the built dashboard. Paths without a file extension are client-side
 * routes and get `index.html`; hashed `/assets/*` files are cached forever.
 */
export function serveDashboard(assets: DashboardAssets) {
  return (c: Context) => {
    const path = c.req.path;
    if (path === "/api" || path.startsWith("/api/")) return c.json({ error: "Not found." }, 404);
    const isRoute = !/\.[a-z0-9]+$/i.test(path);
    const file = assets.get(path) ?? (isRoute ? assets.get("/index.html") : undefined);
    if (!file) return c.text("Not found.", 404);
    const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return new Response(Bun.file(file), { headers: { "Cache-Control": cache } });
  };
}
