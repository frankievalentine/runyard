import type { Context } from "hono";
import { requestOrigin, type Listener } from "./auth/identity.ts";

/** URL path (`/index.html`, `/assets/x.js`) to a file Bun can read; embedded in the compiled binary. */
export type DashboardAssets = ReadonlyMap<string, string>;

/** Link previews need absolute URLs; index.html carries this in their place. */
const ORIGIN_PLACEHOLDER = "__RUNYARD_ORIGIN__";
/** Only a plain scheme, host and port goes into the page; anything else falls back to relative URLs. */
const PLAIN_ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/**
 * Serves the built dashboard. Paths without a file extension are client-side
 * routes and get `index.html`, with its link-preview URLs made absolute for
 * the address the request came to; hashed `/assets/*` files are cached forever.
 */
export function serveDashboard(assets: DashboardAssets, listener: Listener = "tcp") {
  let indexHtml: Promise<string> | undefined;
  return async (c: Context) => {
    const path = c.req.path;
    if (path === "/api" || path.startsWith("/api/")) return c.json({ error: "Not found." }, 404);
    const isRoute = !/\.[a-z0-9]+$/i.test(path);
    const index = isRoute || path === "/index.html";
    const file = index ? assets.get("/index.html") : assets.get(path);
    if (!file) return c.text("Not found.", 404);
    if (index) {
      indexHtml ??= Bun.file(file).text();
      const html = (await indexHtml).replaceAll(ORIGIN_PLACEHOLDER, previewOrigin(c, listener));
      return c.html(html, 200, { "Cache-Control": "no-cache" });
    }
    const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return new Response(Bun.file(file), { headers: { "Cache-Control": cache } });
  };
}

/** This install's origin for link previews, or "" (relative URLs) when the request's host isn't plain. */
function previewOrigin(c: Context, listener: Listener): string {
  try {
    const { origin } = requestOrigin(c, listener);
    return PLAIN_ORIGIN.test(origin) ? origin : "";
  } catch {
    // A Host header that isn't a URL at all.
    return "";
  }
}
