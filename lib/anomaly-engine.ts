/**
 * Deterministic Transaction Anomaly Detection Engine
 *
 * Implements 26 statistical / deterministic rules for analyzing user bank transactions.
 * Rules operate ONLY on mathematical baselines (median, MAD, percentiles, intervals, trend regressions).
 * No LLMs, no intent inference, no subjective fraud labeling.
 *
 * The rules are tuned against `scripts/seed-data` — a year of real Swiss
 * statements — rather than against fixtures, and `tests/anomaly-seed-data.test.ts`
 * holds that tuning in place. Two things that measurement settled, in case they
 * look arbitrary later:
 *
 *  - A baseline is only trustworthy if the things in it are comparable. Falling
 *    back to a category when a merchant is too sparse sounds safe and is not: it
 *    measured power bills against phone bills.
 *  - Rules overlap. Four of them describe one transaction's amount, so without
 *    the consolidation pass at the bottom of this file, one afternoon of airline
 *    bookings reported itself fifteen times.
 */

import { formatDay, formatMoney } from "@/lib/insights";

export type AnomalySeverity = "low" | "medium" | "high";

/**
 * How much concern a finding warrants — a second axis, deliberately not a
 * rename of `severity`.
 *
 * `severity` is statistical magnitude: how far from its own baseline a number
 * sits. `kind` is what the reader should feel about it. They are not the same
 * question, and a large legitimate purchase is the case that separates them —
 * a CHF 6'000 bike is `high` severity and merely `warning` in kind.
 *
 * `alert` means "this may not be your doing". Nothing deterministic ever
 * produces it: the narrative layer proposes it and `canEscalateToAlert` has to
 * co-sign. See the note there.
 */
export type AnomalyKind = "info" | "warning" | "alert";

const KIND_ORDER: Record<AnomalyKind, number> = { info: 1, warning: 2, alert: 3 };

/** The stronger of two kinds, on the `info < warning < alert` ordering. */
export function strongestKind(a: AnomalyKind, b: AnomalyKind): AnomalyKind {
  return KIND_ORDER[a] >= KIND_ORDER[b] ? a : b;
}

/**
 * The kind every finding starts at, before the narrative layer sees it.
 *
 * Deliberately a coarsening of `severity` and nothing cleverer: it keeps the
 * two axes in step, which is what lets the ledger sort by kind and fall back to
 * severity without the two orderings ever disagreeing.
 */
export function derivedKind(severity: AnomalySeverity): AnomalyKind {
  return severity === "low" ? "info" : "warning";
}

/**
 * Rules whose findings may be escalated to `alert`, each paired below with a
 * numeric co-signature in `canEscalateToAlert`.
 *
 * The list is short on purpose. Painting a row red in a finance app says "this
 * may not have been you", and the cost of being wrong is a person calling their
 * bank about their own holiday booking. Every rule left out was left out
 * because its modal case is legitimate: the amount rules fire on genuine large
 * purchases, the month-aggregate rules describe a trend rather than a charge —
 * and they attach to the month's largest transaction, so a red wash would land
 * on an arbitrary innocent row.
 */
export const ALERT_ELIGIBLE_RULES = new Set([
  "REPEAT_CHARGE",
  "LARGE_TRANSFER",
  "NEW_COUNTERPARTY",
  "CASH_WITHDRAWAL_SPIKE",
]);

/**
 * Whether a finding's own evidence supports calling it `alert`.
 *
 * This is the deterministic half of a two-key gate: the LLM may propose `alert`
 * but cannot grant it, because "does this look like fraud" is exactly the
 * judgement an 8B model at temperature 0.1 will answer yes to. Being a pure
 * function of metrics the rules already compute, it lives here beside them
 * rather than in the narrative layer.
 *
 * `LARGE_TRANSFER` and `NEW_COUNTERPARTY` are each other's co-signature: a big
 * transfer is ordinary, a first-time recipient is ordinary, and a big transfer
 * to a first-time recipient is the shape of an authorised-push-payment scam.
 * Neither qualifies alone, which is why this takes the whole candidate set.
 */
export function canEscalateToAlert(
  insight: Pick<AnomalyInsight, "rule_id" | "transaction_ids" | "supporting_metrics">,
  siblings: readonly Pick<AnomalyInsight, "rule_id" | "transaction_ids">[] = [],
): boolean {
  if (!ALERT_ELIGIBLE_RULES.has(insight.rule_id)) return false;

  const m = insight.supporting_metrics;
  const num = (key: string): number =>
    typeof m[key] === "number" ? (m[key] as number) : NaN;

  const sharesTransactionWith = (ruleId: string): boolean =>
    siblings.some(
      (s) =>
        s.rule_id === ruleId &&
        s.transaction_ids.some((id) => insight.transaction_ids.includes(id)),
    );

  switch (insight.rule_id) {
    /*
     * Double billing. The repeat-days clause is what keeps the seed statements'
     * four identical CHF 1'766.50 airline charges out of red: that is a real
     * holiday booking, and the merchant repeats on three of its four active
     * days. A merchant that bills twice on one day and never otherwise is a
     * different animal.
     */
    case "REPEAT_CHARGE":
      return num("charge_count") >= 3 && num("merchant_repeat_days") <= 1;

    case "LARGE_TRANSFER":
      return sharesTransactionWith("NEW_COUNTERPARTY");

    case "NEW_COUNTERPARTY":
      return sharesTransactionWith("LARGE_TRANSFER");

    // An outlier withdrawal against the account's own withdrawal history.
    case "CASH_WITHDRAWAL_SPIKE":
      return num("mad_deviation") >= 5;

    default:
      return false;
  }
}

export const RULE_EMOJIS = {
  AMOUNT_SPIKE: "🔺",
  UNUSUALLY_LARGE_TRANSACTION: "💰",
  NEW_MERCHANT: "🏪",
  NEW_CATEGORY: "🏷️",
  FREQUENCY_SPIKE: "🔁",
  CATEGORY_SPENDING_SPIKE: "📈",
  NEW_RECURRING_PAYMENT: "📅",
  RECURRING_PAYMENT_CHANGE: "🔄",
  RECURRING_PAYMENT_DISAPPEARANCE: "❌",
  UNUSUAL_DAY: "🗓️",
  REPEAT_CHARGE: "👯",
  NEW_COUNTERPARTY: "👤",
  LARGE_TRANSFER: "↔️",
  INCOME_DEVIATION: "💼",
  MISSING_EXPECTED_INCOME: "⌛",
  BALANCE_DROP: "📉",
  SAVINGS_RATE_CHANGE: "🐷",
  CATEGORY_SHIFT: "🔀",
  MERCHANT_CONCENTRATION: "🎯",
  ROUND_NUMBER_TRANSACTION: "🔢",
  REFUND_ANOMALY: "↩️",
  CASH_WITHDRAWAL_SPIKE: "💵",
  PAYMENT_METHOD_SHIFT: "💳",
  EXPENSE_GROWTH_TREND: "📊",
  SUBSCRIPTION_ACCUMULATION: "📚",
  UNUSUAL_FINANCIAL_IMPACT: "⚠️",
} as const satisfies Record<string, string>;

/** Every rule the engine can emit. */
export type RuleId = keyof typeof RULE_EMOJIS;

/** Findings arrive as a bare `string` from the database, so this narrows. */
export function emojiFor(ruleId: string): string {
  return (RULE_EMOJIS as Record<string, string>)[ruleId] ?? "⚠️";
}

/**
 * Whether a finding is something to *do* something about, or something to
 * simply know.
 *
 * `/anomalies` splits on this, and the split is the whole value of that page: a
 * duplicate charge is a refund request, a shifted savings rate is a fact about
 * last month. Both are true, only one has a next step.
 *
 * The bar for "action" is deliberately high — is there a plausible next move,
 * and would you regret not looking? A column of fifteen is not a column anyone
 * works through. Three that look actionable and are not:
 *
 *  - `AMOUNT_SPIKE` is merchant-relative and the highest-volume of the amount
 *    rules. "You spent more at Coop than usual" — you know.
 *  - `BALANCE_DROP` describes a seven-day window, not an event, so there is
 *    nothing to act on.
 *  - `LARGE_TRANSFER` moves your own money between your own accounts; this app
 *    defines a transfer that way (see `applyFilters` in lib/insights.ts).
 *
 * `NEW_COUNTERPARTY` is the close call — a first payment to an unseen recipient
 * is the strongest fraud signal here — but under that same definition a
 * transfer has no third party, so it stays context until one can exist.
 *
 * Typed against `RuleId`, so a rule added later fails the build rather than
 * defaulting quietly into "just so you know".
 */
export type Attention = "action" | "context";

export const RULE_ATTENTION: Record<RuleId, Attention> = {
  REPEAT_CHARGE: "action",
  MISSING_EXPECTED_INCOME: "action",
  INCOME_DEVIATION: "action",
  RECURRING_PAYMENT_CHANGE: "action",
  NEW_RECURRING_PAYMENT: "action",
  RECURRING_PAYMENT_DISAPPEARANCE: "action",
  SUBSCRIPTION_ACCUMULATION: "action",
  UNUSUALLY_LARGE_TRANSACTION: "action",
  UNUSUAL_FINANCIAL_IMPACT: "action",

  AMOUNT_SPIKE: "context",
  NEW_MERCHANT: "context",
  NEW_CATEGORY: "context",
  FREQUENCY_SPIKE: "context",
  CATEGORY_SPENDING_SPIKE: "context",
  UNUSUAL_DAY: "context",
  NEW_COUNTERPARTY: "context",
  LARGE_TRANSFER: "context",
  BALANCE_DROP: "context",
  SAVINGS_RATE_CHANGE: "context",
  CATEGORY_SHIFT: "context",
  MERCHANT_CONCENTRATION: "context",
  ROUND_NUMBER_TRANSACTION: "context",
  REFUND_ANOMALY: "context",
  CASH_WITHDRAWAL_SPIKE: "context",
  PAYMENT_METHOD_SHIFT: "context",
  EXPENSE_GROWTH_TREND: "context",
};

/** Unknown ids (a stale finding from an older engine) read as context. */
export function attentionFor(ruleId: string): Attention {
  return (RULE_ATTENTION as Record<string, Attention>)[ruleId] ?? "context";
}

export interface AnomalyInsight {
  rule_id: string;
  /** English, and only a fallback — see `params`. */
  title: string;
  /** English, and only a fallback — see `params`. */
  description: string;
  /**
   * The values this rule's message needs, locale-neutral.
   *
   * `title` and `description` above are written in English because the LLM
   * narrative layer reads them and because a row stored before this existed
   * still has to render. What the UI actually shows is the `AnomalyFindings`
   * message for `rule_id`, filled with these — so a finding scanned once reads
   * in whichever language its reader is in, rather than in the language the
   * scan happened to run in. Amounts are pre-formatted (money is `de-CH`
   * everywhere in this app, see `formatMoney`); anything genuinely
   * language-dependent — a category, a month, a weekday — is passed as its key
   * and resolved by `lib/anomaly-text.ts` against the catalogs.
   */
  params?: Record<string, string | number>;
  /**
   * The rule whose message renders this finding, when that is not `rule_id`
   * itself. Only the narrative layer sets it — merging several findings into
   * one leaves `rule_id` as `COMBINED_INSIGHT`, which has no message of its
   * own, so the primary candidate's rule is kept here for the fallback.
   */
  base_rule_id?: string;
  /**
   * Which language `title` and `description` are written in, when the model
   * wrote them. `undefined` means the engine did, in English — which is
   * translatable from `params` and so never needs this.
   */
  narrative_locale?: string;
  severity: AnomalySeverity;
  kind: AnomalyKind;
  transaction_ids: number[];
  supporting_metrics: Record<string, number | string | boolean | (number | string)[]>;
  icon: string;
  emoji: string;
}

export interface TransactionInput {
  id: number;
  userId?: number | null;
  bookedOn: string; // "YYYY-MM-DD" or ISO timestamp "YYYY-MM-DDTHH:mm:ss"
  kind: "expense" | "income" | "transfer";
  amountMinor: number; // Signed minor units (e.g. -5400 for expense CHF 54.00, +720000 for salary)
  currency: string;
  account: string;
  merchant: string;
  category: string;
  description: string;
}

export interface EngineOptions {
  referenceDate?: string; // "YYYY-MM-DD"
  typicalMonthlyIncomeMinor?: number; // if known in advance, else inferred from salary/income history
  targetTransactionIds?: number[] | Set<number>; // if provided, only flag anomalies for these transactions
}

/* =========================================================================
   STATISTICAL & UTILITY HELPERS
   ========================================================================= */

export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._\-–—/\\&,+]/g, " ")
    .replace(/\b(ag|sa|gmbh|inc|corp|ltd|llc|bv|coop|supermarkt|online|store)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parsed dates are memoised per transaction object.
 *
 * Several rules compare every transaction against every other one inside a
 * sliding window, so this is called O(n²) times — at 25k transactions that was
 * ~625 million `Date` allocations and roughly 75% of the engine's total
 * runtime. The objects are read-only here (nothing mutates a returned Date),
 * so handing back the same instance is safe, and a WeakMap keeps it from
 * pinning rows in memory after a scan.
 */
const dateCache = new WeakMap<TransactionInput, Date>();

export function parseTransactionDate(t: TransactionInput): Date {
  const cached = dateCache.get(t);
  if (cached) return cached;

  let parsed: Date;
  if (t.bookedOn.includes("T") || t.bookedOn.includes(":")) {
    // Support both YYYY-MM-DD and full ISO strings
    parsed = new Date(t.bookedOn);
  } else {
    const [y, m, d] = t.bookedOn.split("-").map(Number);
    parsed = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  }

  dateCache.set(t, parsed);
  return parsed;
}

export function getDaysDiff(d1: Date, d2: Date): number {
  return Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
}

export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function calculateMAD(values: number[], median?: number): number {
  if (values.length === 0) return 0;
  const med = median !== undefined ? median : calculateMedian(values);
  const deviations = values.map((v) => Math.abs(v - med));
  return calculateMedian(deviations);
}

export function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = calculateMean(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function fitLinearSlope(yValues: number[]): number {
  const n = yValues.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += yValues[i];
    sumXY += i * yValues[i];
    sumXX += i * i;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Calculates user's baseline typical monthly income from recurring salary or general positive inflows.
 */
export function estimateTypicalMonthlyIncome(transactions: TransactionInput[]): number {
  const monthlyIncomes = new Map<string, number>();
  for (const t of transactions) {
    if (t.kind === "income" && t.amountMinor > 0) {
      const month = t.bookedOn.slice(0, 7);
      monthlyIncomes.set(month, (monthlyIncomes.get(month) ?? 0) + t.amountMinor);
    }
  }
  const incomeVals = [...monthlyIncomes.values()];
  if (incomeVals.length === 0) return 0;
  return calculateMedian(incomeVals);
}

/* =========================================================================
   RECURRING PAYMENT PATTERN DETECTOR
   ========================================================================= */

export interface RecurringPattern {
  normalizedMerchant: string;
  merchant: string;
  category: string;
  kind: "expense" | "income" | "transfer";
  account: string;
  medianAmountMinor: number;
  amounts: number[];
  dates: Date[];
  intervalDaysMedian: number;
  transactionIds: number[];
  lastDate: Date;
  isMonthly: boolean;
  isPredictableSubscription: boolean;
}

export function detectRecurringPatterns(
  transactions: TransactionInput[],
  kind: "expense" | "income" = "expense",
): RecurringPattern[] {
  const byMerchant = new Map<string, TransactionInput[]>();

  for (const t of transactions) {
    if (t.kind !== kind) continue;
    const norm = normalizeMerchant(t.merchant);
    if (!norm) continue;
    const list = byMerchant.get(norm) ?? [];
    list.push(t);
    byMerchant.set(norm, list);
  }

  const patterns: RecurringPattern[] = [];

  for (const [norm, group] of byMerchant.entries()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) => parseTransactionDate(a).getTime() - parseTransactionDate(b).getTime(),
    );

    const dates = sorted.map(parseTransactionDate);
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push(getDaysDiff(dates[i - 1], dates[i]));
    }

    const medianInterval = calculateMedian(intervals);
    const intervalMAD = calculateMAD(intervals, medianInterval);

    const isMonthly = medianInterval >= 25 && medianInterval <= 35 && intervalMAD <= 6;
    const isWeekly = medianInterval >= 6 && medianInterval <= 8 && intervalMAD <= 2;
    const isBiWeekly = medianInterval >= 13 && medianInterval <= 16 && intervalMAD <= 3;
    const isQuarterly = medianInterval >= 80 && medianInterval <= 100 && intervalMAD <= 10;

    if (isMonthly || isWeekly || isBiWeekly || isQuarterly) {
      const amounts = sorted.map((t) => Math.abs(t.amountMinor));
      const medianAmount = calculateMedian(amounts);
      const amountMAD = calculateMAD(amounts, medianAmount);
      // Predictable subscription: amounts are tight (amount MAD <= 15% of median)
      const isPredictable =
        medianAmount > 0 && amountMAD / medianAmount <= 0.15;

      patterns.push({
        normalizedMerchant: norm,
        merchant: sorted[sorted.length - 1].merchant,
        category: sorted[sorted.length - 1].category,
        kind,
        account: sorted[sorted.length - 1].account,
        medianAmountMinor: medianAmount,
        amounts,
        dates,
        intervalDaysMedian: medianInterval,
        transactionIds: sorted.map((t) => t.id),
        lastDate: dates[dates.length - 1],
        isMonthly,
        isPredictableSubscription: isPredictable,
      });
    }
  }

  return patterns;
}

/* =========================================================================
   MAIN ANOMALY DETECTION ENGINE
   ========================================================================= */

export function analyzeTransactionAnomalies(
  transactions: TransactionInput[],
  options: EngineOptions = {},
): AnomalyInsight[] {
  if (!transactions || transactions.length === 0) {
    return [];
  }

  // Sort chronologically ascending
  const sorted = [...transactions].sort((a, b) => {
    const da = parseTransactionDate(a).getTime();
    const db = parseTransactionDate(b).getTime();
    return da - db;
  });

  const firstDate = parseTransactionDate(sorted[0]);
  const lastDate = parseTransactionDate(sorted[sorted.length - 1]);
  const totalHistoryDays = Math.max(1, getDaysDiff(firstDate, lastDate));
  const typicalMonthlyIncome =
    options.typicalMonthlyIncomeMinor ?? estimateTypicalMonthlyIncome(sorted);

  const insights: Omit<AnomalyInsight, "emoji" | "kind">[] = [];

  // Groupings by category, merchant, etc.
  const expensesByCategory = new Map<string, TransactionInput[]>();
  const expensesByMerchant = new Map<string, TransactionInput[]>();
  const allByMerchantNorm = new Map<string, TransactionInput[]>();
  const allCategories = new Set<string>();
  const transfers: TransactionInput[] = [];

  for (const t of sorted) {
    const norm = normalizeMerchant(t.merchant);
    const mList = allByMerchantNorm.get(norm) ?? [];
    mList.push(t);
    allByMerchantNorm.set(norm, mList);

    if (t.kind === "expense") {
      allCategories.add(t.category);
      const catList = expensesByCategory.get(t.category) ?? [];
      catList.push(t);
      expensesByCategory.set(t.category, catList);

      const mercList = expensesByMerchant.get(norm) ?? [];
      mercList.push(t);
      expensesByMerchant.set(norm, mercList);
    } else if (t.kind === "transfer") {
      transfers.push(t);
    }
  }

  // Detect recurring patterns
  const recurringExpenses = detectRecurringPatterns(sorted, "expense");
  const predictableRecurringTxIds = new Set<number>();
  for (const pattern of recurringExpenses) {
    if (pattern.isPredictableSubscription && pattern.amounts.length >= 3) {
      for (const id of pattern.transactionIds) {
        predictableRecurringTxIds.add(id);
      }
    }
  }

  // Monthly buckets for spending & savings
  const monthlyExpenses = new Map<string, number>();
  const monthlyIncome = new Map<string, number>();
  const monthlyCategorySpend = new Map<string, Map<string, number>>();
  const monthlyMerchantSpend = new Map<string, Map<string, number>>();
  const monthlyAccountSpend = new Map<string, Map<string, number>>();

  for (const t of sorted) {
    const month = t.bookedOn.slice(0, 7);
    if (t.kind === "expense") {
      const mag = Math.abs(t.amountMinor);
      monthlyExpenses.set(month, (monthlyExpenses.get(month) ?? 0) + mag);

      if (!monthlyCategorySpend.has(month)) monthlyCategorySpend.set(month, new Map());
      const catMap = monthlyCategorySpend.get(month)!;
      catMap.set(t.category, (catMap.get(t.category) ?? 0) + mag);

      const norm = normalizeMerchant(t.merchant);
      if (!monthlyMerchantSpend.has(month)) monthlyMerchantSpend.set(month, new Map());
      const mercMap = monthlyMerchantSpend.get(month)!;
      mercMap.set(norm, (mercMap.get(norm) ?? 0) + mag);

      if (!monthlyAccountSpend.has(month)) monthlyAccountSpend.set(month, new Map());
      const accMap = monthlyAccountSpend.get(month)!;
      const acc = t.account;
      accMap.set(acc, (accMap.get(acc) ?? 0) + mag);
    } else if (t.kind === "income") {
      monthlyIncome.set(month, (monthlyIncome.get(month) ?? 0) + Math.abs(t.amountMinor));
    }
  }

  const allMonths = [...new Set([...monthlyExpenses.keys(), ...monthlyIncome.keys()])].sort();

  /**
   * The largest expenses behind a month-level finding.
   *
   * The rules that describe a whole month rather than a transaction used to
   * report no transaction ids at all. That is not a harmless omission: findings
   * are stored one row per (finding, transaction) pair, so every one of them was
   * computed and then silently dropped on the way to the database — 23 of 98 on
   * a year of real statements. Naming the biggest contributors both keeps the
   * finding alive and answers the reader's first question, which is "driven by
   * what?".
   */
  const representativeIds = (
    month: string,
    match: (t: TransactionInput) => boolean,
    limit = 3,
  ): number[] =>
    sorted
      .filter((t) => t.kind === "expense" && t.bookedOn.slice(0, 7) === month && match(t))
      .sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor))
      .slice(0, limit)
      .map((t) => t.id);

  /* -------------------------------------------------------------------------
     RULE 1: AMOUNT_SPIKE
     Icon: lucide:arrow-up
     Trigger when amount > median + 3 * MAD (>= 5 historical comparable transactions)
     Require substantial absolute and proportional deviation (>= 50% above median).
     ------------------------------------------------------------------------- */
  const baselineStatsCache = new Map<string, { median: number; mad: number }>();

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (t.kind !== "expense") continue;
    // Skip predictable recurring baseline expenses like monthly rent
    if (predictableRecurringTxIds.has(t.id)) continue;

    const mag = Math.abs(t.amountMinor);
    const norm = normalizeMerchant(t.merchant);

    /*
     * The merchant's own history, or nothing. This used to fall back to the
     * category when a merchant had fewer than five expenses, which sounds
     * harmless and is not: 43 of the 61 merchants in a year of real statements
     * are below that line, and a category is not a comparable population. It
     * put a CHF 210 power bill next to a CHF 19.90 phone bill (both "Utilities
     * & Telecom") and called it a spike three times over; likewise a CHF 1501
     * annual travel pass against single SBB tickets, and restaurant dinners
     * against canteen lunches.
     *
     * Gating the fallback on how tight the category looks does not rescue it —
     * it makes it worse. "Food & Drink" is 121 canteen lunches out of 128 rows,
     * so it scores as extremely homogeneous while being plainly bimodal, and a
     * homogeneity test would hand the fallback its highest confidence exactly
     * where it is most wrong.
     *
     * Sparse merchants are not left unwatched: UNUSUALLY_LARGE_TRANSACTION and
     * UNUSUAL_FINANCIAL_IMPACT are percentile-based over the whole ledger and
     * need no merchant history, which is what catches a first-ever CHF 6000
     * purchase.
     */
    const baselineGroup = expensesByMerchant.get(norm) ?? [];
    const baselineType = "merchant";

    if (baselineGroup.length >= 5) {
      /*
       * Memoised per group, not per transaction. The baseline is the merchant's
       * (or category's) whole history, so its median and MAD are identical for
       * every transaction in that group — but this loop used to rebuild the
       * amount array and sort it three times for each of n transactions, which
       * made the rule O(n · g log g) and the single largest cost in the engine
       * at scale. There are far fewer groups than transactions.
       */
      const baselineKey = `${baselineType}:${baselineType === "merchant" ? norm : t.category}`;
      let stats = baselineStatsCache.get(baselineKey);
      if (!stats) {
        const amounts = baselineGroup.map((b) => Math.abs(b.amountMinor));
        const m = calculateMedian(amounts);
        stats = { median: m, mad: calculateMAD(amounts, m) };
        baselineStatsCache.set(baselineKey, stats);
      }
      const median = stats.median;
      const rawMAD = stats.mad;

      // Proportional noise floor: MAD is at least 25% of median or CHF 20.00 (2000 minor)
      const effectiveMAD = Math.max(rawMAD, median * 0.25, 2000);

      if (mag > median + 3 * effectiveMAD && mag >= median * 1.5) {
        const madDeviation = (mag - median) / effectiveMAD;
        const severity: AnomalySeverity = madDeviation > 5 ? "high" : "medium";
        insights.push({
          rule_id: "AMOUNT_SPIKE",
          title: "Unusual Expense Amount Spike",
          description: `Transaction amount (${(mag / 100).toFixed(2)} ${t.currency}) exceeds the ${baselineType} baseline median (${(median / 100).toFixed(2)}) by ${madDeviation.toFixed(1)}x MAD.`,
          params: {
            amount: formatMoney(mag, t.currency),
            median: formatMoney(Math.round(median), t.currency),
            mad: madDeviation.toFixed(1),
          },
          severity,
          transaction_ids: [t.id],
          supporting_metrics: {
            amount_minor: mag,
            baseline_type: baselineType,
            baseline_sample_size: baselineGroup.length,
            median_minor: Math.round(median),
            mad_minor: Math.round(effectiveMAD),
            mad_deviation: Number(madDeviation.toFixed(2)),
          },
          icon: "lucide:arrow-up",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 2: UNUSUALLY_LARGE_TRANSACTION
     Icon: lucide:circle-dollar-sign
     Trigger when non-recurring expense amount >= 99th percentile AND exceeds baseline.
     ------------------------------------------------------------------------- */
  const nonRecurringExpenseMags = sorted
    .filter((t) => t.kind === "expense" && !predictableRecurringTxIds.has(t.id))
    .map((t) => Math.abs(t.amountMinor));

  if (nonRecurringExpenseMags.length >= 20) {
    const p99 = calculatePercentile(nonRecurringExpenseMags, 99);
    // Hoisted: this is loop-invariant, and calculateMedian copies and sorts the
    // whole array every call. Left inside the loop it made this rule
    // O(n² log n) — the dominant cost in the engine once date parsing was
    // memoised.
    const nonRecurringMedian = calculateMedian(nonRecurringExpenseMags);
    for (const t of sorted) {
      if (t.kind !== "expense" || predictableRecurringTxIds.has(t.id)) continue;
      const mag = Math.abs(t.amountMinor);
      const isP99 = mag >= p99;
      const isIncomePct = typicalMonthlyIncome > 0 && mag > 0.2 * typicalMonthlyIncome;

      if (isP99 || (isIncomePct && mag > nonRecurringMedian * 3)) {
        const severity: AnomalySeverity = isP99 && isIncomePct ? "high" : "medium";
        insights.push({
          rule_id: "UNUSUALLY_LARGE_TRANSACTION",
          title: "Unusually Large Outflow",
          description: `Transaction amount (${(mag / 100).toFixed(2)} ${t.currency}) ranks among the largest transactions in history.`,
          params: {
            amount: formatMoney(mag, t.currency),
          },
          severity,
          transaction_ids: [t.id],
          supporting_metrics: {
            amount_minor: mag,
            p99_threshold_minor: Math.round(p99),
            typical_monthly_income_minor: typicalMonthlyIncome,
            income_ratio:
              typicalMonthlyIncome > 0
                ? Number((mag / typicalMonthlyIncome).toFixed(3))
                : 0,
            is_99th_percentile: isP99,
            exceeds_20pct_income: isIncomePct,
          },
          icon: "lucide:circle-dollar-sign",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 3: NEW_MERCHANT
     Icon: lucide:store
     Trigger when a merchant never appeared before in history (>= 60 days baseline established,
     and only for transactions in the latest evaluation period), AND the amount
     is significant for this account — at or above the 75th percentile of
     non-recurring expenses. Without the amount gate, an account that simply
     eats somewhere new twice a week drowns the ledger: the shipped Revolut
     statement alone produced 136 first-time-merchant findings, one per
     CHF 15 lunch. "First time somewhere" is only worth a line when the money
     involved would itself make a person look twice.
     ------------------------------------------------------------------------- */
  if (totalHistoryDays >= 60) {
    const baselineCutoffDays = totalHistoryDays * 0.7; // Establish 70% history as catalog baseline
    const seenMerchants = new Set<string>();
    const significantMinor = calculatePercentile(nonRecurringExpenseMags, 75);

    for (const t of sorted) {
      const curDate = parseTransactionDate(t);
      const daysSinceStart = getDaysDiff(firstDate, curDate);
      const norm = normalizeMerchant(t.merchant);

      if (daysSinceStart < baselineCutoffDays) {
        if (norm) seenMerchants.add(norm);
      } else {
        // A first-time merchant below the amount gate is still *seen* — its
        // second visit must not fire either, so the add below stays
        // unconditional for every merchant in the evaluation window.
        const significant = Math.abs(t.amountMinor) >= significantMinor;
        if (norm && !seenMerchants.has(norm) && seenMerchants.size >= 15 && significant) {
          insights.push({
            rule_id: "NEW_MERCHANT",
            title: "First-Time Merchant",
            description: `Transaction with previously unseen merchant "${t.merchant}" after ${Math.round(daysSinceStart)} days of history.`,
            params: {
              merchant: t.merchant,
              days: Math.round(daysSinceStart),
            },
            severity: "low",
            transaction_ids: [t.id],
            supporting_metrics: {
              merchant: t.merchant,
              normalized_merchant: norm,
              days_of_history: Math.round(daysSinceStart),
              unique_merchants_seen_prior: seenMerchants.size,
            },
            icon: "lucide:store",
          });
        }
        // Marks the merchant known whether or not it fired, so neither a
        // second visit nor a later, larger charge re-triggers the rule.
        if (norm) seenMerchants.add(norm);
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 4: NEW_CATEGORY
     Icon: lucide:tag
     Trigger when category has not previously been used (>= 60 days history).
     ------------------------------------------------------------------------- */
  if (totalHistoryDays >= 60) {
    const seenCategories = new Set<string>();
    const baselineCutoffDays = totalHistoryDays * 0.5;

    for (const t of sorted) {
      const curDate = parseTransactionDate(t);
      const daysSinceStart = getDaysDiff(firstDate, curDate);

      if (daysSinceStart < baselineCutoffDays) {
        seenCategories.add(t.category);
      } else {
        if (!seenCategories.has(t.category) && seenCategories.size >= 5) {
          insights.push({
            rule_id: "NEW_CATEGORY",
            title: "New Spending Category",
            description: `First recorded transaction in category "${t.category}" after ${Math.round(daysSinceStart)} days of history.`,
            params: {
              category: t.category,
              days: Math.round(daysSinceStart),
            },
            severity: "low",
            transaction_ids: [t.id],
            supporting_metrics: {
              category: t.category,
              days_of_history: Math.round(daysSinceStart),
              prior_categories_count: seenCategories.size,
            },
            icon: "lucide:tag",
          });
          seenCategories.add(t.category);
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 5: FREQUENCY_SPIKE
     Icon: lucide:repeat-2
     Trigger when 7d or 30d transaction count >= 2x baseline AND absolute >= 3.
     ------------------------------------------------------------------------- */
  if (totalHistoryDays >= 30) {
    for (const group of allByMerchantNorm.values()) {
      if (group.length < 6) continue;
      const merchantHistoryDays = Math.max(
        1,
        getDaysDiff(parseTransactionDate(group[0]), parseTransactionDate(group[group.length - 1])),
      );
      if (merchantHistoryDays < 21) continue;

      const weeklyBaseline = (group.length / merchantHistoryDays) * 7;
      if (weeklyBaseline <= 0.2) continue;

      // Scan 7-day windows
      for (let i = 0; i < group.length; i++) {
        const winEnd = parseTransactionDate(group[i]);
        const inWindow = group.filter((g) => {
          const gd = parseTransactionDate(g);
          const diff = (winEnd.getTime() - gd.getTime()) / (1000 * 60 * 60 * 24);
          return diff >= 0 && diff <= 7;
        });

        const count = inWindow.length;
        if (count >= weeklyBaseline * 2 && count - weeklyBaseline >= 4) {
          const ratio = weeklyBaseline > 0 ? count / weeklyBaseline : count;
          const severity: AnomalySeverity = ratio >= 4 ? "high" : "medium";
          insights.push({
            rule_id: "FREQUENCY_SPIKE",
            title: "Transaction Frequency Spike",
            description: `Merchant "${group[0].merchant}" had ${count} transactions within 7 days (${ratio.toFixed(1)}x baseline of ${weeklyBaseline.toFixed(1)}/week).`,
            params: {
              merchant: group[0].merchant,
              count,
              factor: ratio.toFixed(1),
              baseline: weeklyBaseline.toFixed(1),
            },
            severity,
            transaction_ids: inWindow.map((w) => w.id),
            supporting_metrics: {
              merchant: group[0].merchant,
              window_days: 7,
              observed_count: count,
              baseline_weekly_count: Number(weeklyBaseline.toFixed(2)),
              increase_factor: Number(ratio.toFixed(2)),
              absolute_increase: Number((count - weeklyBaseline).toFixed(1)),
            },
            icon: "lucide:repeat-2",
          });
          break;
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 6: CATEGORY_SPENDING_SPIKE
     Icon: lucide:chart-no-axes-combined
     Compare current month vs median of previous months.
     Trigger when increase >= 30% AND absolute increase >= 5% monthly income.
     ------------------------------------------------------------------------- */
  if (allMonths.length >= 3) {
    for (let mIdx = 2; mIdx < allMonths.length; mIdx++) {
      const month = allMonths[mIdx];
      const priorMonths = allMonths.slice(0, mIdx);
      const catMap = monthlyCategorySpend.get(month);
      if (!catMap) continue;

      for (const [cat, currentSpend] of catMap.entries()) {
        const priorSpends = priorMonths.map((pm) => monthlyCategorySpend.get(pm)?.get(cat) ?? 0);
        const nonZeroPrior = priorSpends.filter((s) => s > 0);
        if (nonZeroPrior.length < 2) continue;

        const medianSpend = calculateMedian(nonZeroPrior);
        if (medianSpend <= 0) continue;

        const growth = (currentSpend - medianSpend) / medianSpend;
        const absDiff = currentSpend - medianSpend;
        const incomeThreshold = typicalMonthlyIncome > 0 ? 0.05 * typicalMonthlyIncome : 50000;

        if (growth >= 0.3 && absDiff >= incomeThreshold) {
          const severity: AnomalySeverity = growth >= 0.75 ? "high" : "medium";
          // Only tag the top 1-2 driving transactions in that category to avoid mass tagging
          const txInMonth = sorted
            .filter((t) => t.category === cat && t.bookedOn.startsWith(month))
            .sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor))
            .slice(0, 1)
            .map((t) => t.id);

          insights.push({
            rule_id: "CATEGORY_SPENDING_SPIKE",
            title: "Category Spending Surge",
            description: `Spending in "${cat}" reached ${(currentSpend / 100).toFixed(2)} in ${month}, up +${(growth * 100).toFixed(0)}% above baseline median.`,
            params: {
              category: cat,
              amount: formatMoney(currentSpend),
              month,
              growth: (growth * 100).toFixed(0),
            },
            severity,
            transaction_ids: txInMonth,
            supporting_metrics: {
              category: cat,
              month,
              current_spend_minor: currentSpend,
              baseline_median_minor: Math.round(medianSpend),
              growth_percentage: Number((growth * 100).toFixed(1)),
              absolute_increase_minor: absDiff,
            },
            icon: "lucide:chart-no-axes-combined",
          });
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 7: NEW_RECURRING_PAYMENT
     Icon: lucide:calendar-plus
     Trigger when predictable regular charges appear (subscriptions, memberships).
     ------------------------------------------------------------------------- */
  for (const pattern of recurringExpenses) {
    if (!pattern.isPredictableSubscription) continue;
    const firstTxDate = pattern.dates[0];
    const daysFromHistoryStart = getDaysDiff(firstDate, firstTxDate);

    if (daysFromHistoryStart >= 30 && pattern.amounts.length >= 2 && pattern.amounts.length <= 4) {
      insights.push({
        rule_id: "NEW_RECURRING_PAYMENT",
        title: "New Recurring Subscription/Payment",
        description: `Detected new regular recurring payment from "${pattern.merchant}" (~${(pattern.medianAmountMinor / 100).toFixed(2)} every ${Math.round(pattern.intervalDaysMedian)} days).`,
        params: {
          merchant: pattern.merchant,
          amount: formatMoney(Math.round(pattern.medianAmountMinor)),
          days: Math.round(pattern.intervalDaysMedian),
        },
        severity: "medium",
        transaction_ids: pattern.transactionIds,
        supporting_metrics: {
          merchant: pattern.merchant,
          interval_days: Math.round(pattern.intervalDaysMedian),
          amount_minor: Math.round(pattern.medianAmountMinor),
          occurrences: pattern.amounts.length,
        },
        icon: "lucide:calendar-plus",
      });
    }
  }

  /* -------------------------------------------------------------------------
     RULE 8: RECURRING_PAYMENT_CHANGE
     Icon: lucide:refresh-cw
     Trigger when established recurring subscription changes amount >= 10% AND >= CHF 2.
     ------------------------------------------------------------------------- */
  for (const pattern of recurringExpenses) {
    if (pattern.isPredictableSubscription && pattern.amounts.length >= 3) {
      const historicalAmounts = pattern.amounts.slice(0, -1);
      const baselineAmount = calculateMedian(historicalAmounts);
      const latestAmount = pattern.amounts[pattern.amounts.length - 1];
      const diff = Math.abs(latestAmount - baselineAmount);
      const pctChange = baselineAmount > 0 ? diff / baselineAmount : 0;

      if (pctChange >= 0.1 && diff >= 200) {
        const severity: AnomalySeverity =
          pctChange > 0.5 ? "high" : pctChange >= 0.2 ? "medium" : "low";
        const latestTxId = pattern.transactionIds[pattern.transactionIds.length - 1];

        insights.push({
          rule_id: "RECURRING_PAYMENT_CHANGE",
          title: "Recurring Payment Price Change",
          description: `Recurring payment for "${pattern.merchant}" changed from ${(baselineAmount / 100).toFixed(2)} to ${(latestAmount / 100).toFixed(2)} (${(pctChange * 100).toFixed(1)}% change).`,
          params: {
            merchant: pattern.merchant,
            from: formatMoney(Math.round(baselineAmount)),
            to: formatMoney(latestAmount),
            change: (pctChange * 100).toFixed(1),
          },
          severity,
          transaction_ids: [latestTxId],
          supporting_metrics: {
            merchant: pattern.merchant,
            baseline_amount_minor: Math.round(baselineAmount),
            new_amount_minor: latestAmount,
            change_percentage: Number((pctChange * 100).toFixed(1)),
            absolute_change_minor: diff,
          },
          icon: "lucide:refresh-cw",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 9: RECURRING_PAYMENT_DISAPPEARANCE
     Icon: lucide:calendar-x
     Trigger when established payment is overdue by >= 1.5 expected intervals.
     ------------------------------------------------------------------------- */
  const refDate = options.referenceDate ? new Date(options.referenceDate) : lastDate;
  for (const pattern of recurringExpenses) {
    if (pattern.isPredictableSubscription && pattern.amounts.length >= 3) {
      const daysSinceLast = getDaysDiff(pattern.lastDate, refDate);
      if (daysSinceLast >= pattern.intervalDaysMedian * 1.5) {
        insights.push({
          rule_id: "RECURRING_PAYMENT_DISAPPEARANCE",
          title: "Expected Recurring Payment Missing",
          description: `Established recurring payment for "${pattern.merchant}" is overdue (expected every ~${Math.round(pattern.intervalDaysMedian)} days, last seen ${Math.round(daysSinceLast)} days ago).`,
          params: {
            merchant: pattern.merchant,
            interval: Math.round(pattern.intervalDaysMedian),
            days: Math.round(daysSinceLast),
          },
          severity: "low",
          transaction_ids: pattern.transactionIds.slice(-2),
          supporting_metrics: {
            merchant: pattern.merchant,
            expected_interval_days: Math.round(pattern.intervalDaysMedian),
            days_since_last: Math.round(daysSinceLast),
            overdue_factor: Number((daysSinceLast / pattern.intervalDaysMedian).toFixed(2)),
          },
          icon: "lucide:calendar-x",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 11: UNUSUAL_DAY
     Icon: lucide:calendar-clock
     Trigger only for strict merchant/category weekday patterns (>= 25 samples, 0 historical on this day).
     ------------------------------------------------------------------------- */
  for (const group of expensesByMerchant.values()) {
    if (group.length >= 25) {
      const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
      for (const g of group) {
        weekdayCounts[parseTransactionDate(g).getUTCDay()]++;
      }
      for (const t of group) {
        const day = parseTransactionDate(t).getUTCDay();
        if (weekdayCounts[day] === 1) {
          const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          insights.push({
            rule_id: "UNUSUAL_DAY",
            title: "Unusual Day of Week for Merchant",
            description: `Transaction with "${group[0].merchant}" occurred on a ${dayNames[day]} (no other transaction occurred on this day across ${group.length} visits).`,
            params: {
              merchant: group[0].merchant,
              weekday: day,
              visits: group.length,
            },
            severity: "low",
            transaction_ids: [t.id],
            supporting_metrics: {
              merchant: group[0].merchant,
              weekday: dayNames[day],
              total_merchant_txs: group.length,
            },
            icon: "lucide:calendar-clock",
          });
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 12: REPEAT_CHARGE
     Icon: lucide:copy
     The same merchant billing the same amount more than once on one day.

     This replaces a duplicate-detection rule that required two charges within
     five minutes of each other. Statements do not carry a time of day — every
     row is anchored to noon — so that rule could never fire on real data, while
     the plainest anomaly in a year of statements went unnamed: an airline
     charging CHF 1'766.50 four times over on a single day.

     Import artefacts are already gone by the time rows reach here. The importer
     dedupes on a natural key (`scripts/lib/statement.ts`), which is what stops
     the credit-card payments listed in both account exports from counting
     twice, so a same-day repeat that survives is a genuinely separate charge.
     ------------------------------------------------------------------------- */
  {
    type RepeatGroup = { rows: TransactionInput[]; merchant: string; day: string };
    const repeats = new Map<string, RepeatGroup>();
    /** Days this merchant was active at all, to judge whether repeats are its norm. */
    const activeDays = new Map<string, Set<string>>();
    const repeatDays = new Map<string, Set<string>>();

    for (const t of sorted) {
      if (t.kind !== "expense") continue;
      const norm = normalizeMerchant(t.merchant);
      const days = activeDays.get(norm) ?? new Set<string>();
      days.add(t.bookedOn);
      activeDays.set(norm, days);

      const key = `${t.bookedOn}|${norm}|${t.amountMinor}`;
      const group = repeats.get(key) ?? { rows: [], merchant: t.merchant, day: t.bookedOn };
      group.rows.push(t);
      repeats.set(key, group);
    }

    for (const [key, group] of repeats.entries()) {
      if (group.rows.length < 2) continue;
      const norm = key.split("|")[1];
      const days = repeatDays.get(norm) ?? new Set<string>();
      days.add(group.day);
      repeatDays.set(norm, days);
    }

    for (const [key, group] of repeats.entries()) {
      const count = group.rows.length;
      if (count < 2) continue;

      const mag = Math.abs(group.rows[0].amountMinor);
      // Two identical coffees are not a finding.
      if (mag < 2000) continue;
      // A subscription billed on a schedule is already explained elsewhere.
      if (group.rows.some((r) => predictableRecurringTxIds.has(r.id))) continue;

      /*
       * Some merchants split every purchase into several equal lines, and that
       * billing style should not read as an anomaly every time. But the test
       * has to be conservative in both directions: an airline appears on four
       * days all year and books repeats on three of them, which by ratio alone
       * looks like a habit and would have buried the very charge this rule
       * exists to surface — the same CHF 1'766.50 taken four times over. So
       * judge the habit only from a merchant seen across enough days, and never
       * let it explain away a third identical charge.
       */
      const norm = key.split("|")[1];
      const active = activeDays.get(norm)?.size ?? 1;
      const repeated = repeatDays.get(norm)?.size ?? 0;
      if (count < 3 && active >= 8 && repeated / active > 0.25) continue;

      const severity: AnomalySeverity = count >= 3 ? "high" : "medium";
      insights.push({
        rule_id: "REPEAT_CHARGE",
        title: "Charged the same amount more than once",
        description: `${group.merchant} charged ${formatMoney(mag, group.rows[0].currency)} ${count} times on ${formatDay(group.day)}, totalling ${formatMoney(mag * count, group.rows[0].currency)}.`,
        params: {
          merchant: group.merchant,
          amount: formatMoney(mag, group.rows[0].currency),
          count,
          day: group.day,
          total: formatMoney(mag * count, group.rows[0].currency),
        },
        severity,
        transaction_ids: group.rows.map((r) => r.id),
        supporting_metrics: {
          charge_count: count,
          amount_minor: mag,
          total_minor: mag * count,
          merchant_active_days: active,
          merchant_repeat_days: repeated,
        },
        icon: "lucide:copy",
      });
    }
  }

  /* -------------------------------------------------------------------------
     RULE 16: NEW_COUNTERPARTY
     Icon: lucide:user-plus
     ------------------------------------------------------------------------- */
  if (totalHistoryDays >= 60 && transfers.length >= 4) {
    const seenCounterparties = new Set<string>();
    const baselineCutoff = transfers.length * 0.6;
    for (let i = 0; i < transfers.length; i++) {
      const t = transfers[i];
      const norm = normalizeMerchant(t.merchant);

      if (i < baselineCutoff) {
        seenCounterparties.add(norm);
      } else {
        if (!seenCounterparties.has(norm) && seenCounterparties.size >= 3) {
          insights.push({
            rule_id: "NEW_COUNTERPARTY",
            title: "New Transfer Counterparty",
            description: `Transfer to previously unseen recipient "${t.merchant}".`,
            params: {
              counterparty: t.merchant,
            },
            severity: "low",
            transaction_ids: [t.id],
            supporting_metrics: {
              counterparty: t.merchant,
              amount_minor: Math.abs(t.amountMinor),
              unique_prior_recipients: seenCounterparties.size,
            },
            icon: "lucide:user-plus",
          });
          seenCounterparties.add(norm);
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 17: LARGE_TRANSFER
     Icon: lucide:arrow-left-right
     ------------------------------------------------------------------------- */
  if (transfers.length >= 5) {
    const transferMags = transfers.map((t) => Math.abs(t.amountMinor));
    const medianTransfer = calculateMedian(transferMags);
    const madTransfer = calculateMAD(transferMags, medianTransfer);
    const effectiveMAD = Math.max(madTransfer, medianTransfer * 0.25, 2000);

    for (const t of transfers) {
      const mag = Math.abs(t.amountMinor);
      const madDev = (mag - medianTransfer) / effectiveMAD;
      const isIncomePct = typicalMonthlyIncome > 0 && mag > 0.1 * typicalMonthlyIncome;

      if ((madDev > 3 || isIncomePct) && mag > medianTransfer * 2) {
        const severity: AnomalySeverity = madDev > 5 || isIncomePct ? "high" : "medium";
        insights.push({
          rule_id: "LARGE_TRANSFER",
          title: "Unusually Large Account Transfer",
          description: `Transfer of ${(mag / 100).toFixed(2)} ${t.currency} is significantly above historical transfer baseline.`,
          params: {
            amount: formatMoney(mag, t.currency),
          },
          severity,
          transaction_ids: [t.id],
          supporting_metrics: {
            transfer_amount_minor: mag,
            median_transfer_minor: Math.round(medianTransfer),
            mad_deviation: Number(madDev.toFixed(2)),
            income_share_percentage:
              typicalMonthlyIncome > 0
                ? Number(((mag / typicalMonthlyIncome) * 100).toFixed(1))
                : 0,
          },
          icon: "lucide:arrow-left-right",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 18: INCOME_DEVIATION
     Icon: lucide:wallet
     ------------------------------------------------------------------------- */
  const recurringIncome = detectRecurringPatterns(sorted, "income");
  for (const pattern of recurringIncome) {
    if (pattern.amounts.length >= 3) {
      const historicalAmounts = pattern.amounts.slice(0, -1);
      const baseline = calculateMedian(historicalAmounts);
      const latest = pattern.amounts[pattern.amounts.length - 1];
      const diff = Math.abs(latest - baseline);
      const pct = baseline > 0 ? diff / baseline : 0;

      if (pct >= 0.15) {
        const severity: AnomalySeverity = pct >= 0.3 ? "high" : "medium";
        const latestTxId = pattern.transactionIds[pattern.transactionIds.length - 1];
        insights.push({
          rule_id: "INCOME_DEVIATION",
          title: "Salary / Income Deviation",
          description: `Recurring income payment of ${(latest / 100).toFixed(2)} deviated by ${(pct * 100).toFixed(1)}% from baseline median (${(baseline / 100).toFixed(2)}).`,
          params: {
            amount: formatMoney(latest),
            deviation: (pct * 100).toFixed(1),
            baseline: formatMoney(Math.round(baseline)),
          },
          severity,
          transaction_ids: [latestTxId],
          supporting_metrics: {
            income_source: pattern.merchant,
            baseline_income_minor: Math.round(baseline),
            received_income_minor: latest,
            deviation_percentage: Number((pct * 100).toFixed(1)),
          },
          icon: "lucide:wallet",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 19: MISSING_EXPECTED_INCOME
     Icon: lucide:wallet-cards
     ------------------------------------------------------------------------- */
  for (const pattern of recurringIncome) {
    if (pattern.isMonthly && pattern.amounts.length >= 3) {
      const daysSinceLast = getDaysDiff(pattern.lastDate, refDate);
      if (daysSinceLast >= pattern.intervalDaysMedian + 3) {
        insights.push({
          rule_id: "MISSING_EXPECTED_INCOME",
          title: "Expected Salary Inflow Delayed",
          description: `Expected monthly income from "${pattern.merchant}" is overdue by ${Math.round(daysSinceLast - pattern.intervalDaysMedian)} days.`,
          params: {
            merchant: pattern.merchant,
            days: Math.round(daysSinceLast - pattern.intervalDaysMedian),
          },
          severity: "high",
          transaction_ids: pattern.transactionIds.slice(-1),
          supporting_metrics: {
            income_source: pattern.merchant,
            expected_interval_days: Math.round(pattern.intervalDaysMedian),
            days_overdue: Math.round(daysSinceLast - pattern.intervalDaysMedian),
            baseline_monthly_amount_minor: Math.round(pattern.medianAmountMinor),
          },
          icon: "lucide:wallet-cards",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 20: BALANCE_DROP (Macro Metric)
     Icon: lucide:trending-down
     ------------------------------------------------------------------------- */
  if (sorted.length >= 20) {
    const rollingDrops: { date: string; dropMinor: number; topTxId: number }[] = [];
    /*
     * A sliding window, not a re-scan. `sorted` is chronologically ascending,
     * so the 7-day window's start only ever moves forward — advancing a `left`
     * cursor visits each transaction once across the whole loop (O(n)) where
     * the previous `sorted.filter(...)` per iteration was O(n²). At 25k rows
     * that was the single biggest cost in the engine.
     *
     * The largest expense still needs a pass over the live window, because a
     * running maximum cannot be undone when the element leaving the window was
     * the maximum. That inner pass is bounded by the window's own size (a
     * week's worth of transactions), not by the total.
     */
    const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const times = sorted.map((t) => parseTransactionDate(t).getTime());
    let left = 0;
    let right = -1;
    for (let i = 0; i < sorted.length; i++) {
      const curMs = times[i];
      while (times[left] < curMs - WINDOW_MS) left++;
      // `right` must cover every transaction sharing this timestamp, not stop
      // at `i`. Date-only rows all land on the same instant, and the scan this
      // replaces matched them by time rather than by position — stopping at `i`
      // would silently shrink the window for tied rows. Both cursors only move
      // forward, so the whole loop stays O(n).
      if (right < i) right = i;
      while (right + 1 < sorted.length && times[right + 1] <= curMs) right++;

      let netOutflow = 0;
      let largestExpense: TransactionInput | null = null;
      for (let w_i = left; w_i <= right; w_i++) {
        const w = sorted[w_i];
        if (w.kind === "expense") {
          netOutflow += Math.abs(w.amountMinor);
          if (!largestExpense || Math.abs(w.amountMinor) > Math.abs(largestExpense.amountMinor)) {
            largestExpense = w;
          }
        } else if (w.kind === "income") {
          netOutflow -= Math.abs(w.amountMinor);
        }
      }

      if (netOutflow > 0 && largestExpense && !predictableRecurringTxIds.has(largestExpense.id)) {
        rollingDrops.push({
          date: sorted[i].bookedOn,
          dropMinor: netOutflow,
          topTxId: largestExpense.id,
        });
      }
    }

    if (rollingDrops.length >= 5) {
      const dropVals = rollingDrops.map((d) => d.dropMinor);
      const meanDrop = calculateMean(dropVals);
      const stdDevDrop = calculateStdDev(dropVals);

      for (const d of rollingDrops) {
        const isStdDev = stdDevDrop > 0 && d.dropMinor > meanDrop + 3 * stdDevDrop;
        const incomePct = typicalMonthlyIncome > 0 ? d.dropMinor / typicalMonthlyIncome : 0;

        if (isStdDev && incomePct >= 0.2) {
          const severity: AnomalySeverity = "high";
          insights.push({
            rule_id: "BALANCE_DROP",
            title: "Substantial Balance Drawdown",
            description: `Significant net outflow of ${(d.dropMinor / 100).toFixed(2)} within a 7-day window.`,
            params: {
              amount: formatMoney(d.dropMinor),
            },
            severity,
            transaction_ids: [d.topTxId],
            supporting_metrics: {
              drawdown_minor: d.dropMinor,
              mean_weekly_drawdown_minor: Math.round(meanDrop),
              income_ratio: Number((incomePct * 100).toFixed(1)),
            },
            icon: "lucide:trending-down",
          });
          break;
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 21: SAVINGS_RATE_CHANGE (Macro Metric)
     Icon: lucide:piggy-bank
     ------------------------------------------------------------------------- */
  if (allMonths.length >= 4) {
    const monthlySavingsRates = new Map<string, number>();
    for (const m of allMonths) {
      const inc = monthlyIncome.get(m) ?? 0;
      const exp = monthlyExpenses.get(m) ?? 0;
      if (inc > 0) {
        monthlySavingsRates.set(m, (inc - exp) / inc);
      }
    }

    for (let mIdx = 3; mIdx < allMonths.length; mIdx++) {
      const curMonth = allMonths[mIdx];
      const curRate = monthlySavingsRates.get(curMonth);
      if (curRate === undefined) continue;

      const baselineMonths = allMonths.slice(Math.max(0, mIdx - 6), mIdx);
      const baselineRates = baselineMonths
        .map((m) => monthlySavingsRates.get(m))
        .filter((r): r is number => r !== undefined);

      if (baselineRates.length >= 3) {
        const baselineMedian = calculateMedian(baselineRates);
        const ppDiff = Math.abs(curRate - baselineMedian) * 100;

        if (ppDiff >= 15) {
          const severity: AnomalySeverity = ppDiff >= 25 ? "high" : "medium";
          insights.push({
            rule_id: "SAVINGS_RATE_CHANGE",
            title: "Savings Rate Shift",
            description: `Monthly savings rate shifted from ${(baselineMedian * 100).toFixed(1)}% to ${(curRate * 100).toFixed(1)}% (${ppDiff.toFixed(1)} percentage point shift).`,
            params: {
              from: (baselineMedian * 100).toFixed(1),
              to: (curRate * 100).toFixed(1),
              shift: ppDiff.toFixed(1),
            },
            severity,
            transaction_ids: representativeIds(curMonth, () => true),
            supporting_metrics: {
              month: curMonth,
              current_savings_rate: Number((curRate * 100).toFixed(1)),
              baseline_savings_rate: Number((baselineMedian * 100).toFixed(1)),
              percentage_point_difference: Number(ppDiff.toFixed(1)),
            },
            icon: "lucide:piggy-bank",
          });
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 22: CATEGORY_SHIFT (Macro Metric)
     Icon: lucide:arrow-left-right
     ------------------------------------------------------------------------- */
  if (allMonths.length >= 4) {
    for (let mIdx = 3; mIdx < allMonths.length; mIdx++) {
      const curMonth = allMonths[mIdx];
      const totalExp = monthlyExpenses.get(curMonth) ?? 0;
      if (totalExp <= 0) continue;

      const curCatMap = monthlyCategorySpend.get(curMonth);
      if (!curCatMap) continue;

      const priorMonths = allMonths.slice(0, mIdx);

      for (const [cat, spend] of curCatMap.entries()) {
        const curShare = (spend / totalExp) * 100;
        const priorShares = priorMonths.map((pm) => {
          const pExp = monthlyExpenses.get(pm) ?? 0;
          if (pExp <= 0) return 0;
          const pSpend = monthlyCategorySpend.get(pm)?.get(cat) ?? 0;
          return (pSpend / pExp) * 100;
        });

        const baselineShareMedian = calculateMedian(priorShares);
        const ppDiff = Math.abs(curShare - baselineShareMedian);

        if (ppDiff >= 15 && curShare >= 20) {
          insights.push({
            rule_id: "CATEGORY_SHIFT",
            title: "Category Share Composition Shift",
            description: `"${cat}" represented ${curShare.toFixed(1)}% of total monthly spend in ${curMonth} (baseline median was ${baselineShareMedian.toFixed(1)}%).`,
            params: {
              category: cat,
              share: curShare.toFixed(1),
              month: curMonth,
              baseline: baselineShareMedian.toFixed(1),
            },
            severity: "medium",
            transaction_ids: representativeIds(curMonth, (t) => t.category === cat),
            supporting_metrics: {
              category: cat,
              month: curMonth,
              current_share_pct: Number(curShare.toFixed(1)),
              baseline_share_pct: Number(baselineShareMedian.toFixed(1)),
              percentage_point_shift: Number(ppDiff.toFixed(1)),
            },
            icon: "lucide:arrow-left-right",
          });
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 23: MERCHANT_CONCENTRATION
     Icon: lucide:target
     ------------------------------------------------------------------------- */
  if (allMonths.length >= 4) {
    for (let mIdx = 3; mIdx < allMonths.length; mIdx++) {
      const curMonth = allMonths[mIdx];
      const totalExp = monthlyExpenses.get(curMonth) ?? 0;
      if (totalExp <= 0) continue;

      const curMercMap = monthlyMerchantSpend.get(curMonth);
      if (!curMercMap) continue;

      const priorMonths = allMonths.slice(0, mIdx);

      for (const [norm, spend] of curMercMap.entries()) {
        const curShare = (spend / totalExp) * 100;
        const priorShares = priorMonths.map((pm) => {
          const pExp = monthlyExpenses.get(pm) ?? 0;
          if (pExp <= 0) return 0;
          const pSpend = monthlyMerchantSpend.get(pm)?.get(norm) ?? 0;
          return (pSpend / pExp) * 100;
        });

        const baselineShareMedian = calculateMedian(priorShares);
        const ppDiff = curShare - baselineShareMedian;

        if (ppDiff >= 15 && curShare >= 25) {
          const sampleTx = sorted.find((t) => normalizeMerchant(t.merchant) === norm);
          const merchantName = sampleTx?.merchant ?? norm;
          insights.push({
            rule_id: "MERCHANT_CONCENTRATION",
            title: "Merchant Spending Concentration",
            description: `Merchant "${merchantName}" captured ${curShare.toFixed(1)}% of total monthly spend (+${ppDiff.toFixed(1)} pp above baseline).`,
            params: {
              merchant: merchantName,
              share: curShare.toFixed(1),
              shift: ppDiff.toFixed(1),
            },
            severity: "low",
            transaction_ids: representativeIds(curMonth, (t) => normalizeMerchant(t.merchant) === norm),
            supporting_metrics: {
              merchant: merchantName,
              month: curMonth,
              current_share_pct: Number(curShare.toFixed(1)),
              baseline_share_pct: Number(baselineShareMedian.toFixed(1)),
              concentration_increase_pp: Number(ppDiff.toFixed(1)),
            },
            icon: "lucide:target",
          });
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 24: ROUND_NUMBER_TRANSACTION
     Icon: lucide:circle-dollar-sign
     Trigger when an unusually large non-recurring transaction has a highly rounded amount.
     ------------------------------------------------------------------------- */
  if (nonRecurringExpenseMags.length >= 15) {
    const p95 = calculatePercentile(nonRecurringExpenseMags, 95);
    for (const t of sorted) {
      if (t.kind !== "expense" || predictableRecurringTxIds.has(t.id)) continue;
      const mag = Math.abs(t.amountMinor);
      const major = mag / 100;

      const isRound = major >= 200 && (major % 100 === 0 || major % 500 === 0 || major % 1000 === 0);
      if (isRound && mag >= p95) {
        insights.push({
          rule_id: "ROUND_NUMBER_TRANSACTION",
          title: "High-Value Round Amount Transaction",
          description: `Large rounded amount of ${(mag / 100).toFixed(2)} ${t.currency} at "${t.merchant}".`,
          params: {
            amount: formatMoney(mag, t.currency),
            merchant: t.merchant,
          },
          severity: "low",
          transaction_ids: [t.id],
          supporting_metrics: {
            amount_minor: mag,
            major_units: major,
            p95_threshold_minor: Math.round(p95),
          },
          icon: "lucide:circle-dollar-sign",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 25: REFUND_ANOMALY
     Icon: lucide:undo-2
     ------------------------------------------------------------------------- */
  const refunds = sorted.filter((t) => t.kind === "income" && t.category !== "Salary");
  if (refunds.length >= 5) {
    const refundAmounts = refunds.map((r) => Math.abs(r.amountMinor));
    const medianRefund = calculateMedian(refundAmounts);
    const madRefund = calculateMAD(refundAmounts, medianRefund);
    const effectiveMAD = Math.max(madRefund, medianRefund * 0.25, 2000);

    for (const r of refunds) {
      const mag = Math.abs(r.amountMinor);
      const madDev = (mag - medianRefund) / effectiveMAD;
      if (madDev > 3 && mag >= medianRefund * 2) {
        insights.push({
          rule_id: "REFUND_ANOMALY",
          title: "Unusual Refund / Credit Amount",
          description: `Refund credit of ${(mag / 100).toFixed(2)} ${r.currency} from "${r.merchant}" exceeds median refund baseline by ${madDev.toFixed(1)}x MAD.`,
          params: {
            amount: formatMoney(mag, r.currency),
            merchant: r.merchant,
            mad: madDev.toFixed(1),
          },
          severity: "low",
          transaction_ids: [r.id],
          supporting_metrics: {
            refund_amount_minor: mag,
            median_refund_minor: Math.round(medianRefund),
            mad_deviation: Number(madDev.toFixed(2)),
          },
          icon: "lucide:undo-2",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 26: CASH_WITHDRAWAL_SPIKE
     Icon: lucide:banknote
     ------------------------------------------------------------------------- */
  const cashTxs = sorted.filter(
    (t) =>
      /*
       * Never an own-account movement, and this is load-bearing rather than
       * tidy: the category test below is a substring match, and once
       * `Cash & Transfers` absorbed the old `Transfer` category a credit-card
       * settlement started reading as a cash withdrawal — thousands of francs
       * against a median TWINT of twenty, which is a spike by any measure. This
       * rule is one of the four `canEscalateToAlert` will co-sign, so that
       * false positive was a red "this may not have been you" about somebody
       * paying their own credit card. `kind` is the app's own definition of
       * money between your own accounts; the category no longer is.
       */
      t.kind !== "transfer" &&
      (t.category.toLowerCase().includes("cash") ||
        t.category.toLowerCase().includes("atm") ||
        t.merchant.toLowerCase().includes("atm") ||
        t.merchant.toLowerCase().includes("bancomat") ||
        t.merchant.toLowerCase().includes("postomat")),
  );

  if (cashTxs.length >= 5) {
    const cashAmounts = cashTxs.map((c) => Math.abs(c.amountMinor));
    const medianCash = calculateMedian(cashAmounts);
    const madCash = calculateMAD(cashAmounts, medianCash);
    const effectiveMAD = Math.max(madCash, medianCash * 0.25, 5000);

    for (const c of cashTxs) {
      const mag = Math.abs(c.amountMinor);
      const madDev = (mag - medianCash) / effectiveMAD;
      if (madDev >= 3 && mag >= medianCash * 2) {
        insights.push({
          rule_id: "CASH_WITHDRAWAL_SPIKE",
          title: "Elevated Cash Withdrawal Amount",
          description: `Cash withdrawal of ${(mag / 100).toFixed(2)} ${c.currency} is substantially above normal withdrawal baseline.`,
          params: {
            amount: formatMoney(mag, c.currency),
          },
          severity: "medium",
          transaction_ids: [c.id],
          supporting_metrics: {
            amount_minor: mag,
            median_withdrawal_minor: Math.round(medianCash),
            mad_deviation: Number(madDev.toFixed(2)),
          },
          icon: "lucide:banknote",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 27: PAYMENT_METHOD_SHIFT (Macro Metric)
     Icon: lucide:credit-card
     ------------------------------------------------------------------------- */
  if (allMonths.length >= 4) {
    for (let mIdx = 3; mIdx < allMonths.length; mIdx++) {
      const curMonth = allMonths[mIdx];
      const curAccMap = monthlyAccountSpend.get(curMonth);
      const totalSpend = monthlyExpenses.get(curMonth) ?? 0;
      if (!curAccMap || totalSpend <= 0) continue;

      const priorMonths = allMonths.slice(0, mIdx);

      for (const [acc, spend] of curAccMap.entries()) {
        const curShare = (spend / totalSpend) * 100;
        const priorShares = priorMonths.map((pm) => {
          const pExp = monthlyExpenses.get(pm) ?? 0;
          if (pExp <= 0) return 0;
          const pSpend = monthlyAccountSpend.get(pm)?.get(acc) ?? 0;
          return (pSpend / pExp) * 100;
        });

        const baselineMedian = calculateMedian(priorShares);
        const ppDiff = Math.abs(curShare - baselineMedian);

        if (ppDiff >= 25) {
          insights.push({
            rule_id: "PAYMENT_METHOD_SHIFT",
            title: "Payment Method Utilization Shift",
            description: `Share of spending via "${acc}" shifted by ${ppDiff.toFixed(1)} pp in ${curMonth} (${curShare.toFixed(1)}% vs baseline ${baselineMedian.toFixed(1)}%).`,
            params: {
              account: acc,
              shift: ppDiff.toFixed(1),
              month: curMonth,
              share: curShare.toFixed(1),
              baseline: baselineMedian.toFixed(1),
            },
            severity: "low",
            transaction_ids: representativeIds(curMonth, (t) => t.account === acc),
            supporting_metrics: {
              account_or_method: acc,
              month: curMonth,
              current_share_pct: Number(curShare.toFixed(1)),
              baseline_share_pct: Number(baselineMedian.toFixed(1)),
              shift_pp: Number(ppDiff.toFixed(1)),
            },
            icon: "lucide:credit-card",
          });
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 28: EXPENSE_GROWTH_TREND (Macro Metric)
     Icon: lucide:trending-up
     ------------------------------------------------------------------------- */
  if (allMonths.length >= 4) {
    for (const cat of allCategories) {
      const monthSeries: number[] = [];
      for (const m of allMonths) {
        monthSeries.push(monthlyCategorySpend.get(m)?.get(cat) ?? 0);
      }

      for (let i = 3; i < monthSeries.length; i++) {
        const window = monthSeries.slice(i - 3, i + 1);
        const isStrictlyGrowing =
          window[1] > window[0] && window[2] > window[1] && window[3] > window[2];

        if (isStrictlyGrowing && window[0] > 0) {
          const avgGrowthRate =
            ((window[1] - window[0]) / window[0] +
              (window[2] - window[1]) / window[1] +
              (window[3] - window[2]) / window[2]) /
            3;

          if (avgGrowthRate >= 0.15) {
            const slope = fitLinearSlope(window);
            const totalGrowthMinor = window[3] - window[0];
            const isMaterial =
              typicalMonthlyIncome > 0 && totalGrowthMinor > 0.05 * typicalMonthlyIncome;
            const severity: AnomalySeverity = isMaterial ? "high" : "medium";

            insights.push({
              rule_id: "EXPENSE_GROWTH_TREND",
              title: "Sustained Expense Growth Trend",
              description: `Category "${cat}" exhibited steady growth over 4 consecutive months (+${(avgGrowthRate * 100).toFixed(0)}% average monthly expansion).`,
              params: {
                category: cat,
                growth: (avgGrowthRate * 100).toFixed(0),
              },
              severity,
              transaction_ids: representativeIds(allMonths[i], (t) => t.category === cat),
              supporting_metrics: {
                category: cat,
                consecutive_growing_periods: 4,
                average_period_growth_pct: Number((avgGrowthRate * 100).toFixed(1)),
                linear_slope_minor: Math.round(slope),
                start_month_spend_minor: window[0],
                end_month_spend_minor: window[3],
              },
              icon: "lucide:trending-up",
            });
            break;
          }
        }
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 29: SUBSCRIPTION_ACCUMULATION
     Icon: lucide:layers
     ------------------------------------------------------------------------- */
  const predictableSubs = recurringExpenses.filter((p) => p.isPredictableSubscription);
  if (predictableSubs.length >= 3) {
    const totalRecurringSpend = predictableSubs.reduce(
      (sum, p) => sum + p.medianAmountMinor,
      0,
    );
    const recentSubs = predictableSubs.filter((p) => {
      const firstSeen = p.dates[0];
      return getDaysDiff(firstDate, firstSeen) >= totalHistoryDays / 2;
    });

    if (recentSubs.length >= 2) {
      insights.push({
        rule_id: "SUBSCRIPTION_ACCUMULATION",
        title: "Accumulation of Recurring Subscriptions",
        description: `Active recurring subscriptions grew with ${recentSubs.length} new recurring services detected.`,
        params: {
          count: recentSubs.length,
        },
        severity: "medium",
        transaction_ids: recentSubs.flatMap((s) => s.transactionIds.slice(-1)),
        supporting_metrics: {
          total_recurring_subscriptions: predictableSubs.length,
          new_subscriptions_added: recentSubs.length,
          total_recurring_monthly_spend_minor: Math.round(totalRecurringSpend),
        },
        icon: "lucide:layers",
      });
    }
  }

  /* -------------------------------------------------------------------------
     RULE 30: UNUSUAL_FINANCIAL_IMPACT
     Icon: lucide:triangle-alert
     Trigger only when a non-recurring transaction is statistically extreme AND > 20% income.
     ------------------------------------------------------------------------- */
  for (const t of sorted) {
    if (t.kind !== "expense" || predictableRecurringTxIds.has(t.id)) continue;
    const mag = Math.abs(t.amountMinor);

    const isHighImpact = typicalMonthlyIncome > 0 && mag >= 0.2 * typicalMonthlyIncome;
    if (isHighImpact && nonRecurringExpenseMags.length >= 10) {
      const p95 = calculatePercentile(nonRecurringExpenseMags, 95);
      if (mag >= p95) {
        insights.push({
          rule_id: "UNUSUAL_FINANCIAL_IMPACT",
          title: "High-Impact Financial Outflow",
          description: `Transaction of ${(mag / 100).toFixed(2)} ${t.currency} is statistically extreme and represents ${((mag / typicalMonthlyIncome) * 100).toFixed(1)}% of typical monthly income.`,
          params: {
            amount: formatMoney(mag, t.currency),
            share: ((mag / typicalMonthlyIncome) * 100).toFixed(1),
          },
          severity: "high",
          transaction_ids: [t.id],
          supporting_metrics: {
            amount_minor: mag,
            monthly_income_share_pct: Number(((mag / typicalMonthlyIncome) * 100).toFixed(1)),
            p95_threshold_minor: Math.round(p95),
          },
          icon: "lucide:triangle-alert",
        });
      }
    }
  }

  // Collapse before filtering, so a target set narrows whole findings rather
  // than the fragments they were assembled from.
  let finalInsights = consolidateInsights(insights, sorted);

  if (options.targetTransactionIds) {
    const targetSet =
      options.targetTransactionIds instanceof Set
        ? options.targetTransactionIds
        : new Set(options.targetTransactionIds);
    finalInsights = finalInsights.filter((r) =>
      r.transaction_ids.some((id) => targetSet.has(id)),
    );
  }

  /*
   * `emoji` and `kind` are both stamped here rather than at each rule's push
   * site: they are derived from what the rule already decided, so 26 copies of
   * the derivation would be 26 chances to disagree.
   */
  const stamped = finalInsights.map((r) => ({
    ...r,
    emoji: emojiFor(r.rule_id),
    kind: derivedKind(r.severity),
  }));

  /*
   * Escalation is a second pass because it is the one classification that reads
   * the other findings: a large transfer and a first-time recipient only mean
   * something together, and neither knows about the other until both exist.
   */
  return stamped.map((insight) => ({
    ...insight,
    kind: canEscalateToAlert(insight, stamped) ? ("alert" as const) : insight.kind,
  }));
}

/* =========================================================================
   CONSOLIDATION
   ========================================================================= */

/**
 * Rules that describe *one transaction's amount*, strongest first. When two of
 * these cover the same rows, only the strongest is kept — they are four ways of
 * saying "this charge was big", and stacking them buries the finding that
 * actually adds something.
 *
 * Rules absent from this list are never suppressed: a category overspend or a
 * balance drawdown on the same day is a different observation about a different
 * unit of analysis, not a restatement.
 */
const AMOUNT_RULE_PRECEDENCE = [
  "REPEAT_CHARGE",
  "UNUSUALLY_LARGE_TRANSACTION",
  "AMOUNT_SPIKE",
  "UNUSUAL_FINANCIAL_IMPACT",
];

/* Both stamped after consolidation, so the rules never spell them out. */
type RawInsight = Omit<AnomalyInsight, "emoji" | "kind">;

/**
 * Rules that already emit one finding per event rather than per transaction.
 * Merging these by (day, merchant) would fuse genuinely separate findings —
 * four charges of CHF 1'766.50 and four of CHF 98.00 on one airline day are two
 * facts, and the merged description could only state one of them.
 */
const EVENT_SHAPED_RULES = new Set(["REPEAT_CHARGE"]);

/**
 * Turns per-transaction findings into per-event findings.
 *
 * Without this, one afternoon of airline bookings — four identical charges plus
 * four identical fees — produced fifteen findings across six rules, and the
 * reader had to work out for themselves that it was all one purchase. Two
 * passes fix that: merge a rule's own findings when they describe the same
 * merchant on the same day, then drop the weaker amount rules once a stronger
 * one already covers those rows.
 *
 * Exported for its own tests; `analyzeTransactionAnomalies` applies it already.
 */
export function consolidateInsights(
  insights: RawInsight[],
  transactions: TransactionInput[],
): RawInsight[] {
  if (insights.length === 0) return [];

  const byId = new Map<number, TransactionInput>();
  for (const t of transactions) byId.set(t.id, t);

  /** The (day, merchant) an insight sits on, or null when it spans several. */
  const eventKeyOf = (insight: RawInsight): string | null => {
    let key: string | null = null;
    for (const id of insight.transaction_ids) {
      const t = byId.get(id);
      if (!t) return null;
      const here = `${t.bookedOn}|${normalizeMerchant(t.merchant)}`;
      if (key === null) key = here;
      else if (key !== here) return null;
    }
    return key;
  };

  // Pass A — merge a rule's findings that land on the same merchant and day.
  const merged: RawInsight[] = [];
  const mergedByKey = new Map<string, RawInsight>();

  for (const insight of insights) {
    const eventKey = EVENT_SHAPED_RULES.has(insight.rule_id) ? null : eventKeyOf(insight);
    if (eventKey === null) {
      merged.push(insight);
      continue;
    }
    const key = `${insight.rule_id}|${eventKey}`;
    const existing = mergedByKey.get(key);
    if (!existing) {
      const copy = { ...insight, transaction_ids: [...insight.transaction_ids] };
      mergedByKey.set(key, copy);
      merged.push(copy);
      continue;
    }
    const ids = new Set(existing.transaction_ids);
    for (const id of insight.transaction_ids) ids.add(id);
    existing.transaction_ids = [...ids].sort((a, b) => a - b);
    // The merged finding now speaks for several charges, so the count belongs
    // in the metrics even when the individual rule never tracked one.
    existing.supporting_metrics = {
      ...existing.supporting_metrics,
      merged_transaction_count: existing.transaction_ids.length,
    };
    if (rank(insight.severity) > rank(existing.severity)) {
      existing.severity = insight.severity;
    }
  }

  // Pass B — drop an amount rule whose rows a stronger amount rule already owns.
  const strongest = new Map<number, number>(); // transaction id -> best precedence
  for (const insight of merged) {
    const precedence = AMOUNT_RULE_PRECEDENCE.indexOf(insight.rule_id);
    if (precedence === -1) continue;
    for (const id of insight.transaction_ids) {
      const best = strongest.get(id);
      if (best === undefined || precedence < best) strongest.set(id, precedence);
    }
  }

  return merged.filter((insight) => {
    const precedence = AMOUNT_RULE_PRECEDENCE.indexOf(insight.rule_id);
    if (precedence === -1) return true;
    // Survives if it is the strongest claim on at least one of its own rows —
    // so a finding covering rows nothing else reached is never lost.
    return insight.transaction_ids.some((id) => strongest.get(id) === precedence);
  });
}

function rank(severity: AnomalySeverity): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}
