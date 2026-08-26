/**
 * The always-on half of the deployment.
 *
 * Beyond Money's demo server is a Hetzner box that exists for a few hours every
 * few months — Hetzner bills a server until it is *deleted*, not until it is
 * powered off, so between demos it is destroyed and recreated from a snapshot
 * (`docs/demo-runbook.md`). The marketing page has to be up on the other 89
 * days, and this Worker is what keeps it there.
 *
 * It sits on the zone in front of the origin. While the box exists everything
 * is proxied to it and this file is a pipe. While the box is gone the edge
 * answers from a prerendered copy of the landing page, and every other address
 * gets the app's own `/offline` page — the same page `public/sw.js` shows when
 * the *browser* is offline, which is why there was no new screen to design.
 *
 * The prerendered documents are curled out of a real `next start` by the
 * `deploy-edge` job in `.github/workflows/ci.yml` and shipped alongside
 * `_next/static` and `public/`, so they are always this build's.
 *
 * ## What this deliberately does not do
 *
 * It does not look at the session cookie, and it does not serve the landing
 * page from the edge while the origin is up. Doing so would save the box a
 * render, and would mean deciding here — with no database — whether a visitor
 * is signed in and belongs at `/home` instead. `proxy.ts` has a long comment
 * about the redirect loop that guess caused the last time it was made. The box
 * is up a few hours a quarter; there is nothing worth optimising, so while it
 * is up it answers for itself and is the only thing that does.
 */

interface Env {
  /** The prerendered documents, `_next/static` and `public/`. */
  ASSETS: Fetcher;
  /**
   * The tunnel hostname the Hetzner box dials out to, e.g.
   * `https://origin.beyond-money.ch`. It must not be a hostname this Worker is
   * routed on, or a proxied request loops straight back into it.
   */
  ORIGIN: string;
}

/**
 * Mirrors `i18n/routing.ts`, which cannot be imported here — this is a
 * separate bundle compiled for the Workers runtime, outside the app's module
 * graph. `public/sw.js` carries the same duplication for the same reason; keep
 * the three lists together.
 */
const LOCALES = ["de", "en"];
const DEFAULT_LOCALE = "de";

/** Mirrors `LOCALE_COOKIE_NAME` in `i18n/routing.ts`. */
const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * Mirrors `lib/demo-asleep.ts`. Stripped from every inbound request: the
 * origin trusts it, and it is this Worker's to set at build time and nobody
 * else's to send.
 */
const DEMO_ASLEEP_HEADER = "x-demo-asleep";

/**
 * Paths answered from the assets bundle rather than the origin, so the
 * prerendered pages keep their styling, fonts and mascot with the box gone.
 * Everything under `_next/static` is content-hashed, so the edge copy and the
 * origin's can never disagree — a stale entry is unreachable rather than wrong.
 */
const ASSET_PREFIXES = [
  "/_next/static/",
  "/fonts/",
  "/dragons/",
  "/icon",
  "/apple-icon",
  "/favicon",
  "/team.jpg",
  "/sw.js",
];

/** How long one origin liveness answer is reused within an isolate. */
const PROBE_TTL_MS = 60_000;
/** A probe slower than this is a box that is not going to serve a page either. */
const PROBE_TIMEOUT_MS = 3_000;
/** Budget for one proxied request. Longer than the probe: the assistant thinks. */
const PROXY_TIMEOUT_MS = 30_000;

/**
 * Best-effort, per-isolate liveness memo. Not the Cache API on purpose — an
 * isolate is short-lived and per-colocation, which is exactly the scope this
 * wants, and it costs no subrequest. The in-flight promise is held rather than
 * just the answer so that a burst of requests arriving cold shares one probe
 * instead of opening one apiece.
 */
let probe: { at: number; result: Promise<boolean> } | null = null;

function originUp(env: Env): Promise<boolean> {
  const now = Date.now();
  if (probe && now - probe.at < PROBE_TTL_MS) return probe.result;

  const result = fetch(`${env.ORIGIN}/api/health`, {
    // `/api/health` touches the database, so a 200 means genuinely serving
    // rather than merely booted — see the note in `app/api/health/route.ts`.
    method: "GET",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
    .then((response) => response.ok)
    .catch(() => false);

  probe = { at: now, result };
  return result;
}

/** The locale a request is already in, or the one its cookie asks for. */
function localeOf(request: Request, pathname: string): string {
  const fromPath = pathname.split("/")[1];
  if (LOCALES.includes(fromPath)) return fromPath;

  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`));
  const fromCookie = match?.[1];
  if (fromCookie && LOCALES.includes(fromCookie)) return fromCookie;

  return DEFAULT_LOCALE;
}

function isAssetPath(pathname: string): boolean {
  return ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** One of the six documents CI curled out of the build. */
function prerendered(
  env: Env,
  name: string,
  status: number,
): Promise<Response> {
  return env.ASSETS.fetch(new URL(`https://assets.local/${name}`)).then(
    (asset) =>
      new Response(asset.body, {
        status,
        headers: {
          "content-type": "text/html; charset=utf-8",
          // The document is this build's and is replaced on the next deploy;
          // what must not be cached is *which* document a path resolves to,
          // since that flips the moment the box comes back.
          "cache-control": "no-store",
        },
      }),
  );
}

/**
 * Hand the request to the box.
 *
 * The origin is reached at its own hostname, so anything it puts in a
 * `Location` header names that hostname — `proxy.ts` builds its redirects with
 * `new URL(..., request.url)`, and a browser following one would leave the
 * public site for the tunnel. Rewriting them back is what keeps the origin
 * hostname an implementation detail.
 */
async function toOrigin(request: Request, env: Env, url: URL): Promise<Response> {
  const forwarded = new Request(
    `${env.ORIGIN}${url.pathname}${url.search}`,
    request,
  );
  forwarded.headers.delete(DEMO_ASLEEP_HEADER);

  const response = await fetch(forwarded, {
    redirect: "manual",
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  });

  const location = response.headers.get("location");
  if (!location) return response;

  const target = new URL(location, `${env.ORIGIN}${url.pathname}`);
  if (target.origin !== new URL(env.ORIGIN).origin) return response;

  const rewritten = new Response(response.body, response);
  rewritten.headers.set(
    "location",
    `${url.origin}${target.pathname}${target.search}`,
  );
  return rewritten;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Assets first, and from the edge whether or not the box is up: these are
    // what the prerendered pages are made of. A path not in the bundle falls
    // through rather than 404ing, so anything the prefix list forgets still
    // works while the origin is there to answer it.
    if (isAssetPath(pathname)) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }

    if (await originUp(env)) {
      try {
        return await toOrigin(request, env, url);
      } catch {
        // The probe said yes and this request still failed — a box that went
        // away inside the TTL, or one request that hung. Fall through and
        // answer as if it were gone, and retire the memo so the next request
        // finds out for itself rather than waiting out the minute.
        probe = null;
      }
    }

    const locale = localeOf(request, pathname);

    // `localePrefix` is "always", so a bare "/" is never a real page. Sending
    // it on is what `next-intl`'s middleware does when the origin is up.
    if (pathname === "/") {
      return Response.redirect(`${url.origin}/${locale}`, 307);
    }

    // The landing page — the one address that has to work every day.
    if (LOCALES.some((code) => pathname === `/${code}`)) {
      return prerendered(env, `landing-${locale}-asleep.html`, 200);
    }

    // `/offline` answers 200, unlike everything else below it. `public/sw.js`
    // precaches it at install time and its `cachePut` drops anything that is
    // not `response.ok` — served as a 503, the worker would install with no
    // offline page, and the visitor who arrived while the box was gone would
    // be the one visitor without one when their *own* connection dropped.
    if (LOCALES.some((code) => pathname === `/${code}/offline`)) {
      return prerendered(env, `offline-${locale}.html`, 200);
    }

    // Everything else is the app, and the app is not there. 503 rather than
    // 404: the address is real and will work again.
    return prerendered(env, `offline-${locale}.html`, 503);
  },
} satisfies ExportedHandler<Env>;
