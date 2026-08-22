/**
 * Pure aggregation over a user's transactions. No database, no `server-only`:
 * `app/actions/transactions.ts` fetches the rows once and hands them here, and
 * client components import `formatMoney` from the same module.
 *
 * The schema import is **type-only** on purpose. A value import would pull
 * drizzle into the client bundle the moment a `"use client"` file reaches for
 * `formatMoney`, and only `npm run build` would catch it. `AnomalyKind` is
 * imported the same way and for the same reason — the engine beside it is a
 * thousand lines this module has no business shipping.
 */
import type { Transaction } from "@/db/schema";
import type { AnomalyKind } from "@/lib/anomaly-engine";

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
  /**
   * A rule id from the anomaly engine — the ledger narrowed to the rows one
   * kind of finding implicates. The matching transaction ids cannot be derived
   * from a row (findings live in their own table), so the caller resolves them
   * and hands them to `applyFilters` alongside this.
   */
  anomaly?: string;
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

/** Money in and out for one `YYYY-MM`, as the ledger's headings report it. */
export type MonthTotal = { income: number; expense: number };

export type MonthPoint = {
  month: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  /**
   * The effective account balance at the end of this month: the running sum of
   * every month's net from the start of the history. Transfers are excluded
   * with the nets they are summed from — only one side of a transfer between
   * own accounts is recorded, so counting it would fake an outflow the
   * portfolio never had.
   */
  balance: number;
};

/** One column of the summary tile's forecast sparkline. */
export type ForecastPoint = {
  month: string;
  label: string;
  /** Spending that month, a positive magnitude. `null` past the statements. */
  actual: number | null;
  /**
   * The run rate for that calendar month, from the last recorded month on —
   * `average` shaped by `seasonalFactors`. `null` before.
   */
  projected: number | null;
};

export type SpendForecast = {
  /** Exactly 24: January of the anchor year through December of the next. */
  points: ForecastPoint[];
  /** Mean monthly spend over the anchor year's recorded months. */
  average: number;
  /** The year the statements end in — never the calendar's. See below. */
  year: number;
  /** How many months of the anchor year the average is built from. */
  actualMonths: number;
  /** Recorded plus projected for the anchor year. */
  yearTotal: number;
  /** The next year summed — it is projection all the way down. */
  nextYearTotal: number;
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

/**
 * The long form, for the ledger's month headings. Hardcoded for the same reason
 * `MONTH_LABELS` is: a heading should not be the one place in the app that
 * spells a month differently from the charts, and `Intl` is exactly what would
 * make that happen.
 */
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * "2025-12" → `{ name: "December", year: "2025" }`.
 *
 * Split rather than joined because the ledger's month heading sets the two at
 * very different sizes — the month is the thing you are scanning for, the year
 * only disambiguates it.
 */
export function monthParts(month: string): { name: string; year: string } {
  return {
    name: MONTH_NAMES[Number(month.slice(5, 7)) - 1],
    year: month.slice(0, 4),
  };
}

const FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * de-CH's thousands separator is not stable across runtimes: CLDR 47 (Node 22,
 * ICU 77) groups with a right single quote, CLDR 48 (Node 24, ICU 78) with an
 * ASCII apostrophe. Left to ICU, the same amount renders differently depending
 * on which Node the process started under — a diff between a dev machine and
 * CI, and between two deploys of the same commit. Pinned so the output is a
 * property of this function rather than of the runtime's bundled locale data.
 *
 * Written as an escape, not the glyph: telling U+2019 from a plain "'" by eye
 * in a diff is the exact confusion this constant exists to settle.
 */
const GROUP_SEPARATOR = "\u2019";

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
  // Via parts rather than a replace over the finished string, so only the
  // grouping is touched and a currency symbol is left exactly as ICU wrote it.
  return formatter
    .formatToParts(minor / 100)
    .map((part) => (part.type === "group" ? GROUP_SEPARATOR : part.value))
    .join("");
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

/** "2026-01" → "2025-12". The median window walks backwards. */
function prevMonth(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return index === 1
    ? `${year - 1}-12`
    : `${year}-${String(index - 1).padStart(2, "0")}`;
}

/**
 * `anomalyIds` carries the transactions matching `filters.anomaly`. It is a
 * parameter rather than a lookup because this module is pure and has no
 * database — findings live in their own table, and a `Transaction` cannot say
 * whether one points at it.
 *
 * The predicate below keys off the *filter*, not the set, so a caller that asks
 * for an anomaly and forgets the set gets an empty ledger rather than an
 * unfiltered one. That matters because there are two callers — the dashboard
 * and the infinite-scroll chunk — and a silent disagreement between them
 * corrupts the offsets the chunks index by. Failing closed is also the right
 * answer for a rule id nothing matches: no rows, like `?merchant=nonesuch`.
 */
export function applyFilters(
  rows: Transaction[],
  filters: Filters,
  anomalyIds?: ReadonlySet<number>,
): Transaction[] {
  const needle = filters.q?.toLowerCase();

  return rows.filter((row) => {
    if (filters.anomaly && !anomalyIds?.has(row.id)) return false;
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

/**
 * Money in and out per `YYYY-MM`, over exactly the rows given.
 *
 * The ledger's month headings. Unlike `monthlySeries` this fills nothing in —
 * a heading only ever exists above rows, so a month with no rows has no heading
 * to carry a zero.
 *
 * Transfers are skipped, the same as `summarize` and `monthlySeries`: money
 * moved between your own accounts is neither income nor spending. That holds
 * even when `?includeTransfers` puts those rows on screen, so a heading can
 * report less than the rows beneath it appear to sum to — which is the contract
 * the summary tiles and the trend chart's footnote already state.
 *
 * A `Record` rather than a `Map`, so it survives the server-action boundary if
 * `Dashboard` is ever read from a client component.
 */
export function monthTotals(rows: Transaction[]): Record<string, MonthTotal> {
  const totals: Record<string, MonthTotal> = {};

  for (const row of rows) {
    if (row.kind === "transfer") continue;
    // `slice`, not a Date: a booking date is a date, not an instant.
    const month = row.bookedOn.slice(0, 7);
    const bucket = (totals[month] ??= { income: 0, expense: 0 });
    if (row.kind === "income") bucket.income += row.amountMinor;
    else bucket.expense -= row.amountMinor;
  }

  return totals;
}

/**
 * Net movement per account, in minor units.
 *
 * Unlike `summarize` and `monthTotals` this counts **transfers**, and counts
 * them on purpose: a transfer is not income or spending, but it is unambiguously
 * money leaving one of your accounts and arriving in another, so an account's
 * own balance has to include it. Leave it out and the two sides of every
 * credit-card payment vanish from the accounts they actually moved between.
 *
 * Meant to be given the **unfiltered** rows. The figure sits in the account
 * dropdown, and a total that moved when you picked an account would be
 * describing the filter rather than the account.
 */
export function accountTotals(rows: Transaction[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.account] = (totals[row.account] ?? 0) + row.amountMinor;
  }
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
  let balance = 0;

  for (const month of monthAxis([...buckets.keys()])) {
    const bucket = buckets.get(month) ?? { income: 0, expense: 0 };
    const net = bucket.income - bucket.expense;
    balance += net;
    series.push({
      month,
      label: MONTH_LABELS[Number(month.slice(5, 7)) - 1],
      income: bucket.income,
      expense: bucket.expense,
      net,
      balance,
    });
  }

  return series;
}

/**
 * Monthly spending across the year the statements end in and the year after,
 * recorded where there are statements and projected at the run rate from there
 * on — the forward-looking tile in the summary row.
 *
 * **The anchor year comes from the data, not from the clock.** This module
 * constructs no `Date` (see `formatDay`), and the rule the rest of the file
 * follows — `categorySpendPeriods` calls the latest month with spending "this
 * month" — is what keeps a fixed year of imported statements readable in
 * January of the year after. A forecast anchored on the calendar would show an
 * empty current year and predict nothing.
 *
 * The projection is the mean of the recorded months, shaped by the statements'
 * own seasonality — see `seasonalFactors`. It carries no *trend*, which is the
 * honest shape for twelve points, and the twelve factors average exactly 1, so
 * the mean of the dashed line is still the number the tile prints above the
 * chart. The tile says one thing; it just no longer draws it as a ruler.
 */
/** At most this much of an observed deviation carries into a forecast. */
const SEASONAL_DAMPING = 0.6;

/** The furthest a projected month may sit from the run rate, either way. */
const SEASONAL_LIMIT = 0.4;

/**
 * Twelve multipliers on the run rate, one per calendar month: how a December
 * compares with an ordinary month across every year of statements there is.
 *
 * A flat projection is not wrong, but it is the one shape a year of spending
 * never has, and a ruler drawn across the tile reads as a placeholder rather
 * than as a forecast. This is the cheapest honest way to give it a pulse —
 * the wobble is the account's own December and its own August, not noise.
 *
 * Two things keep it a shape rather than a replay. The twelve are **centred on
 * exactly 1**, which is what keeps the projected year summing to the run rate
 * and the tile printing one number instead of two; and they are **damped by a
 * single factor**, tightened until the widest month sits inside
 * `SEASONAL_LIMIT`, so one CHF 6'000 bike gentles the whole curve instead of
 * becoming a permanent January.
 *
 * A calendar month the statements never reached gets 1. No information is the
 * flat run rate, not an invented one.
 */
function seasonalFactors(buckets: Map<string, number>): number[] {
  const amounts = [...buckets.values()];
  const mean = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
  // A history of nothing but zero-franc months has no shape to read, and is
  // also the divide-by-zero.
  if (mean <= 0) return Array<number>(12).fill(1);

  const sums = Array<number>(12).fill(0);
  const counts = Array<number>(12).fill(0);
  for (const [month, amount] of buckets) {
    const index = Number(month.slice(5, 7)) - 1;
    sums[index] += amount;
    counts[index] += 1;
  }

  const raw = sums.map((sum, index) =>
    counts[index] === 0 ? 1 : sum / counts[index] / mean,
  );

  // Centred first, so the twelve average exactly 1 whatever the coverage.
  const scale = 12 / raw.reduce((sum, factor) => sum + factor, 0);
  const centred = raw.map((factor) => factor * scale);

  // One damping for all twelve, tightened until the widest month sits inside
  // the limit. Squeezing the whole shape rather than clipping its peak is what
  // keeps the mean at exactly 1 — clamping one month and rescaling the rest
  // hands the peak back most of what the clamp took, and a year with a CHF
  // 6'000 bike in it came out at twice the run rate every January.
  const widest = Math.max(...centred.map((factor) => Math.abs(factor - 1)));
  const damping = widest > 0 ? Math.min(SEASONAL_DAMPING, SEASONAL_LIMIT / widest) : 0;

  return centred.map((factor) => 1 + (factor - 1) * damping);
}

export function spendForecast(rows: Transaction[]): SpendForecast | null {
  const buckets = new Map<string, number>();

  for (const row of rows) {
    // Expenses only. A refund lands in `income` and would flatter the run
    // rate; a transfer between own accounts is not spending at all — the same
    // exclusions `monthlySeries` and `summarize` make.
    if (row.kind !== "expense") continue;
    const month = row.bookedOn.slice(0, 7);
    buckets.set(month, (buckets.get(month) ?? 0) - row.amountMinor);
  }

  if (buckets.size === 0) return null;

  const recorded = [...buckets.keys()].sort();
  const last = recorded[recorded.length - 1];
  const year = Number(last.slice(0, 4));
  // The anchor year's own first recorded month, not the history's: a two-year
  // import must not average this year against last year's months.
  const first = recorded.find((month) => month.slice(0, 4) === last.slice(0, 4)) ?? last;

  // Gap-filled between the first and last recorded month, exactly as
  // `monthAxis` fills the charts: a month with no spending is a zero, not a
  // hole, and it belongs in the average.
  const actuals: (number | null)[] = [];
  for (let index = 0; index < 24; index += 1) {
    const month = `${year + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    actuals.push(month >= first && month <= last ? (buckets.get(month) ?? 0) : null);
  }

  const months = actuals.filter((value): value is number => value !== null);
  const average = Math.round(
    months.reduce((sum, value) => sum + value, 0) / months.length,
  );

  // Read from every recorded month, not just the anchor year's: the months
  // being projected are exactly the ones the anchor year has no figure for,
  // so a second year of statements is where the shape actually comes from.
  const factors = seasonalFactors(buckets);

  const points: ForecastPoint[] = actuals.map((actual, index) => {
    const month = `${year + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    return {
      month,
      label: MONTH_LABELS[index % 12],
      actual,
      // The last recorded month carries both figures on purpose: the solid
      // line and the dashed one share that vertex, so the join is a change of
      // stroke rather than a gap with a jump across it.
      projected:
        month > last
          ? Math.round(average * factors[index % 12])
          : month === last
            ? actual
            : null,
    };
  });

  const yearTotal = points
    .slice(0, 12)
    .reduce((sum, point) => sum + (point.actual ?? point.projected ?? 0), 0);

  return {
    points,
    average,
    year,
    actualMonths: months.length,
    yearTotal,
    // Summed off the points rather than `average * 12`, so the note under the
    // tile is the total of the line drawn above it to the rappen.
    nextYearTotal: points
      .slice(12)
      .reduce((sum, point) => sum + (point.projected ?? 0), 0),
  };
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
 * How many merchants the split-on-hover bar names before the tail folds
 * together. Five segments is where a 300px bar's thinnest slice is still wider
 * than its own separator; beyond that the split stops being readable.
 */
export const MERCHANT_SEGMENTS = 5;

/** The fold-in tail of a bar's merchant split — a label, not a merchant. */
export const FOLDED_MERCHANTS = "Other merchants";

export type MerchantSegment = { merchant: string; amount: number };

export type CategorySpend = {
  key: string;
  /** The period's spend in this category, a positive magnitude. */
  total: number;
  /**
   * The median of this category's monthly totals over the up-to-twelve months
   * before the running month — months with no spend count as zero, because a
   * month you spent nothing is a real month, not a gap. `null` when there is
   * no earlier history at all, so the chart can drop the marker instead of
   * drawing a median of nothing. The **same figure in both periods**: it is a
   * per-month statistic, and the YTD view scales it by `monthCount` into a
   * "median pace" rather than re-deriving a different median.
   */
  median: number | null;
  /** Descending; at most `MERCHANT_SEGMENTS` entries, the tail folded into
   * `FOLDED_MERCHANTS`. Sums to `total`. */
  merchants: MerchantSegment[];
};

export type CategoryPeriod = {
  /** "YYYY-MM" — the latest month with any expense, which in live use is the
   * current month. Derived from the rows, never from the clock: this module
   * constructs no `Date`. The YTD period ends here too. */
  month: string;
  /** Months the period spans: 1 for the running month, the month's ordinal
   * (January = 1 … December = 12) for year-to-date. What turns the per-month
   * median into a pace on the YTD scale. */
  monthCount: number;
  /**
   * **Every** category with spend in the period, descending by total — not a
   * top-N. The chart slices its own top five, and having the full ranking is
   * what lets it promote the next category when the user hides one.
   */
  categories: CategorySpend[];
};

export type CategoryPeriods = {
  /** The running month alone. */
  month: CategoryPeriod;
  /** January of the running month's year through the running month. */
  ytd: CategoryPeriod;
};

/**
 * The split-on-hover bars' aggregate: expense categories ranked over the
 * running month and over the year-to-date, each carrying its merchant split
 * for that period and a twelve-month median.
 *
 * Meant to be given the **unfiltered** rows, like the other charts: "this
 * month" and "this year" are fixed questions, and a filter that quietly
 * changed which months — or which merchants — the bars describe would make
 * the heading a lie.
 */
export function categorySpendPeriods(
  rows: Transaction[],
): CategoryPeriods | null {
  let month = "";
  let first = "";
  for (const row of rows) {
    if (row.kind !== "expense") continue;
    const key = row.bookedOn.slice(0, 7);
    if (!month || key > month) month = key;
    if (!first || key < first) first = key;
  }
  if (!month) return null;

  const yearStart = `${month.slice(0, 4)}-01`;
  const starts = { month, ytd: yearStart } as const;

  /** category → month → spend, whole range — the medians' baseline. */
  const history = new Map<string, Map<string, number>>();
  /** Per period: category totals, and the category → merchant split. */
  const totals = {
    month: new Map<string, number>(),
    ytd: new Map<string, number>(),
  };
  const splits = {
    month: new Map<string, Map<string, number>>(),
    ytd: new Map<string, Map<string, number>>(),
  };

  for (const row of rows) {
    if (row.kind !== "expense") continue;
    const key = row.bookedOn.slice(0, 7);
    const amount = -row.amountMinor;

    let byMonth = history.get(row.category);
    if (!byMonth) history.set(row.category, (byMonth = new Map()));
    byMonth.set(key, (byMonth.get(key) ?? 0) + amount);

    for (const period of ["month", "ytd"] as const) {
      // Nothing is later than `month` by construction, so the start is the
      // only bound that matters.
      if (key < starts[period]) continue;
      const bucket = totals[period];
      bucket.set(row.category, (bucket.get(row.category) ?? 0) + amount);
      let byMerchant = splits[period].get(row.category);
      if (!byMerchant) splits[period].set(row.category, (byMerchant = new Map()));
      byMerchant.set(row.merchant, (byMerchant.get(row.merchant) ?? 0) + amount);
    }
  }

  // The twelve calendar months before `month`, clipped to where the data
  // starts — a window padded with months that predate the first statement
  // would drag every median towards zero.
  const window: string[] = [];
  for (let key = prevMonth(month); window.length < 12 && key >= first; key = prevMonth(key)) {
    window.push(key);
  }

  const medianOf = (category: string): number | null => {
    if (window.length === 0) return null;
    const byMonth = history.get(category);
    const values = window
      .map((entry) => byMonth?.get(entry) ?? 0)
      .sort((a, b) => a - b);
    const mid = values.length >> 1;
    return values.length % 2 === 1
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2;
  };

  const buildPeriod = (period: "month" | "ytd"): CategoryPeriod => ({
    month,
    monthCount: period === "month" ? 1 : Number(month.slice(5, 7)),
    categories: [...totals[period].entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, total]): CategorySpend => {
        const ranked = [
          ...(splits[period].get(key) ?? new Map<string, number>()).entries(),
        ]
          .map(([merchant, amount]) => ({ merchant, amount }))
          .sort((a, b) => b.amount - a.amount);
        const merchants =
          ranked.length > MERCHANT_SEGMENTS
            ? [
                ...ranked.slice(0, MERCHANT_SEGMENTS - 1),
                {
                  merchant: FOLDED_MERCHANTS,
                  amount: ranked
                    .slice(MERCHANT_SEGMENTS - 1)
                    .reduce((sum, entry) => sum + entry.amount, 0),
                },
              ]
            : ranked;

        return { key, total, median: medianOf(key), merchants };
      }),
  });

  return { month: buildPeriod("month"), ytd: buildPeriod("ytd") };
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
 * `savedMinor` is every allocation ever made to it less everything ever taken
 * back out, not the month's; the pot is cumulative, which is the whole idea of
 * a pot. It never goes negative — a withdrawal is capped at what the pot
 * holds.
 */
export type SavingsPot = {
  id: number;
  name: string;
  targetMinor: number;
  savedMinor: number;
  /**
   * Allocated out of the month being viewed, so the row can show it back —
   * what that month's surplus put in, never net of a withdrawal. This is the
   * figure the allocator's input carries, and that input cannot hold a minus.
   */
  monthMinor: number;
  /**
   * Taken back out of this pot during the month being viewed, positive.
   * Only ever non-zero when more was reclaimed than the month itself put in —
   * money an earlier month saved. See `withdrawnMinor` in `db/schema.ts`.
   */
  monthWithdrawnMinor: number;
  /** `YYYY-MM-DD`, or null for a goal with no deadline. */
  targetOn: string | null;
  /**
   * A lucide name from `GOAL_ICONS`, or null for a goal nobody named one for.
   * Only set where the keyword rules missed and the model was asked instead —
   * see `lib/goal-icon.ts`.
   */
  icon: string | null;
  /** Palette slot, 1-based. Stable per goal — see `potSlot`. */
  slot: number;
};

/**
 * Whether a string is a real calendar day, not merely `\d{4}-\d{2}-\d{2}`.
 *
 * "2026-02-30" and "2026-13-01" both match the shape and neither exists, and
 * a target date is user input. Leap years come from `daysInMonth`, so February
 * is right without constructing a `Date` — this module never does.
 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(value.slice(0, 7));
}

/**
 * Pots in the order they are wanted: soonest deadline first.
 *
 * A pot with no target date sorts **last**, not first. `null` is "eventually",
 * and eventually is never sooner than a date — sorting undated pots to the top
 * would bury the one that is actually due. Ties break on id so the order is
 * stable and a pot does not jump when a sibling is edited.
 */
export function byTargetDate(a: SavingsPot, b: SavingsPot): number {
  if (a.targetOn !== b.targetOn) {
    if (a.targetOn === null) return 1;
    if (b.targetOn === null) return -1;
    // `YYYY-MM-DD` sorts correctly as text, which is half the reason it is
    // stored that way.
    return a.targetOn < b.targetOn ? -1 : 1;
  }
  return a.id - b.id;
}

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
 * Same shape as `monthSurplus`, **not** clamped at zero.
 *
 * `monthSurplus` floors at zero because it feeds two things that both need
 * that floor: `allocateSurplus`'s ceiling (a submitted total of zero must
 * never read as "over" a negative surplus) and the "nothing spare to put
 * away" copy. The Unallocated pot needs the opposite — the whole point of it
 * going red is showing *how far* negative a month went — so it reads off this
 * instead.
 */
export function monthNet(
  series: MonthPoint[],
  month: string,
  ended: boolean,
): number | null {
  if (!ended) return null;
  const point = series.find((entry) => entry.month === month);
  return point?.net ?? 0;
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
 * Which month the savings page opens on: the most recent one that has
 * **finished**.
 *
 * Deliberately not `defaultBudgetMonth`. The two pages want opposite things
 * from "which month", because they ask opposite questions. A budget is a limit
 * on the month you are currently spending, so the running month is the whole
 * point of opening there. A savings allocation is the *leftover* of a month,
 * and `allocateSurplus` refuses a month that has not ended — a surplus
 * computed on the 8th only ever shrinks. Opening on the running month
 * therefore landed the page on the one month it could do nothing with, telling
 * the reader to come back later while last month's money sat one URL away.
 *
 * Falls back to the latest month there is data for when nothing has finished
 * yet — a brand-new account whose statements start this month. That month is
 * still unallocatable, and the page still says so; there is simply nothing
 * better to show.
 *
 * `todayMonth` is passed in rather than derived. This module never constructs a
 * `Date` — see the note on `formatDay` — and "now" is the caller's business
 * anyway.
 */
/**
 * Every franc the account has ever had left over, up to and including `month`.
 *
 * The pool the savings pots are earmarks against — which is the same number as
 * the running account balance, and that is not a coincidence: money left over
 * and not spent *is* the balance. `MonthPoint.balance` already carries it, so
 * this only picks the right point.
 *
 * Savings are deliberately measured against this rather than against one
 * month's own leftover. A pot is not spent out of the month it was created in;
 * it is a claim on money the account is holding, and that money was earned
 * across the whole history. Pinning each pot to a single month made the two
 * drift apart the moment a statement changed — the month's leftover moved and
 * the allocation did not — and produced deficits that were arithmetic
 * artefacts rather than anything the account holder had done.
 *
 * **Unfloored, and summed from raw nets.** A month that spent more than it
 * earned genuinely leaves less to save, so it pulls the pool down. Flooring
 * each month at zero would let a run of overspending vanish and quietly
 * inflate what there is to allocate.
 */
export function pooledLeftover(series: MonthPoint[], month: string): number {
  let pooled = 0;
  for (const point of series) {
    // Ascending, and `balance` is already a running sum — so the last point at
    // or before the month *is* the total, not something to add up again.
    if (point.month > month) break;
    pooled = point.balance;
  }
  return pooled;
}

export function defaultSavingsMonth(
  months: string[],
  todayMonth: string,
): string | null {
  if (months.length === 0) return null;
  // Ascending, so the last one below today is the most recent finished month.
  // A plain string compare, like `monthHasEnded` — that is what `YYYY-MM` text
  // buys over a timestamp.
  for (let i = months.length - 1; i >= 0; i--) {
    if (months[i] < todayMonth) return months[i];
  }
  return months[months.length - 1];
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

/**
 * One chunk of the ledger's infinite scroll: `limit` rows from `from`.
 *
 * **Bounded, deliberately.** An earlier version extended each chunk to the end
 * of whatever month it landed in, so that a month was always delivered whole and
 * its rounded panel could never be split. That is fine at 500 rows a year and
 * catastrophic at 25 000: the biggest month there is over 2 000 rows, so the
 * first chunk was 2 000 rows rendered before first paint and the dashboard
 * simply never finished loading.
 *
 * So a month *can* now span chunks, and the two flags are how the seam is
 * hidden: the continuation renders no second heading, and the panels either
 * side of the cut drop the radius on the edge where they meet, so they read as
 * one panel. `rows` must be in the ledger's own order (`bookedOn` descending),
 * which is what `ownedRows` and `applyFilters` already produce, so a month is a
 * contiguous run and comparing neighbours is enough to spot the cut.
 */
export function ledgerChunk(
  rows: Transaction[],
  from: number,
  limit: number = PAGE_SIZE,
): {
  rows: Transaction[];
  nextOffset: number | null;
  /** Opens mid-month: the previous chunk already headed this month. */
  continuesFrom: boolean;
  /** Closes mid-month: the next chunk carries the rest of it. */
  continuesInto: boolean;
} {
  const monthOf = (row: Transaction) => row.bookedOn.slice(0, 7);

  if (from >= rows.length || from < 0) {
    return { rows: [], nextOffset: null, continuesFrom: false, continuesInto: false };
  }

  const end = Math.min(from + limit, rows.length);

  return {
    rows: rows.slice(from, end),
    nextOffset: end < rows.length ? end : null,
    continuesFrom: from > 0 && monthOf(rows[from - 1]) === monthOf(rows[from]),
    continuesInto: end < rows.length && monthOf(rows[end - 1]) === monthOf(rows[end]),
  };
}

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

/* ------------------------------------------------------------------------- *
 * Calendar
 * ------------------------------------------------------------------------- */

/**
 * How many dots a day cell shows before the rest collapse into "+N".
 *
 * Five is what fits two rows of a 48px cell on a 375px phone. Past that the
 * dots stop being countable anyway, and a number is the honest encoding.
 */
export const MAX_DAY_DOTS = 5;

/** One transaction's mark in a day cell. */
export type DayDot = {
  category: string;
  /** 1-based palette slot from `slotsOf`; 0 is the neutral fold-in bucket. */
  slot: number;
  kind: Transaction["kind"];
};

export type CalendarDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Every transaction booked that day, dots shown or not. */
  count: number;
  /** Minor units, positive. Transfers excluded, exactly as `monthTotals`. */
  income: number;
  /** Minor units, positive magnitude. Transfers excluded. */
  expense: number;
  dots: DayDot[];
  /** `count - dots.length`, so the cell can render "+N" without arithmetic. */
  hiddenDots: number;
  /**
   * The most concerning finding on the day, or `null` when the scan flagged
   * nothing. Ordered by kind, exactly as the ledger's badges are — kind is what
   * carries the colour, and a day tinted on a different axis from the row
   * inside it would be two classifications of one event.
   */
  kind: AnomalyKind | null;
};

/** One month of the calendar. `days` ascending, gaps included as empty cells
 * by the renderer — this carries only the days that exist in the month. */
export type CalendarMonth = { month: string; days: CalendarDay[] };

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * How many days a `YYYY-MM` has.
 *
 * A table and the Gregorian leap rule rather than `new Date(y, m, 0)`: this
 * file never constructs a `Date`, because a booking date is a date and not an
 * instant, and the moment one appears here the whole calendar starts shifting
 * by a day for anyone west of UTC.
 */
export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  if (index !== 1) return DAYS_IN_MONTH[index] ?? 30;
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
}

/** Sakamoto's day-of-week table. */
const SAKAMOTO = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];

/**
 * Which column the 1st of `month` falls in, **Monday-indexed** (0 = Monday).
 *
 * Sakamoto's algorithm, for the same no-`Date` reason as `daysInMonth`. It
 * yields 0 = Sunday, so the result is rotated: Swiss calendars start the week
 * on Monday, and so does the weekday catalog in `messages/*.json`.
 */
export function firstWeekdayOf(month: string): number {
  let year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m < 3) year -= 1;
  const sunday =
    (year +
      Math.floor(year / 4) -
      Math.floor(year / 100) +
      Math.floor(year / 400) +
      SAKAMOTO[m - 1] +
      1) %
    7;
  return (sunday + 6) % 7;
}

const KIND_ORDER: Record<AnomalyKind, number> = { info: 1, warning: 2, alert: 3 };

/**
 * Per-day aggregates for the calendar view — one cell's worth of everything.
 *
 * Fed the **filtered** rows, like `monthTotals` and unlike the charts: the
 * calendar is the ledger's other face, so it shows exactly what the ledger
 * would. `slots` on the other hand comes from the whole-range ranking, so a
 * category keeps the colour its wedge already has however the view is narrowed.
 *
 * Months come back newest-first and days oldest-first. Rows arrive
 * `desc(bookedOn), asc(id)`, so both orders fall out of one pass with no sort:
 * a month is a contiguous run, and a day within it is too.
 *
 * A month with no surviving rows gets no entry at all — the same rule the
 * ledger's headings follow. Filtering to one merchant should not render twelve
 * empty grids.
 */
export function calendarMonths(
  rows: Transaction[],
  slots: Map<string, number>,
  kindByTx: Map<number, AnomalyKind>,
): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  const byDate = new Map<string, CalendarDay>();

  for (const row of rows) {
    const month = row.bookedOn.slice(0, 7);
    let group = months[months.length - 1];
    if (group?.month !== month) {
      group = { month, days: [] };
      months.push(group);
    }

    let day = byDate.get(row.bookedOn);
    if (!day) {
      day = {
        date: row.bookedOn,
        count: 0,
        income: 0,
        expense: 0,
        dots: [],
        hiddenDots: 0,
        kind: null,
      };
      byDate.set(row.bookedOn, day);
      // Newest first on the way in, so the month's days come out ascending.
      group.days.unshift(day);
    }

    day.count += 1;
    // Transfers move money between your own accounts, so they are neither
    // income nor spending — the same exclusion `summarize` and `monthTotals`
    // make. They still get a dot when `?includeTransfers` puts them on screen.
    if (row.kind === "income") day.income += row.amountMinor;
    else if (row.kind === "expense") day.expense -= row.amountMinor;

    if (day.dots.length < MAX_DAY_DOTS) {
      day.dots.push({
        category: row.category,
        slot: slots.get(row.category) ?? 0,
        kind: row.kind,
      });
    } else {
      day.hiddenDots += 1;
    }

    const found = kindByTx.get(row.id);
    if (found && (!day.kind || KIND_ORDER[found] > KIND_ORDER[day.kind])) {
      day.kind = found;
    }
  }

  return months;
}

/** One booking day at one merchant, and everything flagged there. */
export type DayMerchantGroup = {
  /** `${bookedOn}|${merchant}` — stable, and what the resolve control keys on. */
  key: string;
  bookedOn: string;
  merchant: string;
  rows: Transaction[];
  /** Unsigned, so it reads as "how much is in this group". */
  totalMinor: number;
};

/**
 * Rows folded into one group per (booking day, merchant).
 *
 * That pair is the unit `consolidateInsights` in `lib/anomaly-engine.ts`
 * already merges findings on, so grouping the rule page by it puts the same
 * boundary in front of the reader that the engine used behind them — four
 * charges of one duplicate billing read as one thing to resolve, not four.
 *
 * Not a single forward pass like `groupByMonth`: the caller's ordering is
 * `desc(bookedOn), asc(id)`, which keeps a day contiguous but lets one
 * merchant's rows be split by another's within it. The map keeps first-seen
 * order, so the result still runs newest day first.
 */
export function groupByDayMerchant(rows: Transaction[]): DayMerchantGroup[] {
  const groups = new Map<string, DayMerchantGroup>();

  for (const row of rows) {
    const key = `${row.bookedOn}|${row.merchant}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        bookedOn: row.bookedOn,
        merchant: row.merchant,
        rows: [],
        totalMinor: 0,
      };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.totalMinor += Math.abs(row.amountMinor);
  }

  return [...groups.values()];
}
