import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Locale-aware replacements for `next/link` and `next/navigation`.
 *
 * This is the fix for "the translation stops working after clicking a button":
 * a plain `<Link href="/account">` navigates to an unprefixed path, the proxy
 * has to guess a locale for it, and the guess is the default one — so one click
 * silently threw away an English session. These prepend the active locale, so a
 * page cannot navigate out of its own language.
 *
 * Always import `Link`, `redirect`, `useRouter` and `usePathname` from here for
 * internal navigation. `next/link` stays correct only for external URLs.
 *
 * One wrinkle worth knowing: these are destructured out of a call, so their
 * types are *inferred*, and TypeScript only applies never-returning
 * control-flow analysis to a callee with an explicit annotation. `redirect`
 * therefore does not mark the code after it unreachable — write
 * `return redirect(…)` rather than a bare call, or the narrowing that follows
 * an early return is lost.
 */
export const { Link, redirect, permanentRedirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
