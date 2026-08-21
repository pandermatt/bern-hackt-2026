"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js. Production only — in dev a service worker sits in
 * front of HMR and serves stale modules, which looks like a broken app.
 *
 * Renders nothing; the failure path is silent on purpose, since an
 * unregistered worker only costs offline support.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
