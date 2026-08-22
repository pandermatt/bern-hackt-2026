"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * The floor under any uncaught render or server-action error. Static markup on
 * purpose: no entrance animation, so it is visible at first paint even if
 * hydration never completes — an error page that fades in is an error page you
 * may never see.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Errors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-5 py-16">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-[18px] font-semibold tracking-tight text-text">
          {t("title")}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-muted">
          {t("body")}
        </p>

        {error.digest && (
          <p
            className="mt-4 font-mono text-[12px] text-text-subtle"
            title={t("digestTitle")}
          >
            {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 cursor-pointer items-center rounded-md bg-accent px-4 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            {t("tryAgain")}
          </button>
          {/* /home, not "/": an error can be thrown from any route, and the
              way out of one is the signed-in entry page. "/" is the marketing
              landing. */}
          <Link
            href="/home"
            className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-[14px] font-medium text-text transition-colors hover:bg-surface-muted"
          >
            {t("backHome")}
          </Link>
        </div>
      </div>
    </main>
  );
}
