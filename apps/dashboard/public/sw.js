/*
 * Runyard's service worker: keeps the dashboard's shell (the page, its hashed scripts and styles,
 * fonts and icons) so the installed app opens without the network. It never caches the API:
 * requests under /api go straight to the network, so data is always live or visibly unavailable.
 *
 * Pages are network first, so an upgraded Runyard is picked up on the next load; the cached page is
 * only a fallback. Hashed /assets/* files are cache first, and a new build clears the old ones, so
 * they don't pile up.
 */
const CACHE = "runyard-shell-v1";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(page(request));
  } else if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  }
});

/** The page from the network (kept as the offline copy), or the last copy when offline. */
async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put("/", response.clone());
      void prune(cache, await response.clone().text());
    }
    return response;
  } catch (error) {
    const cached = await cache.match("/");
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/**
 * When the page references a different build (its entry scripts changed), drops every cached
 * /assets/* file from earlier builds; they're fetched again as the new build uses them. Lazily
 * loaded route chunks aren't named in the page, so pruning only happens on a build change.
 */
async function prune(cache, html) {
  const build = (html.match(/\/assets\/[^"'\s)]+/g) ?? []).sort().join(" ");
  const marker = new Request("/__runyard-build");
  const previous = await cache.match(marker);
  if (previous && (await previous.text()) === build) return;
  await cache.put(marker, new Response(build));
  if (!previous) return;
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.startsWith("/assets/")) await cache.delete(request);
  }
}
