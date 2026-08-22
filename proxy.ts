import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from 'next-intl/middleware';
import { SESSION_COOKIE } from "@/lib/site";

const intlProxy = createMiddleware({
  locales: ['de', 'en'],
  defaultLocale: 'de'
});

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
  const pathWithoutLocale = pathname.replace(/^\/(de|en)/, '') || '/';
  
  const isAuthRoute = pathWithoutLocale === "/login" || pathWithoutLocale === "/register";

  // "/" is public: it serves the landing page when signed out and the
  // dashboard when signed in, so it must not be redirected away here.
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
  // so this direction is safe to decide here.
  if (!hasCookie && !isPublic) {
    const match = pathname.match(/^\/(de|en)/);
    const locale = match ? match[1] : 'de';
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }

  // The opposite direction is NOT safe here, and used to be: bouncing /login to
  // "/" whenever a cookie was present assumed presence meant signed in. After a
  // redeploy that rebuilt the database, every browser still held a cookie whose
  // session row was gone — so "/" rendered the landing page, its "Sign in" link
  // went to /login, and /login bounced straight back to "/". An unbreakable
  // loop, with no way to sign in short of clearing cookies by hand.
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
    "/(de|en)/:path*"
  ],
};
