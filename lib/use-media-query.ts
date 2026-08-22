"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as React state, without an effect.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the match is
 * external state that already has a subscription API, and reading it in an
 * effect means one render at the wrong size before the right one — which for a
 * chart is a visible reflow, not just a wasted pass.
 *
 * The server snapshot is `false`. Every caller is a chart that renders nothing
 * until `useChartTokens` has read the cascade, so there is no server markup for
 * a wrong guess to disagree with.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
