"use server";

import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { transactions, type Transaction } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  applyFilters,
  byCategory,
  facetsOf,
  monthlySeries,
  stackByCategory,
  paginate,
  summarize,
  topMerchants,
  type CategoryStack,
  type Facets,
  type Filters,
  type MonthPoint,
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
  totals: Totals;
  monthly: MonthPoint[];
  /** Whole-range spending per category per month — the chart pair upstairs. */
  stack: CategoryStack;
  categories: Slice[];
  merchants: Slice[];
  transactions: Transaction[];
  page: number;
  pageCount: number;
  totalCount: number;
};

function parseFilters(raw: unknown): Filters {
  return filterSchema.safeParse(raw).data ?? filterSchema.parse({});
}

/**
 * Parsed independently of `filterSchema`: that schema fails (and falls back
 * to *every* filter defaulting) as one unit, and a mistyped or stale `?page=`
 * — someone hand-edits the URL, or a filter change shrinks the result set out
 * from under a remembered page number — shouldn't wipe out the rest of the
 * filters to fix itself. `paginate` clamps the result into range regardless.
 */
function parsePage(raw: unknown): number {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).page
      : undefined;
  const page = Math.floor(Number(Array.isArray(value) ? value[0] : value));
  return Number.isFinite(page) && page > 0 ? page : 1;
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
 * One fetch, then aggregate in JS.
 *
 * A year of statements is ~500 rows of ~60 KB through a synchronous in-process
 * driver — a full scan is well under a millisecond, and cheaper than five
 * `GROUP BY` round trips that would each re-resolve the session. The amounts
 * are integers, so JS addition is exact where drizzle's SQLite `sum()` is typed
 * `string | null`. And it keeps `lib/insights.ts` pure and database-free, which
 * is what makes it testable in milliseconds.
 *
 * The tradeoff is a row ceiling somewhere around 50k per account; past that,
 * push the aggregates into SQL.
 */
export async function getDashboard(raw: unknown): Promise<Dashboard | null> {
  const rows = await ownedRows();
  if (!rows) return null;

  const filters = parseFilters(raw);
  const filtered = applyFilters(rows, filters);
  // Totals, the trend, and both breakdowns are computed from the full
  // filtered set; only the row list itself is sliced to one page.
  const paged = paginate(filtered, parsePage(raw));

  return {
    filters,
    // Facets and the trend come from the unfiltered set: the dropdowns must not
    // narrow themselves into a dead end, and the year's shape is the point of
    // the chart even when you are looking at one month.
    facets: facetsOf(rows),
    monthly: monthlySeries(rows),
    stack: stackByCategory(rows),
    totals: summarize(filtered),
    categories: byCategory(filtered),
    merchants: topMerchants(filtered, 8),
    transactions: paged.rows,
    page: paged.page,
    pageCount: paged.pageCount,
    totalCount: paged.totalCount,
  };
}

export async function listTransactions(raw: unknown): Promise<Transaction[]> {
  const rows = await ownedRows();
  if (!rows) return [];
  return applyFilters(rows, parseFilters(raw));
}
