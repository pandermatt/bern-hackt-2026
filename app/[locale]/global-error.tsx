"use client";

import "../globals.css";

/**
 * Catches failures in the root layout itself — including the `getCurrentUser`
 * call that renders the header. It replaces the layout entirely, so it has to
 * ship its own <html>/<body>, and the next/font variables defined there are
 * gone; this falls back to the system stack by design.
 *
 * It also loses `NextIntlClientProvider`, which the layout it replaced was
 * rendering — so `useTranslations` here would throw inside the very boundary
 * that exists to catch throws. The two languages are inlined instead, and the
 * locale is read off the URL, which is the only signal left standing.
 */
const COPY = {
  de: {
    title: "Die App konnte nicht starten",
    body: "Etwas ist kaputtgegangen, bevor die Seite gerendert werden konnte. Neu laden hilft meistens.",
    reload: "Neu laden",
  },
  en: {
    title: "The app failed to start",
    body: "Something broke before the page could render. Reloading usually fixes it.",
    reload: "Reload",
  },
} as const;

type GlobalErrorLocale = keyof typeof COPY;

function localeFromPath(): GlobalErrorLocale {
  if (typeof window === "undefined") return "de";
  const segment = window.location.pathname.split("/")[1];
  return segment in COPY ? (segment as GlobalErrorLocale) : "de";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = localeFromPath();
  const copy = COPY[locale];

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full items-center justify-center bg-bg px-5 py-16">
        <div className="card w-full max-w-md p-6">
          <h1 className="text-[18px] font-semibold tracking-tight text-text">
            {copy.title}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
            {copy.body}
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
            {copy.reload}
          </button>
        </div>
      </body>
    </html>
  );
}
