import { defineRouting } from "next-intl/routing";

/**
 * The single source of truth for which locales exist and how they appear in a
 * URL. `proxy.ts`, `i18n/request.ts` and `i18n/navigation.ts` all read from
 * here — a locale added in one place and forgotten in another is exactly the
 * bug that made links drop the prefix.
 */
/** Read by the proxy on the server and written by the browser — keep in sync. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export const routing = defineRouting({
  locales: ["de", "en"],
  defaultLocale: "de",

  // Every route carries its locale, so a URL is unambiguous and shareable.
  localePrefix: "always",

  // The cookie is what lets the *server* honour a choice made in the browser:
  // it is read by the proxy when a request arrives without a prefix (a bare
  // "/", a redirect, a bookmarked link). `components/locale-sync.tsx` mirrors
  // it into localStorage and restores it from there, so the preference also
  // survives a cookie the browser dropped.
  localeCookie: {
    name: LOCALE_COOKIE_NAME,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },
});

export type AppLocale = (typeof routing.locales)[number];

export const locales = routing.locales;
export const defaultLocale = routing.defaultLocale;

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return !!value && (routing.locales as readonly string[]).includes(value);
}
