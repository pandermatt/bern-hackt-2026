import { isAppLocale, LOCALE_COOKIE_NAME, type AppLocale } from "@/i18n/routing";

/**
 * Where the chosen language lives in the browser.
 *
 * Two stores, because they answer two different questions:
 *
 * - **localStorage** is the durable preference. It survives a cookie the
 *   browser cleared, an incognito-to-normal switch, and a deploy, and it is
 *   what `components/locale-sync.tsx` restores from on the first load of a tab.
 * - **The cookie** is the same value in a form the *server* can read. Nothing
 *   on the server can see localStorage, so without it the proxy would still
 *   guess German for every unprefixed request.
 *
 * `storeLocale` always writes both, so they cannot disagree.
 */
export const LOCALE_STORAGE_KEY = "beyond-money.locale";
export const LOCALE_COOKIE = LOCALE_COOKIE_NAME;

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The remembered language, or null if this browser has never chosen one. */
export function readStoredLocale(): AppLocale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isAppLocale(stored) ? stored : null;
  } catch {
    // Safari in private mode throws on localStorage access rather than
    // returning null. A missing preference is not worth a broken page.
    return null;
  }
}

/** Remembers `locale` for both the browser and the server. */
export function storeLocale(locale: AppLocale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // See above — the cookie below still carries the choice.
  }
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}
