"use client";

import { useSyncExternalStore } from "react";

/**
 * The two browser facts the account page's device rows are decided by: whether
 * the app is running installed, and whether this is Safari on iOS.
 *
 * They live here rather than inside `components/install-app.tsx` because
 * `components/push-notifications.tsx` needs the same pair for a different
 * reason — iOS grants `Notification.requestPermission()` only inside an
 * installed PWA, so "add to home screen first" is the honest note there — and a
 * second copy of the iPad user-agent heuristic is exactly the kind of thing
 * that gets fixed in one place and not the other.
 *
 * Both go through `useSyncExternalStore` with a stable `false` server
 * snapshot, the same shape `lib/use-hydrated.ts` uses and for the same reason.
 * Reading them into state from an effect instead is what
 * `react-hooks/set-state-in-effect` rejects.
 */

const STANDALONE = "(display-mode: standalone)";

let standaloneQuery: MediaQueryList | null = null;

function standaloneList(): MediaQueryList {
  standaloneQuery ??= window.matchMedia(STANDALONE);
  return standaloneQuery;
}

function subscribeStandalone(onChange: () => void) {
  const list = standaloneList();
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** True inside an installed window, on both the standard and the iOS path. */
export function useStandalone(): boolean {
  return useSyncExternalStore(
    subscribeStandalone,
    () =>
      standaloneList().matches ||
      // Safari never implemented the media query for home-screen launches.
      ("standalone" in navigator && navigator.standalone === true),
    () => false,
  );
}

/** Never fires — the user agent does not change under a mounted component. */
const subscribeNothing = () => () => {};

/**
 * iOS Safari, including the iPad's desktop-class user agent — which claims to
 * be a Mac and is only distinguishable by having a touch screen. Chrome and
 * Firefox on iOS are Safari underneath and cannot install at all, but they
 * share the Share-menu shape closely enough for the same instructions.
 */
export function useIosSafari(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => {
      const ua = navigator.userAgent;
      const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
      return (
        (/iPad|iPhone|iPod/.test(ua) || iPadOs) && !/CriOS|FxiOS|EdgiOS/.test(ua)
      );
    },
    () => false,
  );
}

/**
 * The pill button both device rows wear. Shared rather than copied: it is 200
 * characters of Tailwind, and two rows sitting in the same settings group
 * disagreeing about their control's shape is a visible bug.
 */
export const CONTROL =
  "flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold text-text shadow-2xs transition-all hover:border-line-strong hover:bg-surface-muted active:scale-95 sm:min-h-0 sm:py-1.5";
