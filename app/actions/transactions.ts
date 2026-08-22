"use server";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { transactions, type Transaction } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  getAnomalyScanState,
  getStoredAnomaliesForPage,
} from "@/app/actions/anomalies";
import { type AnomalyInsight } from "@/lib/anomaly-engine";
import {
  accountTotals,
  applyFilters,
  byCategory,
  facetsOf,
  ledgerChunk,
  monthlySeries,
  monthTotals,
  categorySpendPeriods,
  stackByCategory,
  summarize,
  topMerchants,
  type CategoryPeriods,
  type CategoryStack,
  type Facets,
  type Filters,
  type MonthPoint,
  type MonthTotal,
  type Slice,
  type Totals,
} from "@/lib/insights";

/**
 * A junk query string should render the dashboard with defaults, not a 500 —
 * so every field is optional and the caller uses `safeParse`. Lengths are
 * bounded because these land in a `filter` over every row.
 */
const filterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  account: z.string().max(60).optional(),
  // `?categories=A&categories=B` arrives as a string array; a single
  // `?categories=A` collapses to a bare string, so both shapes are accepted
  // and normalized to an array here.
  categories: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : (Array.isArray(value) ? value : [value])
            .filter((entry) => entry.length > 0 && entry.length <= 40)
            // There are under 20 categories in `CATEGORIES`; this just caps
            // how much a hand-edited query string can throw at `.includes()`.
            .slice(0, 40),
    ),
  merchant: z.string().max(80).optional(),
  kind: z.enum(["expense", "income"]).optional(),
  q: z.string().trim().max(80).optional(),
  // Not `z.coerce.boolean()`: search params arrive as strings and coercion
  // turns the string "false" into `true`. Only an explicit "true" opts in.
  includeTransfers: z
    .unknown()
    .optional()
    .transform((value) => value === true || value === "true"),
});

export type Dashboard = {
  filters: Filters;
  facets: Facets;
  /** Net movement per account, transfers included — the figure beside each
   * account in the filter dropdown. */
  accountTotals: Record<string, number>;
  /**
   * The same shape as `facets`, but over the rows the filters actually kept —
   * what the header says you are looking at. `facets` cannot answer that: it is
   * deliberately unfiltered so the dropdowns keep offering every option, which
   * means its date range and account list never move when a filter is applied.
   */
  view: Facets;
  totals: Totals;
  monthly: MonthPoint[];
  /**
   * Money in and out per `YYYY-MM`, for the ledger's month headings. Filtered,
   * like `totals` — the headings sit above filtered rows, so they have to say
   * what those rows are part of. Every month across the whole filtered set, not
   * just the chunk on screen, so a heading reads the same however far the
   * reader has scrolled.
   */
  monthTotals: Record<string, MonthTotal>;
  /** Whole-range spending per category per month — the chart pair upstairs. */
  stack: CategoryStack;
  /** Category rankings over the running month and the year-to-date, with
   * merchant splits and twelve-month medians — the split-on-hover bars.
   * Unfiltered, like the other charts, and `null` when no expenses exist at
   * all. */
  topCategories: CategoryPeriods | null;
  /** Whole-range spending per category. No longer rendered on the dashboard —
   * the donut is the only category breakdown now — but the chat assistant reads
   * it to answer category questions; see `lib/assistant.ts`. */
  categories: Slice[];
  merchants: Slice[];
  transactions: Transaction[];
  /**
   * Lets the dashboard prompt for a first scan without mistaking a clean
   * account for an un-scanned one — see getAnomalyScanState.
   */
  anomalyScan: { hasCompletedScan: boolean; running: boolean };
  anomalies: AnomalyInsight[];
  /** Where the ledger's second chunk starts, or `null` when the first one was
   * the lot. The ledger scrolls rather than pages, so there is no page number
   * to carry — see components/transaction-feed.tsx. */
  nextOffset: number | null;
  /** The first chunk stops mid-month, so its last panel must not round off. */
  continuesInto: boolean;
  totalCount: number;
};

function parseFilters(raw: unknown): Filters {
  return filterSchema.safeParse(raw).data ?? filterSchema.parse({});
}


/**
 * Builds the array of SQL conditions matching the applied user filters.
 */
function buildFilterConditions(userId: number, filters: Filters): SQL[] {
  const conditions: SQL[] = [eq(transactions.userId, userId)];

  if (!filters.includeTransfers) {
    conditions.push(ne(transactions.kind, "transfer"));
  }
  if (filters.kind) {
    conditions.push(eq(transactions.kind, filters.kind));
  }
  if (filters.from) {
    conditions.push(gte(transactions.bookedOn, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(transactions.bookedOn, filters.to));
  }
  if (filters.account) {
    conditions.push(eq(transactions.account, filters.account));
  }
  if (filters.categories && filters.categories.length > 0) {
    conditions.push(inArray(transactions.category, filters.categories));
  }
  if (filters.merchant) {
    conditions.push(eq(transactions.merchant, filters.merchant));
  }
  if (filters.q) {
    const needle = `%${filters.q}%`;
    conditions.push(
      or(
        like(transactions.description, needle),
        like(transactions.merchant, needle),
      )!,
    );
  }

  return conditions;
}

/**
 * Every row this account owns. Scoped by `userId` like every other query in
 * the app — rows with a NULL owner match nobody, by construction.
 */
async function ownedRows(): Promise<Transaction[] | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  return db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, user.id))
    .orderBy(desc(transactions.bookedOn), asc(transactions.id));
}

/**
 * Loads the dashboard:
 * - Loads only the visible page of transactions from the database via SQL LIMIT/OFFSET.
 * - Computes full baseline aggregates and evaluates anomalies specifically for the visible transactions.
 */
export async function getDashboard(raw: unknown): Promise<Dashboard | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const filters = parseFilters(raw);

  const rows = await ownedRows();
  if (!rows) return null;

  const filtered = applyFilters(rows, filters);

  // The ledger's first chunk. This replaced a separate LIMIT/OFFSET query:
  // `filtered` is already the whole ordered result set (the facets, the trend
  // and the totals all need it anyway), so paging it in SQL meant maintaining
  // the same filter twice — once in `buildFilterConditions` and once in
  // `applyFilters` — with nothing checking that the two agreed.
  const chunk = ledgerChunk(filtered, 0);

  return {
    filters,
    // Facets and the trend come from the unfiltered set: the dropdowns must not
    // narrow themselves into a dead end, and the year's shape is the point of
    // the chart even when you are looking at one month.
    facets: facetsOf(rows),
    // Unfiltered, like the facets themselves: this figure labels the account in
    // the dropdown, and a total that moved when you picked one would be
    // describing the filter instead of the account.
    accountTotals: accountTotals(rows),
    view: facetsOf(filtered),
    monthly: monthlySeries(rows),
    stack: stackByCategory(rows),
    topCategories: categorySpendPeriods(rows),
    totals: summarize(filtered),
    monthTotals: monthTotals(filtered),
    categories: byCategory(filtered),
    merchants: topMerchants(filtered, 8),
    transactions: chunk.rows,
    // Read back from the last scan instead of re-deriving. Running the engine
    // here meant every page view paid for a full-history analysis; on a large
    // account that took minutes and took the server down with it. Scans are
    // now triggered from the account page — see app/actions/anomalies.ts.
    anomalies: await getStoredAnomaliesForPage(chunk.rows.map((r) => r.id)),
    anomalyScan: await getAnomalyScanState(),
    nextOffset: chunk.nextOffset,
    continuesInto: chunk.continuesInto,
    totalCount: filtered.length,
  };
}

/**
 * The data behind one chunk of the infinite-scrolling ledger.
 *
 * Resolves the account from the session, never from an argument — every export
 * of a `"use server"` module is an endpoint the browser can call with arguments
 * it chooses, so an offset is all the caller gets to decide. `raw` only ever
 * narrows a set that is already scoped to the caller, and it is parsed with the
 * same `safeParse(…) ?? default` contract as the page.
 *
 * Filtering goes through `applyFilters` rather than SQL for the same reason
 * `getDashboard` does: both have to agree on which row is at which offset, and
 * the only way to guarantee that is to use the one implementation.
 *
 * `app/actions/ledger.tsx` wraps this and returns the rendered element, which
 * is what keeps the rows off the client.
 */
export async function getLedgerChunk(offset: number, raw: unknown) {
  const user = await getCurrentUser();
  if (!user) return null;

  const rows = await ownedRows();
  if (!rows) return null;

  const filtered = applyFilters(rows, parseFilters(raw));
  const chunk = ledgerChunk(filtered, Math.max(0, Math.floor(offset) || 0));
  if (chunk.rows.length === 0) return null;

  return {
    rows: chunk.rows,
    nextOffset: chunk.nextOffset,
    continuesFrom: chunk.continuesFrom,
    continuesInto: chunk.continuesInto,
    monthTotals: monthTotals(filtered),
    anomalies: await getStoredAnomaliesForPage(chunk.rows.map((r) => r.id)),
  };
}

export async function listTransactions(raw: unknown): Promise<Transaction[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const filters = parseFilters(raw);
  const conditions = buildFilterConditions(user.id, filters);

  return db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.bookedOn), asc(transactions.id));
}
