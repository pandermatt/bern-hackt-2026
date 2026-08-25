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
import { anomalies, transactions, type Transaction } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  applyMerchantOverrides,
  merchantOverridesFor,
} from "@/lib/merchant-overrides";
import {
  getAnomalyKindByTransaction,
  getAnomalyScanState,
  getStoredAnomaliesForPage,
} from "@/app/actions/anomalies";
import { type AnomalyInsight } from "@/lib/anomaly-engine";
import {
  accountTotals,
  applyFilters,
  byCategory,
  calendarMonths,
  facetsOf,
  ledgerChunk,
  monthlySeries,
  monthTotals,
  categorySpendPeriods,
  slotsOf,
  spendForecast,
  stackByCategory,
  summarize,
  topMerchants,
  type CalendarMonth,
  type CategoryPeriods,
  type CategoryStack,
  type Facets,
  type Filters,
  type MonthPoint,
  type MonthTotal,
  type Slice,
  type SpendForecast,
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
  // A rule id from the anomaly engine, e.g. `?anomaly=REPEAT_CHARGE` — the
  // links `/anomalies` hands out. Bounded to the shape a rule id actually has,
  // because the value reaches a SQL `eq()`; anything else falls back to no
  // filter like every other field here.
  anomaly: z.string().regex(/^[A-Z_]{1,60}$/).optional(),
  includeTransfers: z
    .unknown()
    .optional()
    .transform((value) => value === true || value === "true"),
});

/**
 * Which face of the transactions to render. Deliberately **not** part of
 * `filterSchema`: that one feeds `applyFilters`, and a field that changes no
 * row has no business in it. It still lives in the URL for the same reason the
 * filters do — a view should be shareable, bookmarkable and survive a reload.
 */
const viewSchema = z.object({
  view: z.enum(["list", "calendar"]).optional(),
});

export type TransactionView = "list" | "calendar";

function parseView(raw: unknown): TransactionView {
  return viewSchema.safeParse(raw).data?.view ?? "calendar";
}

export type Dashboard = {
  filters: Filters;
  /** Calendar or ledger. `calendar` is the default, so it carries no URL
   * param; the ledger travels as `?view=list`.
   * Not `view` — that name is already taken here by the filtered facets. */
  transactionView: TransactionView;
  /**
   * Per-day aggregates for the calendar, newest month first — `null` in list
   * view, which must not pay for the account-wide anomaly read it needs. The
   * calendar is the default view, so callers with no reader on screen (the
   * chat's `getDashboard({ view: "list" })`) opt out explicitly.
   */
  calendar: CalendarMonth[] | null;
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
   * Monthly spending over the year the statements end in and the year after —
   * the summary row's forward-looking tile. Unfiltered, like the charts and
   * unlike `totals`: it is a statement about the account's run rate, and one
   * that changed when the direction dropdown moved would be describing the
   * filter. `null` when nothing has been spent at all.
   */
  forecast: SpendForecast | null;
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
   * Lets the dashboard prompt for a scan without mistaking a clean account for
   * an un-scanned one, or a re-imported one for either — see
   * getAnomalyScanState.
   */
  anomalyScan: { hasCompletedScan: boolean; running: boolean; outdated: boolean };
  anomalies: AnomalyInsight[];
  /**
   * What the active `?anomaly=` filter is called, for the chip in the filter
   * bar. `null` when no anomaly filter is set — and also when one is set that
   * matches nothing, which the chip still has to render or there would be no
   * way to clear an empty ledger.
   */
  anomalyLabel: string | null;
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
  if (filters.anomaly) {
    // Nothing routes an `anomaly` here today — this builds SQL only for the
    // chat assistant's sandbox, which passes dates and nothing else. It is
    // implemented anyway because one of two implementations of "the filter"
    // quietly ignoring a field is precisely the drift the note above warns
    // about. A subquery, not a join, so the row shape is unchanged; unawaited
    // `db.select()` is construction, so this stays synchronous.
    conditions.push(
      inArray(
        transactions.id,
        db
          .select({ id: anomalies.transactionId })
          .from(anomalies)
          .where(and(eq(anomalies.userId, userId), eq(anomalies.ruleId, filters.anomaly))),
      ),
    );
  }

  return conditions;
}

/**
 * Every row this account owns, as the account holder has decided they read.
 * Scoped by `userId` like every other query in the app — rows with a NULL owner
 * match nobody, by construction.
 *
 * The overrides are applied *here*, on the one read the dashboard, the ledger,
 * the facets, the charts and the assistant all share, rather than at each of
 * those. A merchant re-filed on `/account` has to be re-filed everywhere at
 * once or the donut and the ledger would disagree about the same franc.
 * `app/actions/budget.ts` and the anomaly scan read their own rows and apply
 * the same function for the same reason.
 */
async function ownedRows(): Promise<Transaction[] | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, user.id))
    .orderBy(desc(transactions.bookedOn), asc(transactions.id));

  return applyMerchantOverrides(rows, await merchantOverridesFor(user.id));
}

/**
 * The transactions matching an anomaly rule, plus what that rule calls itself.
 *
 * One query for both: every rule emits a constant `title` literal, so any row's
 * title is the rule's title, and a separate lookup — or a rule-title map in the
 * UI that could drift from the engine — would buy nothing.
 */
async function resolveAnomalyFilter(
  userId: number,
  ruleId: string,
): Promise<{ ids: Set<number>; label: string | null }> {
  const rows = await db
    .select({ transactionId: anomalies.transactionId, title: anomalies.title })
    .from(anomalies)
    .where(and(eq(anomalies.userId, userId), eq(anomalies.ruleId, ruleId)));

  return {
    ids: new Set(rows.map((r) => r.transactionId)),
    label: rows[0]?.title ?? null,
  };
}

/**
 * Everything both ledger readers need, resolved once and in one order.
 *
 * `getDashboard` and `getLedgerChunk` have to agree exactly on which row sits at
 * which offset — the chunks index into this array — so the steps that produce it
 * live here rather than being repeated in two places where they could drift
 * apart. That is the same argument the note on `getLedgerChunk` already makes
 * for sharing `applyFilters`; the anomaly filter added a fourth step to it.
 */
async function ledgerView(raw: unknown): Promise<{
  filters: Filters;
  rows: Transaction[];
  filtered: Transaction[];
  anomalyLabel: string | null;
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const filters = parseFilters(raw);
  const transactionView = parseView(raw);

  const rows = await ownedRows();
  if (!rows) return null;

  // Only pay for this when the filter is actually on — `getDashboard({})` runs
  // on every chat turn as well as every page view.
  const anomaly = filters.anomaly
    ? await resolveAnomalyFilter(user.id, filters.anomaly)
    : null;

  return {
    filters,
    rows,
    filtered: applyFilters(rows, filters, anomaly?.ids),
    anomalyLabel: anomaly?.label ?? null,
  };
}

/**
 * Loads the dashboard:
 * - Loads only the visible page of transactions from the database via SQL LIMIT/OFFSET.
 * - Computes full baseline aggregates and evaluates anomalies specifically for the visible transactions.
 */
export async function getDashboard(raw: unknown): Promise<Dashboard | null> {
  const view = await ledgerView(raw);
  if (!view) return null;
  const { filters, rows, filtered, anomalyLabel } = view;
  const transactionView = parseView(raw);
  const stack = stackByCategory(rows);

  // The ledger's first chunk. This replaced a separate LIMIT/OFFSET query:
  // `filtered` is already the whole ordered result set (the facets, the trend
  // and the totals all need it anyway), so paging it in SQL meant maintaining
  // the same filter twice — once in `buildFilterConditions` and once in
  // `applyFilters` — with nothing checking that the two agreed.
  const chunk = ledgerChunk(filtered, 0);

  /*
   * Only in calendar view. `getAnomalyKindByTransaction` reads every finding
   * the account has, not a page's worth, so the ledger must not be made to pay
   * for a query it never renders.
   *
   * Slots come from the **unfiltered** stack, like the charts': a category's
   * colour identifies the category, and a dot that changed hue when the view
   * narrowed would be describing the filter instead.
   */
  const calendar =
    transactionView === "calendar"
      ? calendarMonths(filtered, slotsOf(stack), await getAnomalyKindByTransaction())
      : null;

  return {
    filters,
    transactionView,
    calendar,
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
    forecast: spendForecast(rows),
    stack,
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
    anomalyLabel,
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
  const view = await ledgerView(raw);
  if (!view) return null;
  const { filtered } = view;

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

/** A booking date, and nothing that could be one by accident. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One day's rows, for the calendar's expanded cell.
 *
 * The same shape `getLedgerChunk` has and for the same reasons: the account
 * comes from the session, the filters go through `ledgerView` so the day shows
 * exactly what the ledger would, and `app/actions/calendar.tsx` wraps this to
 * return the *rendered* rows rather than the rows themselves.
 *
 * `date` is the one thing the caller decides, so it is validated rather than
 * trusted — every export of a `"use server"` module is an endpoint the browser
 * calls with arguments of its choosing. A junk date returns nothing; it cannot
 * widen the set, because the comparison is an equality against text.
 */
export async function getDayRows(date: string, raw: unknown) {
  if (typeof date !== "string" || !DAY_PATTERN.test(date)) return null;

  // Through `ledgerView`, like `getLedgerChunk` — it is the one place the
  // filters are applied, `?anomaly=` included, so the rows an opened day shows
  // are exactly the ones the cell above it counted.
  const view = await ledgerView(raw);
  if (!view) return null;

  const dayRows = view.filtered.filter((row) => row.bookedOn === date);
  if (dayRows.length === 0) return null;

  return {
    rows: dayRows,
    anomalies: await getStoredAnomaliesForPage(dayRows.map((r) => r.id)),
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

/**
 * How many statement lines this account holds, and nothing else.
 *
 * `/onboarding` asks one question — is there anything here yet — to decide
 * whether offering an AI analysis makes any sense. `getDashboard` can answer it,
 * but only by loading every row of the account and computing the facets, the
 * series and the stack to get there; this is the one place in the app that wants
 * the number on its own.
 *
 * A read, so it returns the number rather than the `{ ok }` envelope — that
 * shape exists so a client can toast a failed *mutation*, and this mutates
 * nothing. Signed out is `0` rather than an error, for the same reason
 * `listTransactions` returns an empty array: a page with no reader has no rows.
 */
export async function getTransactionCount(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;

  const [row] = await db
    .select({ total: count() })
    .from(transactions)
    .where(eq(transactions.userId, user.id));

  return row?.total ?? 0;
}

/**
 * Every account the statements name, with how many lines each holds.
 *
 * What the danger zone's "clear transactions" control offers, and the count is
 * the point of it: what a person needs before pressing that is how much is
 * about to go. The ledger's own account picker labels the same names with
 * their *balance* instead, because there the question is what the account is
 * worth rather than how many rows stand behind it.
 *
 * The one read in this module that aggregates in SQL rather than in
 * JavaScript. The rule the dashboard follows — pull the account's rows once
 * and hand them to `lib/insights.ts` — is about five aggregates over one fetch;
 * this is two columns for a settings row, and the generator can put 25k rows in
 * an account, which is a lot to load to count two groups.
 *
 * A read, so it returns its data rather than the `{ ok }` envelope, and signed
 * out is an empty list rather than an error — see `getTransactionCount`.
 */
export type TransactionAccount = { account: string; count: number };

export async function getTransactionAccounts(): Promise<TransactionAccount[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  return db
    .select({ account: transactions.account, count: count() })
    .from(transactions)
    .where(eq(transactions.userId, user.id))
    .groupBy(transactions.account)
    .orderBy(asc(transactions.account));
}
