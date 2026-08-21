/**
 * Pure aggregation over a user's transactions. No database, no `server-only`:
 * `app/actions/transactions.ts` fetches the rows once and hands them here, and
 * client components import `formatMoney` from the same module.
 *
 * The schema import is **type-only** on purpose. A value import would pull
 * drizzle into the client bundle the moment a `"use client"` file reaches for
 * `formatMoney`, and only `npm run build` would catch it.
 */
import type { Transaction } from "@/db/schema";

export type Filters = {
  from?: string;
  to?: string;
  account?: string;
  category?: string;
  merchant?: string;
  kind?: "expense" | "income";
  q?: string;
  includeTransfers: boolean;
};

export type Totals = {
  income: number;
  salary: number;
  refunds: number;
  /** A positive magnitude — the UI renders the sign. */
  expense: number;
  /** How many of the rows in view are outgoing — not the same as `count`. */
  expenseCount: number;
  net: number;
  /** Every row in view, in both directions. */
  count: number;
};

export type MonthPoint = {
  month: string;
  label: string;
  income: number;
  expense: number;
  net: number;
};

export type Slice = {
  key: string;
  amount: number;
  count: number;
  share: number;
};

export type Facets = {
  accounts: string[];
  categories: string[];
  merchants: string[];
  first: string;
  last: string;
};

/**
 * Hardcoded rather than `Intl.DateTimeFormat("en-GB", { month: "short" })`,
 * which renders September as "Sept" — four characters where every other month
 * has three, which breaks the column rhythm of a twelve-bar chart.
 */
export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * `signDisplay: "never"` on purpose. de-CH renders a negative as
 * "CHF-92’969.40" — no space, the minus welded to the code — and `Math.round`
 * can hand back `-0`, which formats as "CHF-0.00". The sign is a UI decision
 * anyway: callers render a "−" glyph and a colour, not a hyphen buried in the
 * number. Formatters are cached because constructing one is the expensive part
 * of rendering a 500-row list.
 */
export function formatMoney(minor: number, currency = "CHF"): string {
  let formatter = FORMATTERS.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("de-CH", {
      style: "currency",
      currency,
      signDisplay: "never",
    });
    FORMATTERS.set(currency, formatter);
  }
  return formatter.format(minor / 100);
}

/** "2025-03-14" → "14 Mar 2025". No `Date`, so no timezone can shift the day. */
export function formatDay(bookedOn: string): string {
  const [year, month, day] = bookedOn.split("-");
  return `${Number(day)} ${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

/** "2025-12" → "2026-01". String arithmetic, for the same reason. */
function nextMonth(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return index === 12
    ? `${year + 1}-01`
    : `${year}-${String(index + 1).padStart(2, "0")}`;
}

export function applyFilters(
  rows: Transaction[],
  filters: Filters,
): Transaction[] {
  const needle = filters.q?.toLowerCase();

  return rows.filter((row) => {
    // Transfers move money between the owner's own accounts. Counting them as
    // spending would double every credit-card purchase, so they are out unless
    // asked for explicitly.
    if (!filters.includeTransfers && row.kind === "transfer") return false;
    if (filters.kind && row.kind !== filters.kind) return false;
    // Dates are `YYYY-MM-DD`, so a lexical compare is a chronological one.
    // Both ends are inclusive.
    if (filters.from && row.bookedOn < filters.from) return false;
    if (filters.to && row.bookedOn > filters.to) return false;
    if (filters.account && row.account !== filters.account) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.merchant && row.merchant !== filters.merchant) return false;
    if (
      needle &&
      !row.description.toLowerCase().includes(needle) &&
      !row.merchant.toLowerCase().includes(needle)
    ) {
      return false;
    }
    return true;
  });
}

export function summarize(rows: Transaction[]): Totals {
  const totals: Totals = {
    income: 0,
    salary: 0,
    refunds: 0,
    expense: 0,
    expenseCount: 0,
    net: 0,
    count: rows.length,
  };

  for (const row of rows) {
    if (row.kind === "transfer") continue;
    if (row.kind === "income") {
      totals.income += row.amountMinor;
      // A shop credit is not earnings. Keeping them apart is why the headline
      // salary figure means anything.
      if (row.category === "Salary") totals.salary += row.amountMinor;
      else totals.refunds += row.amountMinor;
    } else {
      totals.expense -= row.amountMinor;
      totals.expenseCount += 1;
    }
  }

  totals.net = totals.income - totals.expense;
  return totals;
}

/** Ascending, with empty months filled in so the chart has no missing columns. */
export function monthlySeries(rows: Transaction[]): MonthPoint[] {
  const buckets = new Map<string, { income: number; expense: number }>();

  for (const row of rows) {
    if (row.kind === "transfer") continue;
    const month = row.bookedOn.slice(0, 7);
    const bucket = buckets.get(month) ?? { income: 0, expense: 0 };
    if (row.kind === "income") bucket.income += row.amountMinor;
    else bucket.expense -= row.amountMinor;
    buckets.set(month, bucket);
  }

  if (buckets.size === 0) return [];

  const months = [...buckets.keys()].sort();
  const series: MonthPoint[] = [];

  for (let month = months[0]; month <= months[months.length - 1]; month = nextMonth(month)) {
    const bucket = buckets.get(month) ?? { income: 0, expense: 0 };
    series.push({
      month,
      label: MONTH_LABELS[Number(month.slice(5, 7)) - 1],
      income: bucket.income,
      expense: bucket.expense,
      net: bucket.income - bucket.expense,
    });
  }

  return series;
}

/** Expenses only, descending by magnitude, with each slice's share of the total. */
function rank(
  rows: Transaction[],
  keyOf: (row: Transaction) => string,
  limit?: number,
): Slice[] {
  const buckets = new Map<string, { amount: number; count: number }>();
  let total = 0;

  for (const row of rows) {
    if (row.kind !== "expense") continue;
    const key = keyOf(row);
    const bucket = buckets.get(key) ?? { amount: 0, count: 0 };
    bucket.amount -= row.amountMinor;
    bucket.count += 1;
    buckets.set(key, bucket);
    total -= row.amountMinor;
  }

  const slices = [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      amount: bucket.amount,
      count: bucket.count,
      share: total === 0 ? 0 : (bucket.amount / total) * 100,
    }))
    .sort((a, b) => b.amount - a.amount);

  return limit ? slices.slice(0, limit) : slices;
}

export function byCategory(rows: Transaction[]): Slice[] {
  return rank(rows, (row) => row.category);
}

export function topMerchants(rows: Transaction[], limit = 8): Slice[] {
  return rank(rows, (row) => row.merchant, limit);
}

/**
 * Computed from the *unfiltered* set: a dropdown that only offers the values
 * surviving the current filter is a dead end the user cannot back out of.
 */
export function facetsOf(rows: Transaction[]): Facets {
  const accounts = new Set<string>();
  const categories = new Set<string>();
  const merchants = new Set<string>();
  let first = "";
  let last = "";

  for (const row of rows) {
    accounts.add(row.account);
    categories.add(row.category);
    merchants.add(row.merchant);
    if (!first || row.bookedOn < first) first = row.bookedOn;
    if (!last || row.bookedOn > last) last = row.bookedOn;
  }

  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
  return {
    accounts: sorted(accounts),
    categories: sorted(categories),
    merchants: sorted(merchants),
    first,
    last,
  };
}
