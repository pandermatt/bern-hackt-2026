import { EmptyState } from "@/components/empty-state";
import { LedgerChunk } from "@/components/ledger-chunk";
import { TransactionFeed } from "@/components/transaction-feed";
import type { Transaction } from "@/db/schema";
import type { AnomalyInsight } from "@/lib/anomaly-engine";
import type { MonthTotal } from "@/lib/insights";

/** The id the ledger carries, so a filter change can scroll back to it. */
export const LEDGER_ANCHOR_ID = "transactions";

/**
 * The ledger.
 *
 * No card and no heading of its own: each month is a rounded panel under its
 * own large heading, and those headings are the structure. A "Transactions"
 * bar above them was only repeating what the rows already say.
 *
 * The first chunk is server-rendered here; `TransactionFeed` appends the rest
 * as the reader scrolls, and each of those is also server-rendered — see
 * `app/actions/ledger.tsx`. So this component stays server-side in the sense
 * that matters: no transaction ever becomes client state.
 */
export function TransactionList({
  rows,
  anomalies = [],
  monthTotals,
  nextOffset,
  continuesInto,
  totalCount,
  filters,
}: {
  /** The first chunk — whole months, at least `PAGE_SIZE` rows. */
  rows: Transaction[];
  anomalies?: AnomalyInsight[];
  /** Money in and out per `YYYY-MM` across the whole filtered set, keyed the
   * same way the rows group. Covers every month, not just the first chunk. */
  monthTotals: Record<string, MonthTotal>;
  /** Where the second chunk starts, or `null` when the first one was the lot. */
  nextOffset: number | null;
  /** The first chunk stops mid-month, so its last panel must not round off. */
  continuesInto: boolean;
  /** Rows across the whole current filter, for the count at the foot. */
  totalCount: number;
  /** The raw search params, forwarded to the load-more action. */
  filters: Record<string, string | string[] | undefined>;
}) {
  return (
    <section
      id={LEDGER_ANCHOR_ID}
      // `scroll-mt-20` clears the sticky h-16 header, so a filter change does
      // not scroll the first month heading underneath it.
      className="scroll-mt-20"
      // No visible heading any more, so the landmark needs its name here.
      aria-label="Transactions"
    >
      {rows.length === 0 ? (
        <div className="mt-6 overflow-clip rounded-lg bg-surface-muted">
          <EmptyState />
        </div>
      ) : (
        <TransactionFeed
          // Without a key derived from the filters, React would keep the
          // chunks accumulated under the previous filter and append to them.
          key={JSON.stringify(filters)}
          initial={
            <LedgerChunk
              rows={rows}
              anomalies={anomalies}
              monthTotals={monthTotals}
              continuesInto={continuesInto}
            />
          }
          initialNextOffset={nextOffset}
          filters={filters}
        />
      )}

      {/* What the removed header bar carried: how many rows the current filter
          matched. It describes the set rather than any one row, and with an
          infinite scroll the foot is where you find out you have reached the
          end of it. */}
      <p className="pt-3 text-right font-mono text-[12px] tabular-nums text-text-muted">
        {totalCount.toLocaleString("de-CH")}{" "}
        {totalCount === 1 ? "line" : "lines"}
      </p>
    </section>
  );
}
