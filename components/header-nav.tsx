"use client";

import { ChartColumn, House, TriangleAlert, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";

/**
 * The app's top-level tabs.
 *
 * Client-side only because it reads `usePathname` to mark the current one —
 * `aria-current` has to be right on the server too, but the layout is shared
 * across every route and cannot know which is active without it. No data
 * crosses the boundary, just the path.
 *
 * Both come from `@/i18n/navigation`, not from `next/*`: a plain `<Link>` here
 * navigates to an unprefixed path and the proxy falls back to the default
 * locale, so one click on "Budget" would drop an English session back into
 * German. Its `usePathname` also returns the path *without* the locale prefix,
 * which is what lets the comparison below stay a match against these hrefs
 * rather than a prefix-stripping one.
 */
/* Anomalies used to be a pill over in the right-hand cluster, beside the
   account and sign-out controls. It is a top-level page like the others, so it
   belongs in this group rather than among the account chrome — and being a tab
   is what lets it show as the current page.

   **Every tab now carries an icon, and every label hides below `sm`.** That
   used to be Anomalies' private arrangement, because "Auffälligkeiten" is 14
   characters and three text tabs plus the account cluster already overflowed a
   375px phone. Adding Home as a fourth made it everyone's problem: four labels
   do not fit at any phone width. Icons below `sm`, words from `sm` up. */
const TABS = [
  { href: "/home", key: "home", icon: House },
  { href: "/dashboard", key: "dashboard", icon: ChartColumn },
  { href: "/budget", key: "budget", icon: Wallet },
  { href: "/anomalies", key: "anomalies", icon: TriangleAlert },
] as const;

export function HeaderNav() {
  const t = useTranslations("AppHeader");
  const pathname = usePathname();

  return (
    <nav aria-label={t("mainNav")} className="flex items-center gap-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        /* Every tab owns its subtree — `/anomalies/AMOUNT_SPIKE` is still the
           anomalies tab. This used to need a special case for the dashboard,
           which lived at `/` and so prefixed every route; at `/dashboard` it is
           an ordinary tab like the rest. */
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            /* The visible label is the accessible name from `sm` up; below
               that it is hidden, and this is all a screen reader would have. */
            aria-label={t(tab.key)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition-colors sm:px-3 ${
              active
                ? "bg-accent-soft text-accent"
                : "text-text-muted hover:bg-surface-muted hover:text-text"
            }`}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="hidden sm:inline">{t(tab.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
