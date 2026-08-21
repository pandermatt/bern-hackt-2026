"use server";

import {
  and,
  asc,
  count,
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
  analyzeTransactionAnomalies,
  type AnomalyInsight,
} from "@/lib/anomaly-engine";
import {
  applyFilters,
  byCategory,
  facetsOf,
  monthlySeries,
  PAGE_SIZE,
  summarize,
  topMerchants,
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
  categories: Slice[];
  merchants: Slice[];
  transactions: Transaction[];
  anomalies: AnomalyInsight[];
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
 * filters to fix itself.
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
 * Loads only the current page of transactions directly from the database
 * using SQL LIMIT and OFFSET.
 */
async function getPaginatedTransactionsFromDb(
  userId: number,
  filters: Filters,
  page: number,
  pageSize: number = PAGE_SIZE,
): Promise<{ rows: Transaction[]; totalCount: number; pageCount: number; page: number }> {
  const conditions = buildFilterConditions(userId, filters);
  const whereClause = and(...conditions);

  // Count total matching rows in database
  const [countResult] = await db
    .select({ total: count() })
    .from(transactions)
    .where(whereClause);

  const totalCount = countResult?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedPage = Math.min(Math.max(1, page), pageCount);
  const offset = (clampedPage - 1) * pageSize;

  // Query only the rows in view for the current page directly from the database
  const rows = await db
    .select()
    .from(transactions)
    .where(whereClause)
    .orderBy(desc(transactions.bookedOn), asc(transactions.id))
    .limit(pageSize)
    .offset(offset);

  return {
    rows,
    totalCount,
    pageCount,
    page: clampedPage,
  };
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
  const targetPage = parsePage(raw);

  // 1. Load only the current page of transactions from the database
  const paged = await getPaginatedTransactionsFromDb(user.id, filters, targetPage);

  // 2. Fetch full historical baseline rows for calculations (facets, monthly trend, totals, anomaly baseline)
  const rows = await ownedRows();
  if (!rows) return null;

  const filtered = applyFilters(rows, filters);

  return {
    filters,
    // Facets and the trend come from the unfiltered set: the dropdowns must not
    // narrow themselves into a dead end, and the year's shape is the point of
    // the chart even when you are looking at one month.
    facets: facetsOf(rows),
    monthly: monthlySeries(rows),
    totals: summarize(filtered),
    categories: byCategory(filtered),
    merchants: topMerchants(filtered, 8),
    transactions: paged.rows, // only the rows in view loaded from the database
    anomalies: analyzeTransactionAnomalies(rows, {
      targetTransactionIds: paged.rows.map((r) => r.id),
    }),
    page: paged.page,
    pageCount: paged.pageCount,
    totalCount: paged.totalCount,
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
