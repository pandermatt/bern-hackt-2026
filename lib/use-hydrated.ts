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
