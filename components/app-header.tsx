import { LogIn, LogOut, TriangleAlert, User as UserIcon, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { HeaderNav } from "@/components/header-nav";

import { logout } from "@/app/actions/auth";
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
  "cursor-pointer rounded-full border border-line bg-surface px-3 py-2 text-[13px] font-semibold text-text transition-all hover:bg-surface-muted hover:border-line-strong shadow-2xs active:scale-95 sm:py-1.5";

/**
 * Rendered once by the root layout, so every route gets the same chrome.
 * `user` is null for signed-out visitors, who see a sign-in link and CTA.
 */
export function AppHeader({ user }: { user: User | null }) {
  const t = useTranslations('AppHeader');

  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-5">
          <Logo />
          {/* Only signed-in visitors have anything to navigate between. */}
          {user && <HeaderNav />}
        </div>

        {user ? (
          <div className="flex items-center gap-2.5">
            {/* Label hidden below `sm` like the account pill's: at 375px this
                row is already logo, account and sign-out. */}
            <Link
              href="/anomalies"
              aria-label={t('anomalies')}
              className={`flex min-h-10 shrink-0 items-center gap-2 sm:min-h-0 ${CONTROL}`}
            >
              <TriangleAlert className="size-3.5 text-text-subtle" />
              <span className="hidden sm:inline">{t('anomalies')}</span>
            </Link>
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
                className={`flex min-h-10 items-center gap-1.5 sm:min-h-0 ${CONTROL}`}
              >
                <LogOut className="size-3.5 text-text-subtle" />
                <span>{t('signOut')}</span>
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className={`flex min-h-10 items-center gap-1.5 sm:min-h-0 ${CONTROL}`}
            >
              <LogIn className="size-3.5 text-text-subtle" />
              <span>{t('signIn')}</span>
            </Link>
            {/* A maximum-contrast pill rather than a brand-coloured one — the
                redesign's choice, kept. `bg-text`/`text-bg` is that intent
                expressed in tokens: near-black on white in light, and it
                inverts with the theme instead of vanishing into it. */}
            <Link
              href="/register"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-text px-4 py-1.5 text-[13px] font-semibold text-bg shadow-2xs transition-all hover:opacity-85 active:scale-95"
            >
              <span>{t('getStarted')}</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
