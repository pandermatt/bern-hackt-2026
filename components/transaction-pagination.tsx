"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Page state lives in the URL, same as every filter in
 * `transaction-filters.tsx` — so a page is shareable and survives a reload.
 *
 * Reads `useSearchParams`, so the caller has to wrap it in a `<Suspense>`
 * boundary; `transaction-filters.tsx` sets the same precedent.
 */
const BUTTON =
  "h-8 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface";

export function TransactionPagination({
  page,
  pageCount,
}: {
  page: number;
  pageCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Nothing to page through — the footer would just be dead chrome.
  if (pageCount <= 1) return null;

  function goTo(target: number) {
    const params = new URLSearchParams(searchParams);
    // Page 1 is the implicit default, so leaving it out of the URL keeps
    // "back to the start" links short and keeps an untouched page out of a
    // shared URL.
    if (target <= 1) params.delete("page");
    else params.set("page", String(target));

    startTransition(() => {
      const query = params.toString();
      router.replace(query ? `/?${query}` : "/", { scroll: false });
    });
  }

  return (
    <nav
      className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 sm:px-5"
      aria-label="Transaction pages"
      data-pending={pending ? "true" : undefined}
    >
      <button
        type="button"
        className={BUTTON}
        onClick={() => goTo(page - 1)}
        disabled={page <= 1}
      >
        Previous
      </button>

      <p className="font-mono text-[12px] tabular-nums text-text-muted">
        Page {page} of {pageCount}
      </p>

      <button
        type="button"
        className={BUTTON}
        onClick={() => goTo(page + 1)}
        disabled={page >= pageCount}
      >
        Next
      </button>
    </nav>
  );
}
