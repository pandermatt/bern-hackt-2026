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

const SELECT =
  "h-8 cursor-pointer rounded-md border border-line-strong bg-surface px-2 text-[12px] font-medium tabular-nums text-text transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The id `components/transaction-list.tsx` puts on the ledger card. */
export const LEDGER_ANCHOR_ID = "transactions";

/**
 * Returns to the top of the ledger after a page change.
 *
 * Navigation itself stays `scroll: false` — the filters share this route, and
 * changing a filter should not yank the viewport around. Paging is the one case
 * where the reader genuinely wants to be moved: without this you land on row 51
 * still scrolled to where row 100 used to be.
 *
 * The card is already mounted, so this can run before the new rows arrive
 * rather than waiting on the transition — the scroll and the swap overlap
 * instead of queueing.
 */
function scrollToLedger() {
  const ledger = document.getElementById(LEDGER_ANCHOR_ID);
  if (!ledger) return;

  // Honour the same preference the stylesheet does; a forced smooth scroll is
  // a common motion-sickness trigger.
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  ledger.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

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
    const clamped = Math.min(Math.max(target, 1), pageCount);
    if (clamped === page) return;

    const params = new URLSearchParams(searchParams);
    // Page 1 is the implicit default, so leaving it out of the URL keeps
    // "back to the start" links short and keeps an untouched page out of a
    // shared URL.
    if (clamped <= 1) params.delete("page");
    else params.set("page", String(clamped));

    scrollToLedger();
    startTransition(() => {
      const query = params.toString();
      router.replace(query ? `/?${query}` : "/", { scroll: false });
    });
  }

  return (
    <nav
      className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5"
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

      <div className="flex items-center gap-2">
        <label
          htmlFor="page-jump"
          className="font-mono text-[12px] text-text-muted"
        >
          Page
        </label>
        {/* A native select rather than a custom menu: it is keyboard- and
            screen-reader-correct for free, and on mobile it opens the
            platform's own scrollable picker, which beats anything hand-rolled
            for an account with hundreds of pages. */}
        <select
          id="page-jump"
          className={SELECT}
          value={page}
          onChange={(event) => goTo(Number(event.target.value))}
          aria-label={`Go to page, currently page ${page} of ${pageCount}`}
        >
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="font-mono text-[12px] tabular-nums text-text-muted">
          of {pageCount.toLocaleString("de-CH")}
        </span>
      </div>

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
