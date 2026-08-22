"use client";

import { useEffect } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { readStoredLocale, storeLocale } from "@/lib/locale";

/**
 * Keeps the remembered language and the rendered one in agreement.
 *
 * Rendered once by the root layout, draws nothing, and does one of two things
 * on mount:
 *
 * - **Nothing remembered, or it already matches** — writes the active locale
 *   back to localStorage and refreshes the cookie, so a browser that dropped
 *   the cookie still comes back in the same language.
 * - **A different language remembered** — navigates to it, once.
 *
 * "Once" is what `sessionStorage` guards. Without it a shared `/en/...` link
 * would be yanked back to German on every single navigation for anyone whose
 * preference is German; with it, the preference is applied when a tab first
 * opens the app and the URL wins from then on — including when the language
 * switcher deliberately moves the other way.
 */
const APPLIED_KEY = "beyond-money.locale-applied";

function alreadyApplied(): boolean {
  try {
    return window.sessionStorage.getItem(APPLIED_KEY) === "1";
  } catch {
    // No session storage (private mode, storage disabled) means no guard, and
    // no guard means a redirect loop risk. Treat it as "already applied".
    return true;
  }
}

function markApplied(): void {
  try {
    window.sessionStorage.setItem(APPLIED_KEY, "1");
  } catch {
    // Nothing to do — the branch above fails closed.
  }
}

export function LocaleSync({ locale }: { locale: AppLocale }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const stored = readStoredLocale();

    if (!stored || stored === locale) {
      storeLocale(locale);
      markApplied();
      return;
    }

    if (alreadyApplied()) {
      // The URL is the deliberate choice now — remember *it* instead.
      storeLocale(locale);
      return;
    }

    markApplied();
    // `usePathname` from `@/i18n/navigation` returns the path without its
    // locale prefix, so this re-prefixes rather than stacking a second one.
    // The query string is carried across by hand: the dashboard keeps its
    // filters there, and dropping them would silently reset the view.
    // `window.location` is read rather than `useSearchParams` so this needs no
    // Suspense boundary of its own.
    router.replace(
      { pathname, query: Object.fromEntries(new URLSearchParams(window.location.search)) },
      { locale: stored },
    );
  }, [locale, pathname, router]);

  return null;
}
