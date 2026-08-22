/**
 * Stand-ins for the two next-intl modules a server action reaches for.
 *
 * `app/actions/auth.ts` now redirects through `@/i18n/navigation` and phrases
 * its errors through `getTranslations`, neither of which works outside a Next
 * request. These keep the actions callable from a plain vitest process while
 * still exercising the real catalog — an error message asserted here is the
 * one `messages/en.json` actually ships, so a key deleted from the catalog
 * fails the test rather than silently rendering nothing.
 */
import en from "../../messages/en.json";

type Href = string | { pathname: string; query?: Record<string, string> };

/** `{ href: "/login", locale: "en" }` → `/en/login`, the URL Next would emit. */
export function redirectUrl(args: { href: Href; locale: string }): string {
  const { href, locale } = args;
  const pathname = typeof href === "string" ? href : href.pathname;
  const query = typeof href === "string" ? undefined : href.query;
  const search = query ? new URLSearchParams(query).toString() : "";
  const base = `/${locale}${pathname === "/" ? "" : pathname}`;
  return search ? `${base}?${search}` : base;
}

/** The English catalog, as a next-intl-shaped translator. */
export function translator(namespace: string) {
  const messages = (en as Record<string, Record<string, string>>)[namespace] ?? {};
  return (key: string) => messages[key] ?? key;
}
