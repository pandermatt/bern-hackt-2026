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

/**
 * The English catalog, as a next-intl-shaped translator.
 *
 * Keys are resolved along the dots, because a namespace is not flat — the
 * anomaly rules nest a `title` and a `description` under each rule id. A key
 * that resolves to anything but a string comes back as itself, which is what
 * next-intl renders for a missing message.
 */
export function translator(namespace: string) {
  const messages = (en as Record<string, unknown>)[namespace];

  const lookup = (key: string): string | undefined => {
    const value = key.split(".").reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    );
    return typeof value === "string" ? value : undefined;
  };

  /*
   * Simple `{name}` substitution only. Enough for an error message or a
   * finding's sentence; ICU plurals and selects are left as they are written,
   * which is visible in a failing assertion rather than silently wrong.
   */
  const t = (key: string, values?: Record<string, string | number>) => {
    const message = lookup(key);
    if (message === undefined) return key;
    if (!values) return message;
    return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in values ? String(values[name]) : whole,
    );
  };

  t.has = (key: string) => lookup(key) !== undefined;

  return t;
}
