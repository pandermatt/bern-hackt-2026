"use client";

import "./globals.css";

/**
 * Catches failures in the root layout itself — including the `getCurrentUser`
 * call that renders the header. It replaces the layout entirely, so it has to
 * ship its own <html>/<body>, and the next/font variables defined there are
 * gone; this falls back to the system stack by design.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full items-center justify-center bg-bg px-5 py-16">
        <div className="card w-full max-w-md p-6">
          <h1 className="text-[18px] font-semibold tracking-tight text-text">
            The app failed to load
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
            Something broke before the page could render. Reloading is the first
            thing to try.
          </p>

          {error.digest && (
            <p className="mt-4 font-mono text-[12px] text-text-subtle">
              {error.digest}
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex h-10 cursor-pointer items-center rounded-md bg-accent px-4 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
