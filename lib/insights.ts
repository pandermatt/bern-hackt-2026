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
  /** Zero or more — an empty array behaves like "unset", same as everywhere
   * else in this type. */
  categories?: string[];
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

/**
 * One band of the stacked area chart and one wedge of the pie — the two views
 * are the same aggregate, so a category cannot mean one colour in one and
 * another colour in the other.
 */
export type CategoryBand = {
  key: string;
  /**
   * Fixed palette slot, 1-based to match the `--chart-N` tokens, or 0 for the
   * neutral fold-in bucket. Derived from the whole-range ranking and therefore
   * stable under filtering: a colour identifies a category, never its current
   * rank. Re-colouring the survivors when a filter changes is the fastest way
   * to make a chart lie.
   */
  slot: number;
  /** Whole-range expense total, a positive magnitude. */
  total: number;
  /** One figure per entry in `months`, in the same order. */
  values: number[];
};

export type CategoryStack = {
  /** "2025-01" … , gap-filled. */
  months: string[];
  /** "Jan" … , aligned with `months`. */
  labels: string[];
  /** Descending by total, with the fold-in bucket last if it exists. */
  bands: CategoryBand[];
  /** The sum of every band — what the pie divides up. */
  total: number;
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
    if (
      filters.categories &&
      filters.categories.length > 0 &&
      !filters.categories.includes(row.category)
    ) {
      return false;
    }
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

  const series: MonthPoint[] = [];

  for (const month of monthAxis([...buckets.keys()])) {
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

/**
 * How many categories get an identity colour before the tail folds together.
 * The categorical ramp is ten fixed hues; an eleventh is never generated, so
 * the eleventh-and-beyond categories become "Other" instead.
 */
export const CATEGORY_SLOTS = 10;

/**
 * The fold-in bucket. `scripts/lib/statement.ts` already assigns a literal
 * "Other" category, and it always lands here rather than competing for a slot
 * of its own — otherwise a big enough miscellaneous bucket would win a colour
 * and the chart would carry two bands both labelled "Other".
 */
export const OTHER_CATEGORY = "Other";

/** The gap-filled month axis shared by `monthlySeries` and `stackByCategory`. */
function monthAxis(months: string[]): string[] {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  const axis: string[] = [];
  for (
    let month = sorted[0];
    month <= sorted[sorted.length - 1];
    month = nextMonth(month)
  ) {
    axis.push(month);
  }
  return axis;
}

/**
 * Expenses per category per month — the stacked area chart's series, and the
 * pie's wedges, from one pass.
 *
 * Slots are assigned from the **whole-range** ranking, which is what keeps a
 * category's colour fixed while the user filters. The caller decides which rows
 * to hand over; the dashboard hands over the unfiltered set, so the year's
 * shape stays the year's shape even when the ledger below is showing one month.
 */
export function stackByCategory(rows: Transaction[]): CategoryStack {
  const totals = new Map<string, number>();
  const perMonth = new Map<string, Map<string, number>>();
  const seenMonths: string[] = [];

  for (const row of rows) {
    if (row.kind !== "expense") continue;
    const month = row.bookedOn.slice(0, 7);
    const amount = -row.amountMinor;

    totals.set(row.category, (totals.get(row.category) ?? 0) + amount);

    let bucket = perMonth.get(month);
    if (!bucket) {
      bucket = new Map();
      perMonth.set(month, bucket);
      seenMonths.push(month);
    }
    bucket.set(row.category, (bucket.get(row.category) ?? 0) + amount);
  }

  const months = monthAxis(seenMonths);
  if (months.length === 0) {
    return { months: [], labels: [], bands: [], total: 0 };
  }

  // Rank everything except the literal "Other", which is the tail by
  // definition and never competes for an identity slot.
  const ranked = [...totals.entries()]
    .filter(([key]) => key !== OTHER_CATEGORY)
    .sort((a, b) => b[1] - a[1]);

  const named = ranked.slice(0, CATEGORY_SLOTS).map(([key]) => key);
  const folded = new Set([
    ...ranked.slice(CATEGORY_SLOTS).map(([key]) => key),
    ...(totals.has(OTHER_CATEGORY) ? [OTHER_CATEGORY] : []),
  ]);

  const valuesFor = (matches: (category: string) => boolean) =>
    months.map((month) => {
      const bucket = perMonth.get(month);
      if (!bucket) return 0;
      let sum = 0;
      for (const [category, amount] of bucket) if (matches(category)) sum += amount;
      return sum;
    });

  const bands: CategoryBand[] = named.map((key, index) => ({
    key,
    slot: index + 1,
    total: totals.get(key) ?? 0,
    values: valuesFor((category) => category === key),
  }));

  if (folded.size > 0) {
    let total = 0;
    for (const key of folded) total += totals.get(key) ?? 0;
    bands.push({
      key: OTHER_CATEGORY,
      slot: 0,
      total,
      values: valuesFor((category) => folded.has(category)),
    });
  }

  return {
    months,
    labels: months.map((month) => MONTH_LABELS[Number(month.slice(5, 7)) - 1]),
    bands,
    total: bands.reduce((sum, band) => sum + band.total, 0),
  };
}

/**
 * How many categories the budget radar carries. A radar stops being readable
 * somewhere past eight spokes — the labels collide and the polygon turns to
 * noise — so the tail is simply not budgeted rather than crammed in.
 */
export const BUDGET_AXES = 8;

export type BudgetRow = {
  category: string;
  /** The same palette slot the category wears on the dashboard. */
  slot: number;
  /** What the account holder set, or null if they have not set one. */
  limitMinor: number | null;
  /** Average spend per month across the whole range — the app's suggestion. */
  suggestedMinor: number;
  /** Spend in the month being viewed. Partial if that month is still running. */
  usedMinor: number;
};

/**
 * The budget page's rows: one per category, carrying the limit, the suggestion
 * and the month's usage side by side.
 *
 * Built on `stackByCategory` rather than its own pass, so the ranking and the
 * colour slots are the same ones the dashboard uses — a category cannot be
 * teal on one page and coral on the next. "Other" is excluded: it is a bucket,
 * not something anyone budgets for.
 *
 * The suggestion is the mean monthly spend over the **whole** range, not the
 * trailing few months. A budget set from a quiet stretch is one you break in
 * the first busy month.
 */
export function budgetRows(
  rows: Transaction[],
  month: string,
  limits: Map<string, number>,
  axes = BUDGET_AXES,
): BudgetRow[] {
  const stack = stackByCategory(rows);
  if (stack.months.length === 0) return [];

  const index = stack.months.indexOf(month);
  const monthCount = stack.months.length;

  return stack.bands
    .filter((band) => band.slot !== 0)
    .slice(0, axes)
    .map((band) => ({
      category: band.key,
      slot: band.slot,
      limitMinor: limits.get(band.key) ?? null,
      suggestedMinor: Math.round(band.total / monthCount),
      // A month outside the range is not an error — it is a month with no
      // spending, which is exactly zero used.
      usedMinor: index >= 0 ? (band.values[index] ?? 0) : 0,
    }));
}

/** How many pots the ramp can colour before the neutral takes over. */
export const SAVINGS_SLOTS = CATEGORY_SLOTS;

/**
 * A savings goal with its pot filled in.
 *
 * `savedMinor` is every allocation ever made to it, not the month's; the pot
 * is cumulative, which is the whole idea of a pot.
 */
export type SavingsPot = {
  id: number;
  name: string;
  targetMinor: number;
  savedMinor: number;
  /** Allocated out of the month being viewed, so the row can show it back. */
  monthMinor: number;
  /** Palette slot, 1-based. Stable per goal — see `potSlot`. */
  slot: number;
};

/**
 * A pot's colour slot.
 *
 * Derived from the goal's row id, not from its position in the list. Colouring
 * by index would repaint every pot the moment one is deleted, and the app's
 * rule is that a colour identifies a thing rather than its rank. Goals have no
 * chart counterpart to agree with, so any stable mapping will do — this one is
 * stable because ids are.
 */
export function potSlot(goalId: number, slots = SAVINGS_SLOTS): number {
  return ((goalId - 1) % slots) + 1;
}

/**
 * How full a pot is, 0…1.
 *
 * Clamped at the top: over-funding a goal is allowed — money does not bounce
 * off a full pot — but a fill of 130% would draw outside the jar.
 */
export function potFill(savedMinor: number, targetMinor: number): number {
  if (targetMinor <= 0) return savedMinor > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, savedMinor / targetMinor));
}

/**
 * The percentage a pot has reached, **unclamped**.
 *
 * The drawing clamps, because a jar has a rim; the label must not, because a
 * pot holding CHF 300 against a CHF 200 goal that reads "100%" is hiding the
 * more interesting number. Both come off the same pair of amounts — this is
 * the one that gets printed.
 */
export function potPercent(savedMinor: number, targetMinor: number): number {
  if (targetMinor <= 0) return savedMinor > 0 ? 100 : 0;
  return Math.round(Math.max(0, savedMinor / targetMinor) * 100);
}

/**
 * What a finished month had left over: income it did not spend.
 *
 * `null` while the month is still running, which is a different answer from
 * zero. A surplus computed on the 8th is a number that shrinks for the rest of
 * the month, and offering it as money to put away invites allocating rent.
 * A month that spent more than it earned has nothing spare, which *is* zero.
 */
export function monthSurplus(
  series: MonthPoint[],
  month: string,
  ended: boolean,
): number | null {
  if (!ended) return null;
  const point = series.find((entry) => entry.month === month);
  if (!point) return 0;
  return Math.max(0, point.net);
}

/**
 * Which month the budget page opens on: the current one when the statements
 * reach it, otherwise the most recent month there is data for.
 *
 * `todayMonth` is passed in rather than derived. This module never constructs a
 * `Date` — see the note on `formatDay` — and "now" is the caller's business
 * anyway.
 */
export function defaultBudgetMonth(
  months: string[],
  todayMonth: string,
): string | null {
  if (months.length === 0) return null;
  return months.includes(todayMonth) ? todayMonth : months[months.length - 1];
}

/**
 * category → palette slot, so the breakdown list beneath the charts paints each
 * row the colour its wedge already has. Anything the stack folded away — and
 * anything absent from it entirely — resolves to slot 0, the neutral.
 */
export function slotsOf(stack: CategoryStack): Map<string, number> {
  return new Map(stack.bands.map((band) => [band.key, band.slot]));
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

/** Rows per page in the transaction list. Not a URL param — one fixed size
 * keeps a shared link's page count stable. */
export const PAGE_SIZE = 50;

export type Page<T> = {
  rows: T[];
  /** Clamped into `[1, pageCount]` (or 1 when there are no rows at all), so a
   * stale or out-of-range `?page=` — the list narrowed under a filter change,
   * or someone edited the URL by hand — degrades to the nearest real page
   * instead of rendering empty. Same "junk input renders a sane default, not
   * a 500" contract `app/actions/transactions.ts` holds for the other
   * filters. */
  page: number;
  pageCount: number;
  /** Rows in the full (filtered, unpaginated) set — what the "N lines"
   * header counts, as opposed to `rows.length`, which is at most `pageSize`. */
  totalCount: number;
};

export function paginate<T>(
  rows: T[],
  page: number,
  pageSize: number = PAGE_SIZE,
): Page<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(Math.max(1, page), pageCount);
  const start = (clamped - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    page: clamped,
    pageCount,
    totalCount: rows.length,
  };
}
