"use server";

import { DayRows } from "@/components/ledger-chunk";

import { getDayRows } from "./transactions";

/**
 * One day's transactions, as rendered output rather than as data.
 *
 * The calendar's cells are aggregates — a count, two sums, a handful of palette
 * slots — and those may cross to the client, exactly as the charts' figures do.
 * The rows behind them may not. So the expanded day follows the same shape
 * `app/actions/ledger.tsx` gives the infinite scroll: the client asks for a
 * date, and what comes back is a server-rendered element it can only append.
 * No transaction ever becomes client state on either path.
 *
 * `content` is `null` for a signed-out caller, a malformed date, or a day the
 * current filter leaves empty — all three are the same thing to the caller,
 * which is a cell that has nothing to open.
 */
export async function loadDayRows(
  date: string,
  filters: unknown,
): Promise<{ content: React.ReactNode }> {
  const day = await getDayRows(date, filters);
  if (!day) return { content: null };

  return {
    content: (
      <DayRows
        rows={day.rows}
        anomalies={day.anomalies}
        /* `--surface`, not the ledger's `--surface-muted`: this panel sits
           inside the calendar's grey grid, and a panel filled with its own
           ground is no panel at all. Same reason the day cells above it are
           white tiles — and why the dividers move to `--line`, the ledger's
           white ones having nothing to show against here. */
        className="divide-line rounded-lg bg-surface"
      />
    ),
  };
}
