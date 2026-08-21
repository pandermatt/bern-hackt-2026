import Link from "next/link";
import { LogIn, LogOut, User as UserIcon, ArrowRight } from "lucide-react";

import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import type { User } from "@/db/schema";

/**
 * The pill control, in tokens rather than `neutral-*` literals. The redesign
 * this came from predates the dark theme and hardcoded `bg-white` — which is
 * a white header slab on a #121212 page. Each literal maps to the token that
 * renders identically in light mode: `--surface` is #ffffff, `--line` sits
 * where `neutral-200` did.
 */
const CONTROL =
  "cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-text transition-all hover:bg-surface-muted hover:border-line-strong shadow-2xs active:scale-95";

/**
 * Rendered once by the root layout, so every route gets the same chrome.
 * `user` is null for signed-out visitors, who see a sign-in link and CTA.
 */
export function AppHeader({ user }: { user: User | null }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
        <Logo />

        {user ? (
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <Link
              href="/account"
              aria-label="Account settings"
              className={`flex shrink-0 items-center gap-2 ${CONTROL}`}
            >
              <UserIcon className="size-3.5 text-text-subtle" />
              <span className="hidden max-w-[20ch] truncate sm:inline" title={user.email}>
                {user.email}
              </span>
            </Link>
            <form action={logout}>
              <button type="submit" className={`flex items-center gap-1.5 ${CONTROL}`}>
                <LogOut className="size-3.5 text-text-subtle" />
                <span>Sign out</span>
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/login" className={`flex items-center gap-1.5 ${CONTROL}`}>
              <LogIn className="size-3.5 text-text-subtle" />
              <span>Sign in</span>
            </Link>
            {/* A maximum-contrast pill rather than a brand-coloured one — the
                redesign's choice, kept. `bg-text`/`text-bg` is that intent
                expressed in tokens: near-black on white in light, and it
                inverts with the theme instead of vanishing into it. */}
            <Link
              href="/register"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-text px-4 py-1.5 text-[13px] font-semibold text-bg shadow-2xs transition-all hover:opacity-85 active:scale-95"
            >
              <span>Get started</span>
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
