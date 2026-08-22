"use client";

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
 * which is what lets the comparison below stay a plain equality against the
 * hrefs rather than a prefix-stripping match.
 */
const TABS = [
  { href: "/", key: "dashboard" },
  { href: "/budget", key: "budget" },
] as const;

export function HeaderNav() {
  const t = useTranslations("AppHeader");
  const pathname = usePathname();

  return (
    <nav aria-label={t("mainNav")} className="flex items-center gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              active
                ? "bg-accent-soft text-accent"
                : "text-text-muted hover:bg-surface-muted hover:text-text"
            }`}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
