"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, everywhere.
 *
 * This used to be production-only, because a worker sitting in front of HMR
 * serves stale modules and looks like a broken app. Push notifications changed
 * the trade: without a worker there is no `PushManager` at all, so the entire
 * notifications flow would have been unexercisable in `npm run dev`.
 *
 * The fix is the query string rather than the guard. `?dev=1` becomes part of
 * the worker's own URL — the only channel a plain script served from `public/`
 * has for a build-time fact — and the worker reads it into `DEV` to stand down
 * the one thing that caused the problem: cache-first on `/_next/static/`, whose
 * chunks are content-hashed in a build and emphatically not in dev.
 *
 * Renders nothing; the failure path is silent on purpose, since an
 * unregistered worker only costs offline support and notifications.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // A different URL is a different worker, so the two never fight over the
    // same registration when switching between dev and a production build.
    const script =
      process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";

    navigator.serviceWorker.register(script).catch(() => {});
  }, []);

  return null;
}
