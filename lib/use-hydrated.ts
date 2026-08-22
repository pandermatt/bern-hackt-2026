"use client";

import { useSyncExternalStore } from "react";

/** Never fires — the value it reports flips exactly once, at hydration. */
const subscribe = () => () => {};

/**
 * `false` while server-rendering and during the hydration pass, `true`
 * afterwards.
 *
 * The obvious version of this is `useState(false)` plus an effect that sets it
 * to `true`, which `react-hooks/set-state-in-effect` rejects — and fairly: it
 * is a render, a commit, and then a second render. `useSyncExternalStore` says
 * the same thing in one pass by giving the server and the client different
 * snapshots. Both snapshots are stable primitives, which is what keeps it from
 * looping.
 *
 * Needed wherever the correct output is only knowable in the browser — reading
 * a CSS custom property, or drawing the icon for the resolved theme. Rendering
 * a guess instead would either flash the wrong thing or trip a hydration
 * mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * The `sm` breakpoint, as a boolean: `true` below 640px, `false` at or above it.
 *
 * The same `useSyncExternalStore` shape as `useHydrated`, for the same reason —
 * a viewport width is only knowable in the browser, and the server snapshot has
 * to be a stable `false`. Unlike `useHydrated` this one has a real
 * subscription, so a rotation or a resize re-renders rather than leaving a
 * chart drawn for the wrong width.
 *
 * `639.98px` rather than `639px`: viewport widths are fractional on plenty of
 * devices, and a plain integer leaves a sliver where neither this nor Tailwind's
 * `sm:` applies.
 *
 * This exists because a media query is the only way to tell the ECharts canvases
 * apart from CSS's point of view — a canvas takes no classes, so the responsive
 * decisions inside `buildOption` have to be made in JavaScript.
 */
const NARROW = "(max-width: 639.98px)";

let narrowQuery: MediaQueryList | null = null;

function narrowList(): MediaQueryList {
  narrowQuery ??= window.matchMedia(NARROW);
  return narrowQuery;
}

function subscribeNarrow(onChange: () => void) {
  const list = narrowList();
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => narrowList().matches,
    () => false,
  );
}
