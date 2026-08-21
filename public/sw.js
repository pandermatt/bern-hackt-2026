/*
 * Minimal service worker: enough to make the app installable and to replace
 * the browser's offline error with our own page.
 *
 * Deliberately conservative about what it stores. Page responses are NEVER
 * cached — the dashboard is per-account HTML, and persisting it in Cache
 * Storage would leave one user's finances readable on a shared device after
 * sign-out. Only versioned build assets and the offline page are kept.
 *
 * Bump CACHE when this file changes so the activate handler can drop the old
 * one.
 */
const CACHE = "beyond-money-v1";
const OFFLINE_URL = "/offline";

const PRECACHE = [OFFLINE_URL, "/icon.svg", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (url) => {
          /*
           * `credentials: "omit"` matters: it fetches the signed-out render of
           * the offline page, so no account's email or transactions end up in the
           * cache. It also means /offline has to be public in proxy.ts.
           */
          const response = await fetch(url, {
            credentials: "omit",
            cache: "no-store",
          });
          if (response.ok) await cache.put(url, response);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Server actions are POSTs; anything non-GET must reach the network untouched.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(OFFLINE_URL)) ??
            new Response("Offline", { status: 503 })
          );
        }
      })(),
    );
    return;
  }

  // Build output is content-hashed, so cache-first is safe and never stale.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;

        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});
