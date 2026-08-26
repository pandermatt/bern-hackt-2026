import { LogIn, LogOut, User as UserIcon, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { HeaderNav } from "@/components/header-nav";

import { logout } from "@/app/actions/auth";
import { HideOnRoute } from "@/components/hide-on-route";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";
import type { User } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import { displayName } from "@/lib/user";

/**
 * The pill control, in tokens rather than `neutral-*` literals. The redesign
 * this came from predates the dark theme and hardcoded `bg-white` — which is
 * a white header slab on a #121212 page. Each literal maps to the token that
 * renders identically in light mode: `--surface` is #ffffff, `--line` sits
 * where `neutral-200` did.
 */
const CONTROL =
  "cursor-pointer rounded-full border border-line bg-surface px-2.5 py-2 text-[13px] font-semibold text-text transition-all hover:bg-surface-muted hover:border-line-strong shadow-2xs active:scale-95 sm:px-3 sm:py-1.5";

/**
 * Rendered once by the root layout, so every route gets the same chrome.
 * `user` is null for signed-out visitors, who see a sign-in link and CTA.
 *
 * `asleep` is the edge's copy of the landing page, served while the demo
 * server does not exist (`lib/demo-asleep.ts`). It drops those two links and
 * keeps the language selector — the pills lead to `/login` and `/register`,
 * which is precisely what is not there, and the body of the page is where the
 * explanation belongs. The selector stays because it is a plain navigation
 * between two prerendered documents, so it still works with the box gone.
 */
export function AppHeader({
  user,
  asleep = false,
}: {
  user: User | null;
  asleep?: boolean;
}) {
  const t = useTranslations('AppHeader');

  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-surface/90 backdrop-blur-md">
      {/* Below `sm` every gap in this row is one step tighter, because the
          contents genuinely do not fit otherwise: the logo, five icon tabs and
          the two account pills need 382px at the roomy spacing, and a 320px
          phone has 320. It did not fail as a scrollbar — the group below
          carries `min-w-0`, so the nav spilled out of it and the pills painted
          over the last tab, which made Auffälligkeiten unreachable on a small
          screen. The tighter step buys 68px across the row and everything from
          320 up fits. The horizontal *padding* is not part of that: it is
          `px-5` because the pages under it are, and a header whose logo sits
          4px left of the content below it is a worse bug than a tight gap. */}
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-2 px-5 sm:gap-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-5">
          <Logo href={user ? "/home" : "/"} />
          {/* Only signed-in visitors have anything to navigate between. */}
          {user && <HeaderNav />}
        </div>

        {user ? (
          /* Account chrome only. Anomalies used to sit at the head of this
             cluster; it is a page rather than an account control, so it moved
             into `HeaderNav` beside Budget. */
          <div className="flex items-center gap-2 sm:gap-2.5">
            <Link
              href="/account"
              aria-label={t('accountSettings')}
              className={`flex min-h-10 shrink-0 items-center gap-2 sm:min-h-0 ${CONTROL}`}
            >
              <UserIcon className="size-3.5 text-text-subtle" />
              <span className="hidden max-w-[20ch] truncate sm:inline" title={user.email}>
                {displayName(user)}
              </span>
            </Link>
            <form action={logout}>
              <button
                type="submit"
                aria-label={t('signOut')}
                className={`flex min-h-10 items-center gap-1.5 sm:min-h-0 ${CONTROL}`}
              >
                <LogOut className="size-3.5 text-text-subtle" />
                {/* Hidden below `sm` like the account name beside it — an
                    icon with an accessible name, not an unlabelled glyph. */}
                <span className="hidden sm:inline">{t('signOut')}</span>
              </button>
            </form>
          </div>
        ) : (
          /* Each of the two links is dropped on the page it leads to — see
             `HideOnRoute`. On `/login` and `/register` that leaves one link,
             which is the one offering the *other* page. */
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Signed out, this is now the only place to change language: the
                footer used to carry it, and the footer now renders on the
                landing page alone — which would have left a visitor reading
                /login or /register with no way to switch. Signed in it lives
                on /account, so this pair never both appear. */}
            <LanguageSelector />
            {!asleep && (
              <>
                <HideOnRoute route="/login">
                  <Link
                    href="/login"
                    className={`flex min-h-10 items-center gap-1.5 sm:min-h-0 ${CONTROL}`}
                  >
                    <LogIn className="size-3.5 text-text-subtle" />
                    <span>{t('signIn')}</span>
                  </Link>
                </HideOnRoute>
                {/* A maximum-contrast pill rather than a brand-coloured one —
                    the redesign's choice, kept. `bg-text`/`text-bg` is that
                    intent expressed in tokens: near-black on white in light,
                    and it inverts with the theme instead of vanishing into
                    it. */}
                <HideOnRoute route="/register">
                  <Link
                    href="/register"
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-text px-4 py-1.5 text-[13px] font-semibold text-bg shadow-2xs transition-all hover:opacity-85 active:scale-95"
                  >
                    <span>{t('getStarted')}</span>
                    <ArrowRight className="size-3.5" />
                  </Link>
                </HideOnRoute>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
