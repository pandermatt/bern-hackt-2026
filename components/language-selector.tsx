"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { storeLocale } from "@/lib/locale";

/**
 * The de/en pill in the header.
 *
 * Switching writes the choice to localStorage and the cookie *before*
 * navigating, so the language is already remembered by the time the server
 * renders the next page — and so `components/locale-sync.tsx` reads the new
 * value rather than bouncing the user back.
 */
export function LanguageSelector() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function handleSwitch(next: AppLocale) {
    if (next === locale) return;
    storeLocale(next);

    // `pathname` here is locale-free, and the query string is carried across so
    // a switch made while filtering does not throw the filters away.
    const query = Object.fromEntries(new URLSearchParams(window.location.search));
    startTransition(() => {
      router.replace({ pathname, query }, { locale: next });
    });
  }

  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface-muted/50 p-1"
      aria-busy={pending}
    >
      {routing.locales.map((l) => {
        const selected = locale === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => handleSwitch(l)}
            aria-current={selected ? "true" : undefined}
            className={`flex cursor-pointer items-center justify-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide transition-colors ${
              selected ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text"
            }`}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
