"use client";

import { useTranslations } from "next-intl";
import {
  Fragment,
  startTransition,
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

/** A chunk and the offset it was fetched at — the offset is its identity. */
type Chunk = { offset: number; content: ReactNode };

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
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [nextOffset, setNextOffset] = useState(initialNextOffset);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // A ref, not the `loading` state: the observer callback closes over whatever
  // it saw when it was registered, and re-registering on every load would tear
  // down the observer mid-scroll.
  const inFlight = useRef(false);
  /*
   * Where the feed is up to, as a ref rather than only as state — and this is
   * load-bearing rather than a micro-optimisation.
   *
   * The lock above is released synchronously in `finally`, but the matching
   * `setNextOffset` is only *scheduled*: React commits it in a later task.
   * IntersectionObserver entries are delivered per frame, so under a fast
   * fling — many entries a second, and a slower round trip than on a desk —
   * a callback can land in that window, find the lock already open, and read
   * the offset the previous load consumed straight out of its closure.
   *
   * `ledgerChunk` is a pure slice of a fixed ordering, so refetching an offset
   * returns the *same fifty rows* again, and `continuesFrom` hides the seam.
   * The reader gets a month they have already scrolled past appended below the
   * one they are reading, which reads as the ledger throwing them back up the
   * list. Advancing this ref before the lock opens is what makes a stale
   * callback pick up the new offset instead of replaying the old one.
   */
  const offset = useRef(initialNextOffset);

  const loadMore = useCallback(async () => {
    const from = offset.current;
    if (inFlight.current || from === null) return;
    inFlight.current = true;
    setFailed(false);

    try {
      const next = await loadLedgerChunk(from, filters);
      // Before the lock opens, so the next caller cannot re-request `from`.
      offset.current = next.nextOffset;
      /*
       * The append is a transition, and this is the whole fix for the ledger
       * throwing the reader back to the top.
       *
       * `next.content` is a server-rendered element that arrived over a Flight
       * stream. Awaiting the action resolves its *result*; the element inside
       * is a lazy reference to a row of that stream which may still be in
       * flight. Rendering it therefore suspends — and as a plain synchronous
       * update that means React hides everything already on screen and shows
       * the nearest fallback above this component, which is the route's own
       * `loading.tsx`. The page collapses from 16 000px to the skeleton's
       * 2 300, the browser clamps the scroll offset to the shorter document,
       * and when the chunk lands you are back at the top of the ledger. The
       * rows never left the DOM; they were `display: none` for a moment.
       *
       * Wrapped in a transition, React renders the new chunk in the background
       * and keeps the current page on screen until it is ready, so the
       * boundary never flips. This is the case React's "a component suspended
       * while responding to synchronous input" warning describes.
       *
       * It reproduces on a phone and not on a desk because it is a race with
       * the network: against a local server the stream is complete before the
       * `await` resolves and nothing ever suspends.
       */
      startTransition(() => {
        setChunks((previous) => [...previous, { offset: from, content: next.content }]);
        setNextOffset(next.nextOffset);
      });
    } catch {
      // Leave the offset where it is so the retry button can try again.
      setFailed(true);
    } finally {
      inFlight.current = false;
    }
  }, [filters]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || nextOffset === null || failed) return;

    // Fires before the sentinel is actually on screen, so a chunk is usually
    // already in place by the time the reader gets to where it goes.
    //
    // Re-created on every `nextOffset` change, and that is the mechanism that
    // keeps the feed going: a fresh observer reports on its first pass, so a
    // sentinel still inside the margin after a short chunk triggers the next
    // load rather than waiting for an intersection change that never comes.
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
      {chunks.map((chunk) => (
        // A `Fragment`, not a wrapping `div`. Every month heading is
        // `position: sticky`, and its containing block is its nearest
        // positioned ancestor — a per-chunk wrapper would make that the chunk,
        // so a heading would come unstuck at every chunk boundary instead of
        // staying put until the next month pushes it off. Fragments emit no
        // element, so all the headings and panels stay siblings in one box.
        //
        // Keyed on the offset the chunk was fetched at, not on its position in
        // the array: the offset is what the chunk actually *is*, so a key can
        // never come to mean a different slice of the ledger than it did.
        <Fragment key={chunk.offset}>{chunk.content}</Fragment>
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
