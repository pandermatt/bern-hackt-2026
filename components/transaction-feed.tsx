"use client";

import { useTranslations } from "next-intl";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { loadLedgerChunk } from "@/app/actions/ledger";

/**
 * The ledger's infinite scroll.
 *
 * Holds a list of **rendered chunks**, not rows. `loadLedgerChunk` returns a
 * server-rendered element, so the only thing this component knows about anyone's
 * finances is that it has some React nodes to append — which is what lets the
 * ledger keep the dashboard's rule that transactions never become client state.
 *
 * The first chunk arrives as `initial` from the server render, so the ledger is
 * complete and readable before any of this hydrates, and with JavaScript off it
 * simply stops after that chunk rather than showing nothing.
 *
 * The caller must give this a `key` derived from the filters. Changing a filter
 * re-renders the server component with a different `initial`, and without a new
 * key React would keep the chunks accumulated under the *old* filter and append
 * the new ones to them.
 */
export function TransactionFeed({
  initial,
  initialNextOffset,
  filters,
}: {
  initial: ReactNode;
  /** Where the next chunk starts, or `null` when the first one was the lot. */
  initialNextOffset: number | null;
  /** The raw search params, forwarded to the action verbatim. */
  filters: Record<string, string | string[] | undefined>;
}) {
  const t = useTranslations("Ledger");
  const [chunks, setChunks] = useState<ReactNode[]>([]);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // A ref, not the `loading` state: the observer callback closes over whatever
  // it saw when it was registered, and re-registering on every load would tear
  // down the observer mid-scroll.
  const inFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (inFlight.current || nextOffset === null) return;
    inFlight.current = true;
    setFailed(false);

    try {
      const next = await loadLedgerChunk(nextOffset, filters);
      setChunks((previous) => [...previous, next.content]);
      setNextOffset(next.nextOffset);
    } catch {
      // Leave `nextOffset` where it is so the retry button can try again.
      setFailed(true);
    } finally {
      inFlight.current = false;
    }
  }, [nextOffset, filters]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || nextOffset === null || failed) return;

    // Fires before the sentinel is actually on screen, so a chunk is usually
    // already in place by the time the reader gets to where it goes.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "800px 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [loadMore, nextOffset, failed]);

  const done = nextOffset === null;

  return (
    <>
      {initial}
      {chunks.map((chunk, index) => (
        // A `Fragment`, not a wrapping `div`. Every month heading is
        // `position: sticky`, and its containing block is its nearest
        // positioned ancestor — a per-chunk wrapper would make that the chunk,
        // so a heading would come unstuck at every chunk boundary instead of
        // staying put until the next month pushes it off. Fragments emit no
        // element, so all the headings and panels stay siblings in one box.
        //
        // Chunks only ever append, and each is a fixed slice of a fixed
        // ordering, so the index is a stable identity.
        <Fragment key={index}>{chunk}</Fragment>
      ))}

      {/* Reserves a little space so the observer has something to see even when
          the last chunk ends exactly at the fold. */}
      <div ref={sentinel} aria-hidden className="h-px" />

      <div
        className="flex min-h-10 items-center justify-center pt-4"
        aria-live="polite"
      >
        {failed ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="inline-flex h-10 cursor-pointer items-center rounded-md border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-muted"
          >
            {t("retry")}
          </button>
        ) : done ? null : (
          <p className="font-mono text-[12px] text-text-subtle">{t("loadingMore")}</p>
        )}
      </div>
    </>
  );
}
