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
const CACHE = "beyond-money-v2";

/*
 * Mirrors `i18n/routing.ts`, which cannot be imported here — a service worker
 * is a plain script served from public/, outside the module graph. A locale
 * added there and forgotten here loses only its offline page (the fallback
 * below covers it), but keep the two lists together anyway.
 */
const LOCALES = ["de", "en"];
const DEFAULT_LOCALE = "de";

/*
 * Prefixed, because `localePrefix` is "always" and a bare "/offline" is a
 * redirect to "/de/offline". Precaching the redirect used to break this twice
 * over: the stored copy was whatever the *default* locale rendered, so an
 * English visitor's offline page came back in German, and it was a redirected
 * response — see the note in `cachePut`.
 */
const OFFLINE_URLS = LOCALES.map((locale) => `/${locale}/offline`);
const DEFAULT_OFFLINE_URL = `/${DEFAULT_LOCALE}/offline`;

/* Every path here has to exist: `cache.addAll` rejects as a whole on a single
   404, which fails the install and takes the offline page with it. */
const PRECACHE = [...OFFLINE_URLS, "/icon.svg", "/icon-192.png"];

/** The offline page matching a navigation's locale, else the default's. */
function offlineUrlFor(pathname) {
  const locale = pathname.split("/")[1];
  return LOCALES.includes(locale) ? `/${locale}/offline` : DEFAULT_OFFLINE_URL;
}

/*
 * A navigation request has `redirect: "manual"`, and the browser refuses to
 * satisfy one with a response whose `redirected` flag is set — it fails the
 * fetch and shows its own error page, which is precisely what the offline page
 * exists to prevent. Rebuilding the response drops the flag; everything a
 * cached page needs (status, headers, body) is copied across.
 */
async function cachePut(cache, url, response) {
  if (!response.ok) return;

  const body = await response.blob();
  await cache.put(
    url,
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  );
}

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
          await cachePut(cache, url, response);
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
          // Answer in the language of the page they were trying to reach.
          return (
            (await cache.match(offlineUrlFor(url.pathname))) ??
            (await cache.match(DEFAULT_OFFLINE_URL)) ??
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
