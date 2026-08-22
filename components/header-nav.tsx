"use client";

import { TriangleAlert } from "lucide-react";
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
const TABS = [
  { href: "/", key: "dashboard", icon: null },
  { href: "/budget", key: "budget", icon: null },
  /* Anomalies used to be a pill over in the right-hand cluster, beside the
     account and sign-out controls. It is a top-level page like the other two,
     so it belongs in the same group as Budget rather than among the account
     chrome — and being a tab is what lets it show as the current page.

     It keeps the icon the pill wore, and the pill's habit of hiding its label
     below `sm`: "Auffälligkeiten" is 14 characters, and three text tabs plus
     the account cluster do not fit on a 375px phone. The other two have no
     icon because their labels never leave. */
  { href: "/anomalies", key: "anomalies", icon: TriangleAlert },
] as const;

export function HeaderNav() {
  const t = useTranslations("AppHeader");
  const pathname = usePathname();

  return (
    <nav aria-label={t("mainNav")} className="flex items-center gap-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        /* `/` has to match exactly or it prefixes every route; the others own
           their subtrees — `/anomalies/AMOUNT_SPIKE` is still the anomalies
           tab. */
        const active =
          tab.href === "/"
            ? pathname === "/"
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            /* The label is the accessible name at `sm` and up; below that it
               is hidden and this is all a screen reader would have. */
            aria-label={Icon ? t(tab.key) : undefined}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              active
                ? "bg-accent-soft text-accent"
                : "text-text-muted hover:bg-surface-muted hover:text-text"
            }`}
          >
            {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
            <span className={Icon ? "hidden sm:inline" : undefined}>
              {t(tab.key)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
