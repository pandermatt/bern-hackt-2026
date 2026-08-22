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
const CACHE = "beyond-money-v3";

/*
 * The worker used to register in production only, because a worker in front of
 * HMR serves stale modules and looks like a broken app. It now registers
 * everywhere — push notifications are unusable without one, and testing them
 * against a production build every time is not a workflow — so the part that
 * caused that has to stand down instead.
 *
 * `components/sw-register.tsx` registers "/sw.js?dev=1" outside production;
 * the query string is part of the worker's own URL, which is the only channel
 * a plain script served from public/ has for a build-time fact. What it turns
 * off is the `/_next/static/` cache-first branch: dev chunks are not
 * content-hashed, so cache-first there means serving yesterday's module. The
 * offline page, push and notificationclick all still work.
 */
const DEV = new URL(self.location.href).searchParams.has("dev");

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

  // Build output is content-hashed, so cache-first is safe and never stale —
  // which is exactly what stops being true in dev. See DEV above.
  if (!DEV && url.pathname.startsWith("/_next/static/")) {
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

/*
 * The delivery end of Web Push. `lib/push.ts` composes the payload — title,
 * body, and the locale-prefixed URL to open -- and this shows it.
 *
 * Showing *something* is not optional: a push that displays no notification is
 * what Chrome counts against the origin before revoking its permission
 * outright. Hence the fallback title, and hence the try/catch — a push with no
 * body, or a body that is not our JSON, still has to put something on screen.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Beyond Money";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Same tag replaces rather than stacks, so a chatty scan cannot bury a
    // lock screen under twenty copies of itself.
    tag: payload.tag || "beyond-money",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/*
 * Tapping a notification has to land on the page it is about — the anomalies
 * page, in the locale the payload was written in -- and it has to do that
 * whether or not the app is already open.
 *
 * An open window is focused and navigated rather than joined by a second one:
 * an installed PWA has exactly one window, and `openWindow` on top of it is
 * how you end up with two.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        // Navigate first: focusing a window that is showing the wrong page
        // and leaving it there is worse than not opening anything.
        if ("navigate" in client) await client.navigate(url);
        return client.focus();
      }

      return self.clients.openWindow(url);
    })(),
  );
});
