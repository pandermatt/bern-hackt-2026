import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { TransactionPagination } from "@/components/transaction-pagination";
import type { Transaction } from "@/db/schema";
import { formatDay, formatMoney } from "@/lib/insights";

/**
 * A server component all the way down. Nothing here is interactive, so none of
 * these rows need to reach the browser as JavaScript — which also means no copy
 * of anyone's finances ends up in a client bundle.
 */
function TransactionRow({ row }: { row: Transaction }) {
  const inflow = row.amountMinor > 0;
  const foreign = row.currency !== "CHF";

  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface-hover sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-text">
          {row.merchant}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-text-muted">
          {row.description}
        </p>
      </div>

      <div className="hidden shrink-0 sm:block">
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11.5px] font-medium text-text-muted">
          {row.category}
        </span>
      </div>

      <div className="w-[10ch] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-text-subtle">
        {formatDay(row.bookedOn)}
      </div>

      <div className="w-[13ch] shrink-0 text-right">
        <p
          className={`font-mono text-[13.5px] tabular-nums ${
            inflow ? "text-positive" : "text-text"
          }`}
        >
          {inflow ? "+" : "−"}
          {formatMoney(row.amountMinor)}
        </p>
        {foreign && (
          <p className="font-mono text-[11px] text-text-subtle">
            {formatMoney(row.originalAmountMinor, row.currency)}
          </p>
        )}
      </div>
    </li>
  );
}

export function TransactionList({
  rows,
  page,
  pageCount,
  totalCount,
}: {
  /** Just the current page — at most `PAGE_SIZE` rows. */
  rows: Transaction[];
  page: number;
  pageCount: number;
  /** Rows across every page of the current filter, for the header count. */
  totalCount: number;
}) {
  return (
    <section className="card overflow-hidden" aria-labelledby="ledger-heading">
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="ledger-heading" className="text-[15px] font-semibold text-text">
          Transactions
        </h2>
        <p className="font-mono text-[12px] tabular-nums text-text-muted">
          {totalCount.toLocaleString("de-CH")}{" "}
          {totalCount === 1 ? "line" : "lines"}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul>
          {rows.map((row) => (
            <TransactionRow key={row.id} row={row} />
          ))}
        </ul>
      )}

      {/* TransactionPagination reads useSearchParams, which needs a boundary
          it can suspend against. */}
      <Suspense fallback={null}>
        <TransactionPagination page={page} pageCount={pageCount} />
      </Suspense>
    </section>
  );
}
