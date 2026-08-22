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
       * iOS floats its own tab bar clear of every edge by about the same
       * amount on all three sides, which is what makes it read as an object
       * resting over the page rather than as a strip welded to the bottom of
       * it. `px-5` and a 1.25rem floor are that same 20px on the sides and
       * underneath — the earlier 12px was close enough to the edge that the
       * capsule looked like it was straining against the screen.
       *
       * `env(safe-area-inset-bottom)` is 0 today: without `viewport-fit=cover`
       * iOS already insets the web view above the home indicator, so there is
       * nothing to clear. It is written anyway so the bar stays correct if
       * cover is ever turned on, rather than sitting under the indicator until
       * someone notices.
       */
      className="fixed inset-x-0 bottom-0 z-40 hidden px-5 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] app-shell:block"
    >
      {/*
       * A full capsule, not a rounded rectangle. `rounded-[26px]` left a flat
       * run down each end, which reads as a card with soft corners — against
       * the corner radius of a current iPhone it looked square. iOS's own tab
       * bar is a capsule.
       *
       * `rounded-full` rather than a bigger number: the browser clamps it to
       * half the smaller dimension, so this stays a capsule whatever the bar
       * ends up measuring — and it does not measure what you would guess. The
       * label inherits its line-height rather than setting one, so the row is
       * a couple of pixels taller than `min-h-12` implies.
       *
       * That is also why the cells below use `rounded-full` instead of a
       * matching literal. A pill inside a pill wants concentric radii — inner
       * = outer − padding — or the gap between them pinches at the corners.
       * Each cell is inset from the bar by exactly `p-1.5` on every side, so
       * its height is the bar's less twice that, and half of it is therefore
       * half the bar's less the padding. The two agree by construction, at any
       * height, with neither number written down.
       */}
      <nav
        aria-label={t("mainNav")}
        className="glass mx-auto flex max-w-md items-stretch gap-1 rounded-full p-1.5"
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
              className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1.5 transition-colors ${
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
