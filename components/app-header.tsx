import Link from "next/link";
import { LogIn, LogOut, User as UserIcon, ArrowRight } from "lucide-react";

import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import type { User } from "@/db/schema";

const CONTROL =
  "cursor-pointer rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-neutral-800 transition-all hover:bg-neutral-50 hover:border-neutral-300 shadow-2xs active:scale-95";

/**
 * Rendered once by the root layout, so every route gets the same chrome.
 * `user` is null for signed-out visitors, who see a sign-in link and CTA.
 */
export function AppHeader({ user }: { user: User | null }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-neutral-100 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
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
        {user ? (
          <div className="flex items-center gap-2.5">
            <Link
              href="/account"
              aria-label="Account settings"
              className={`flex shrink-0 items-center gap-2 ${CONTROL}`}
            >
              <UserIcon className="size-3.5 text-neutral-500" />
              <span className="hidden max-w-[20ch] truncate sm:inline" title={user.email}>
                {user.email}
              </span>
            </Link>
            <form action={logout}>
              <button type="submit" className={`flex items-center gap-1.5 ${CONTROL}`}>
                <LogOut className="size-3.5 text-neutral-400" />
                <span>Sign out</span>
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Link href="/login" className={`flex items-center gap-1.5 ${CONTROL}`}>
              <LogIn className="size-3.5 text-neutral-500" />
              <span>Sign in</span>
            </Link>
            <Link
              href="/register"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-neutral-950 px-4 py-1.5 text-[13px] font-semibold text-white shadow-2xs transition-all hover:bg-neutral-800 active:scale-95"
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
