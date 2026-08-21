import Link from "next/link";

import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import type { User } from "@/db/schema";

const CONTROL =
  "cursor-pointer rounded-md border border-line-strong px-2.5 py-1.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-muted";

/**
 * Rendered once by the root layout, so every route gets the same chrome.
 * `user` is null for signed-out visitors, who see a sign-in link instead of
 * the account controls.
 */
export function AppHeader({ user }: { user: User | null }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5">
        <Logo />

        <div className="flex items-center gap-3">
          <ThemeToggle />

          {user ? (
            <>
              <Link
                href="/account"
                aria-label="Account settings"
                className={`flex shrink-0 items-center gap-1.5 ${CONTROL}`}
              >
                <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" aria-hidden>
                  <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
                  <path
                    d="M2.75 13c.8-2.6 2.9-4 5.25-4s4.45 1.4 5.25 4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="hidden max-w-[22ch] truncate sm:inline" title={user.email}>
                  {user.email}
                </span>
              </Link>
              <form action={logout}>
                <button type="submit" className={CONTROL}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className={CONTROL}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
