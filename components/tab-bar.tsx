"use client";

import { useTranslations } from "next-intl";

import { TABS } from "@/components/nav-tabs";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * The installed app's bottom navigation, on a phone.
 *
 * In a browser the four top-level pages live in the header, where they fit only
 * by dropping their labels and pushing the wordmark out entirely. Installed to
 * a home screen the app is not a page any more, so they move down here: within
 * reach of a thumb, with their names back, and the header gets its wordmark
 * again.
 *
 * Rendered on every request and hidden with CSS rather than mounted
 * conditionally. Whether the app is standalone is only knowable in the browser,
 * so deciding it in React would mean rendering the header nav first and
 * swapping after hydration — a visible jump on every single load. The blocking
 * script in the root layout settles it before first paint instead, and the
 * `app-shell:` variant (see `app/globals.css`) reads what it wrote.
 *
 * `Link` and `usePathname` come from `@/i18n/navigation`, never `next/*`: a
 * plain `<Link>` navigates to an unprefixed path and the proxy falls back to
 * the default locale, so one tap would drop an English session into German.
 * That `usePathname` also returns the path without the locale prefix, which is
 * what lets the comparison below match these hrefs directly.
 */
export function TabBar() {
  const t = useTranslations("AppHeader");
  const pathname = usePathname();

  return (
    <div
      /*
       * Below the header's `z-50` and above the page, on the same layer as the
       * chat launcher — which is lifted clear of this bar in `chat-sidebar.tsx`.
       *
       * `env(safe-area-inset-bottom)` is 0 today: without `viewport-fit=cover`
       * iOS already insets the web view above the home indicator, so there is
       * nothing to clear. It is written anyway so the bar stays correct if
       * cover is ever turned on, rather than sitting under the indicator until
       * someone notices.
       */
      className="fixed inset-x-0 bottom-0 z-40 hidden px-3 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] app-shell:block"
    >
      <nav
        aria-label={t("mainNav")}
        className="glass mx-auto flex max-w-md items-stretch gap-1 rounded-[26px] p-1.5"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          // Every tab owns its subtree — `/anomalies/AMOUNT_SPIKE` is still the
          // anomalies tab.
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);

          /*
           * No `aria-label` here, deliberately. The visible word is the
           * accessible name, which is what WCAG 2.5.3 asks for — labelling
           * this "Auffälligkeiten" under a visible "Hinweise" would give voice
           * control a name nobody can see.
           */
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              // `min-h-12` clears the 44px tap target a thumb needs; the
              // footer's links solve the same problem with `min-h-10`.
              className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] px-1 py-1.5 transition-colors ${
                active
                  ? "bg-accent-soft text-accent"
                  : "text-text-muted active:bg-surface-muted"
              }`}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {/* `truncate` is the backstop, not the plan: every label is short
                  enough for a quarter of a 320px screen, and `tabAnomalies`
                  exists so the longest German one stays that way. */}
              <span className="w-full truncate text-center text-[10px] font-semibold tracking-tight">
                {t("shortKey" in tab ? tab.shortKey : tab.key)}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
