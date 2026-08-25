/**
 * How the merchants are cut up for the auto-filing, in one place because both
 * sides of the round trip have to agree on it.
 *
 * The client asks for batch `i` and highlights the rows it believes are in it;
 * the server slices its own list the same way and answers about exactly those.
 * A shared pure function is what keeps the highlight honest — the alternative
 * is the browser sending a list of names, which is the one thing
 * `suggestCategoriesForUnfiled` must never accept.
 *
 * Pure and free of `@/db`, like `lib/insights.ts` and `lib/csv-import.ts`: a
 * client component imports it.
 */

/**
 * Merchants per request.
 *
 * A token question, not a progress-bar one, and that distinction was worth
 * measuring: batches were briefly sized to give the bar about five steps
 * whatever the list, and against the real model that turned nine merchants
 * into twenty-one seconds — a request costs three to ten seconds almost
 * regardless of how many names are in it, and Next runs a client's server
 * actions one at a time, so steps multiply the wait rather than filling it.
 *
 * So the size is the reply budget's, halved for granularity that costs
 * nothing: one answer is a name and a category, ~20 tokens, and ten of them
 * sit far inside the 1200-token cap. A short list is one request and a bar
 * that says "working"; a long one gets real steps because it genuinely has
 * them. A reply that runs over the cap is truncated mid-JSON, which is
 * unparseable, which loses the whole batch — so don't raise this to buy fewer
 * round trips either.
 */
const BATCH = 10;

/** The batch size for a run over `count` merchants. */
export function merchantBatchSize(count: number): number {
  return Math.min(BATCH, Math.max(1, count));
}

/** The same slicing on both sides of the wire. */
export function merchantBatches<T>(items: T[]): T[][] {
  if (items.length === 0) return [];
  const size = merchantBatchSize(items.length);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
