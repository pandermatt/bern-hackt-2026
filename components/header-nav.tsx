"use client";

import { useTranslations } from "next-intl";

import { TABS } from "@/components/nav-tabs";
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

   **Every tab now carries an icon, and every label hides below `lg`.** That
   used to be Anomalies' private arrangement, because "Auffälligkeiten" is 14
   characters and three text tabs plus the account cluster already overflowed a
   375px phone. Adding Home as a fourth made it everyone's problem: four labels
   do not fit at any phone width. Icons below the breakpoint, words above it.

   **The breakpoint is `lg`, not `sm`, because five labels are 527px wide.**
   Measured in German, which is the binding case: with the account cluster on
   the other side, the row does not fit until the viewport is ~984px. At `sm`
   it did not fail visibly as a scrollbar — the group around the logo carries
   `min-w-0`, so the nav spilled out of it and painted *underneath* the account
   pills, which is how "Sparziele" and "Auffälligkeiten" ended up printed over
   "Jeanine" and "Abmelden" at every width from 640 to 1024. At `lg` the gap
   between the two is 53px in German and 94px in English, and it cannot shrink
   again above that: the header's container stops growing at `max-w-5xl`.
   Re-measure if a sixth tab or a longer label lands here.

   The list itself now lives in `components/nav-tabs.ts`, shared with
   `components/tab-bar.tsx` — the installed app moves these same four routes
   into a bottom bar, and two copies of the list would drift. */

export function HeaderNav() {
  const t = useTranslations("AppHeader");
  const pathname = usePathname();

  return (
    // Hidden in the installed app on a phone: the same four routes are in the
    // bottom bar there, and offering both would be two navs for one set of
    // pages. `display: none` also takes it out of the accessibility tree, so
    // nothing announces them twice.
    <nav
      aria-label={t("mainNav")}
      className="flex items-center gap-0.5 app-shell:hidden sm:gap-1"
    >
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
            /* The visible label is the accessible name from `lg` up; below
               that it is hidden, and this is all a screen reader would have. */
            aria-label={t(tab.key)}
            /* `px-1.5` below `sm` — see the header's own comment: five icon
               tabs at the roomy padding are 186px, which is more than a 320px
               phone has left after the logo and the account pills, and the
               overflow was silent. 26px is a tight target, but a hidden tab is
               no target at all. */
            className={`flex items-center gap-1.5 rounded-full px-1.5 py-1.5 text-[13px] font-semibold transition-colors sm:px-2.5 lg:px-3 ${
              active
                ? "bg-accent-soft text-accent"
                : "text-text-muted hover:bg-surface-muted hover:text-text"
            }`}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="hidden lg:inline">{t(tab.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
