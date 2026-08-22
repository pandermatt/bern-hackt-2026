import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { LOCALE_COOKIE_NAME, routing } from "@/i18n/routing";
import { SESSION_COOKIE } from "@/lib/site";

// Reads its locales, its default and its cookie settings from `i18n/routing.ts`
// rather than repeating them — the two lists drifting apart is how a locale
// ends up routable but unlinkable.
const intlProxy = createMiddleware(routing);

const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

/** The locale the request is already in, or the one its cookie asks for. */
function localeOf(request: NextRequest): string {
  const fromPath = request.nextUrl.pathname.match(LOCALE_PREFIX)?.[1];
  if (fromPath) return fromPath;

  const fromCookie = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  if (fromCookie && (routing.locales as readonly string[]).includes(fromCookie)) {
    return fromCookie;
  }

  return routing.defaultLocale;
}

/**
 * An optimistic redirect only — this runs on the edge runtime and cannot reach
 * SQLite, so it checks for the presence of a cookie and nothing more. The
 * authoritative check is `getCurrentUser()` in the page and in every server
 * action; a forged cookie gets past this and is rejected there.
 *
 * (Next 16 renamed the `middleware` convention to `proxy`.)
 */
export function proxy(request: NextRequest) {
  // Handle i18n routing first
  const response = intlProxy(request);

  const hasCookie = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  // Strip locale for auth checking
  const pathWithoutLocale = pathname.replace(LOCALE_PREFIX, "") || "/";

  const isAuthRoute = pathWithoutLocale === "/login" || pathWithoutLocale === "/register";

  // "/" is public: it is the marketing landing page, and bouncing it to /login
  // would make it unreachable. It no longer doubles as the dashboard — that
  // moved to /dashboard, and the signed-in entry page is /home; both are
  // protected by their absence from this list.
  //
  // The rest are requested by things that never carry a session cookie: link
  // crawlers (the OG image), the browser's install prompt (the manifest), and
  // the host's healthcheck. Without them here, each one gets a 307 to /login.
  const isPublic =
    isAuthRoute ||
    pathWithoutLocale === "/" ||
    pathWithoutLocale === "/api/health" ||
    pathWithoutLocale === "/opengraph-image" ||
    pathWithoutLocale === "/manifest.webmanifest" ||
    // The worker registers before anyone signs in, and it precaches /offline
    // with credentials omitted — both requests arrive without a cookie.
    pathWithoutLocale === "/sw.js" ||
    pathWithoutLocale === "/offline";

  // A *missing* cookie is conclusive — nobody holding no cookie is signed in —
  // so this direction is safe to decide here. The bounce keeps the language:
  // sending everyone to the default locale's /login is what made an English
  // session revert to German the moment a session expired.
  if (!hasCookie && !isPublic) {
    return NextResponse.redirect(new URL(`/${localeOf(request)}/login`, request.url));
  }

  // The opposite direction is NOT safe here, and used to be: bouncing /login
  // away whenever a cookie was present assumed presence meant signed in. After
  // a redeploy that rebuilt the database, every browser still held a cookie
  // whose session row was gone — so "/" rendered the landing page, its "Sign
  // in" link went to /login, and /login bounced straight back. An unbreakable
  // loop, with no way to sign in short of clearing cookies by hand. The same
  // trap now guards "/", which redirects to /home only after `getCurrentUser`
  // confirms the session is real.
  //
  // Only `getCurrentUser()` can tell a live session from a dead one, so
  // app/login and app/register do that redirect themselves.

  return response;
}

export const config = {
  matcher: [
    // Match all pathnames except for
    // - … if they start with `/api`, `/_next` or `/_vercel`
    // - … the ones containing a dot (e.g. `favicon.ico`)
    "/((?!api|_next|_vercel|.*\\..*).*)",
    "/",
    "/(de|en)/:path*",
  ],
};
