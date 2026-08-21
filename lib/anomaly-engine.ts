/**
 * Deterministic Transaction Anomaly Detection Engine
 *
 * Implements 30 statistical / deterministic rules for analyzing user bank transactions.
 * Rules operate ONLY on mathematical baselines (median, MAD, percentiles, intervals, trend regressions).
 * No LLMs, no intent inference, no subjective fraud labeling.
 */

export type AnomalySeverity = "low" | "medium" | "high";

export const RULE_EMOJIS: Record<string, string> = {
  AMOUNT_SPIKE: "🔺",
  UNUSUALLY_LARGE_TRANSACTION: "💰",
  NEW_MERCHANT: "🏪",
  NEW_CATEGORY: "🏷️",
  FREQUENCY_SPIKE: "🔁",
  CATEGORY_SPENDING_SPIKE: "📈",
  NEW_RECURRING_PAYMENT: "📅",
  RECURRING_PAYMENT_CHANGE: "🔄",
  RECURRING_PAYMENT_DISAPPEARANCE: "❌",
  UNUSUAL_TIME: "🕒",
  UNUSUAL_DAY: "🗓️",
  VELOCITY_SPIKE: "⚡",
  DUPLICATE_TRANSACTION: "👯",
  UNUSUAL_LOCATION: "📍",
  RAPID_LOCATION_CHANGE: "✈️",
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
};

export interface AnomalyInsight {
  rule_id: string;
  title: string;
  description: string;
  severity: AnomalySeverity;
  transaction_ids: number[];
  supporting_metrics: Record<string, number | string | boolean | (number | string)[]>;
  icon: string;
  emoji: string;
}

export function getAnomaliesByTransactionId(
  anomalies: AnomalyInsight[],
): Map<number, AnomalyInsight[]> {
  const map = new Map<number, AnomalyInsight[]>();
  for (const anomaly of anomalies) {
    for (const id of anomaly.transaction_ids) {
      const list = map.get(id) ?? [];
      list.push(anomaly);
      map.set(id, list);
    }
  }
  return map;
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
  location?: {
    city?: string;
    country?: string;
    lat?: number;
    lon?: number;
  };
  paymentMethod?: string;
  timestamp?: number; // epoch ms (optional)
}

export interface EngineOptions {
  referenceDate?: string; // "YYYY-MM-DD"
  typicalMonthlyIncomeMinor?: number; // if known in advance, else inferred from salary/income history
  minHistoryDays?: number;
  travelSpeedThresholdKmH?: number; // default 800 km/h
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

export function parseTransactionDate(t: TransactionInput): Date {
  if (t.timestamp) return new Date(t.timestamp);
  // Support both YYYY-MM-DD and full ISO strings
  if (t.bookedOn.includes("T") || t.bookedOn.includes(":")) {
    return new Date(t.bookedOn);
  }
  const [y, m, d] = t.bookedOn.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
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

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
      // Predictable subscription: amounts are tight (amount MAD <= 10% of median)
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

  const rawInsights: Omit<AnomalyInsight, "emoji">[] = [];
  const insights = rawInsights;

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
      const acc = t.paymentMethod || t.account;
      accMap.set(acc, (accMap.get(acc) ?? 0) + mag);
    } else if (t.kind === "income") {
      monthlyIncome.set(month, (monthlyIncome.get(month) ?? 0) + Math.abs(t.amountMinor));
    }
  }

  const allMonths = [...new Set([...monthlyExpenses.keys(), ...monthlyIncome.keys()])].sort();

  /* -------------------------------------------------------------------------
     RULE 1: AMOUNT_SPIKE
     Icon: lucide:arrow-up
     Trigger when amount > median + 3 * MAD (>= 5 historical comparable transactions)
     Require substantial absolute and proportional deviation (>= 50% above median).
     ------------------------------------------------------------------------- */
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (t.kind !== "expense") continue;
    // Skip predictable recurring baseline expenses like monthly rent
    if (predictableRecurringTxIds.has(t.id)) continue;

    const mag = Math.abs(t.amountMinor);
    const norm = normalizeMerchant(t.merchant);

    const fullMerchantHistory = expensesByMerchant.get(norm) ?? [];
    const fullCategoryHistory = expensesByCategory.get(t.category) ?? [];

    const baselineGroup = fullMerchantHistory.length >= 5 ? fullMerchantHistory : fullCategoryHistory;
    const baselineType = fullMerchantHistory.length >= 5 ? "merchant" : "category";

    if (baselineGroup.length >= 5) {
      const amounts = baselineGroup.map((b) => Math.abs(b.amountMinor));
      const median = calculateMedian(amounts);
      const rawMAD = calculateMAD(amounts, median);

      // Proportional noise floor: MAD is at least 25% of median or CHF 20.00 (2000 minor)
      const effectiveMAD = Math.max(rawMAD, median * 0.25, 2000);

      if (mag > median + 3 * effectiveMAD && mag >= median * 1.5) {
        const madDeviation = (mag - median) / effectiveMAD;
        const severity: AnomalySeverity = madDeviation > 5 ? "high" : "medium";
        insights.push({
          rule_id: "AMOUNT_SPIKE",
          title: "Unusual Expense Amount Spike",
          description: `Transaction amount (${(mag / 100).toFixed(2)} ${t.currency}) exceeds the ${baselineType} baseline median (${(median / 100).toFixed(2)}) by ${madDeviation.toFixed(1)}x MAD.`,
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
    for (const t of sorted) {
      if (t.kind !== "expense" || predictableRecurringTxIds.has(t.id)) continue;
      const mag = Math.abs(t.amountMinor);
      const isP99 = mag >= p99;
      const isIncomePct = typicalMonthlyIncome > 0 && mag > 0.2 * typicalMonthlyIncome;

      if (isP99 || (isIncomePct && mag > calculateMedian(nonRecurringExpenseMags) * 3)) {
        const severity: AnomalySeverity = isP99 && isIncomePct ? "high" : "medium";
        insights.push({
          rule_id: "UNUSUALLY_LARGE_TRANSACTION",
          title: "Unusually Large Outflow",
          description: `Transaction amount (${(mag / 100).toFixed(2)} ${t.currency}) ranks among the largest transactions in history.`,
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
     and only for transactions in the latest evaluation period).
     ------------------------------------------------------------------------- */
  if (totalHistoryDays >= 60) {
    const baselineCutoffDays = totalHistoryDays * 0.7; // Establish 70% history as catalog baseline
    const seenMerchants = new Set<string>();

    for (const t of sorted) {
      const curDate = parseTransactionDate(t);
      const daysSinceStart = getDaysDiff(firstDate, curDate);
      const norm = normalizeMerchant(t.merchant);

      if (daysSinceStart < baselineCutoffDays) {
        if (norm) seenMerchants.add(norm);
      } else {
        if (norm && !seenMerchants.has(norm) && seenMerchants.size >= 15) {
          insights.push({
            rule_id: "NEW_MERCHANT",
            title: "First-Time Merchant",
            description: `Transaction with previously unseen merchant "${t.merchant}" after ${Math.round(daysSinceStart)} days of history.`,
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
          seenMerchants.add(norm); // Avoid duplicate triggers for same new merchant
        }
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
    for (const [norm, group] of allByMerchantNorm.entries()) {
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
     RULE 10: UNUSUAL_TIME
     Icon: lucide:clock-3
     Trigger when transaction occurs outside user's 99th percentile time range.
     ------------------------------------------------------------------------- */
  const hoursRecorded = sorted
    .filter((t) => t.timestamp || (t.bookedOn.includes("T") && !t.bookedOn.includes("T12:00:00")))
    .map((t) => parseTransactionDate(t).getUTCHours());

  if (hoursRecorded.length >= 30) {
    const lowHourP1 = calculatePercentile(hoursRecorded, 1);
    const highHourP99 = calculatePercentile(hoursRecorded, 99);

    for (const t of sorted) {
      if (!t.timestamp && !t.bookedOn.includes("T")) continue;
      const h = parseTransactionDate(t).getUTCHours();
      if (h < lowHourP1 || h > highHourP99) {
        insights.push({
          rule_id: "UNUSUAL_TIME",
          title: "Unusual Time of Day",
          description: `Transaction at ${h}:00 UTC falls outside normal activity hours (${Math.round(lowHourP1)}:00 - ${Math.round(highHourP99)}:00).`,
          severity: "low",
          transaction_ids: [t.id],
          supporting_metrics: {
            hour: h,
            normal_hour_min: Math.round(lowHourP1),
            normal_hour_max: Math.round(highHourP99),
          },
          icon: "lucide:clock-3",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 11: UNUSUAL_DAY
     Icon: lucide:calendar-clock
     Trigger only for strict merchant/category weekday patterns (>= 25 samples, 0 historical on this day).
     ------------------------------------------------------------------------- */
  for (const [norm, group] of expensesByMerchant.entries()) {
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
     RULE 12: VELOCITY_SPIKE
     Icon: lucide:gauge
     Trigger when >= 5 tx in 10 min OR >= 10 tx in 60 min.
     ------------------------------------------------------------------------- */
  const txWithExactTime = sorted.filter((t) => t.timestamp || (t.bookedOn.includes("T") && !t.bookedOn.includes("12:00:00")));
  if (txWithExactTime.length >= 5) {
    for (let i = 0; i < txWithExactTime.length; i++) {
      const t1 = txWithExactTime[i];
      const time1 = parseTransactionDate(t1).getTime();

      const in10Min = txWithExactTime.filter((t2) => {
        const diffMin = (parseTransactionDate(t2).getTime() - time1) / 60000;
        return diffMin >= 0 && diffMin <= 10;
      });

      const in60Min = txWithExactTime.filter((t2) => {
        const diffMin = (parseTransactionDate(t2).getTime() - time1) / 60000;
        return diffMin >= 0 && diffMin <= 60;
      });

      if (in10Min.length >= 5 || in60Min.length >= 10) {
        const isExtreme = in10Min.length >= 10 || in60Min.length >= 20;
        const severity: AnomalySeverity = isExtreme ? "high" : "medium";
        const flagged = in10Min.length >= 5 ? in10Min : in60Min;
        insights.push({
          rule_id: "VELOCITY_SPIKE",
          title: "High Transaction Velocity Burst",
          description: `${flagged.length} transactions executed within a very short window.`,
          severity,
          transaction_ids: flagged.map((f) => f.id),
          supporting_metrics: {
            count_10min: in10Min.length,
            count_60min: in60Min.length,
            burst_size: flagged.length,
          },
          icon: "lucide:gauge",
        });
        i += flagged.length - 1;
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 13: DUPLICATE_TRANSACTION
     Icon: lucide:copy
     Trigger when same merchant, amount, currency, account occur <= 5 mins apart.
     ------------------------------------------------------------------------- */
  const exactTxs = sorted.filter((t) => t.timestamp || t.bookedOn.includes("T"));
  for (let i = 0; i < exactTxs.length; i++) {
    for (let j = i + 1; j < exactTxs.length; j++) {
      const t1 = exactTxs[i];
      const t2 = exactTxs[j];
      const d1 = parseTransactionDate(t1);
      const d2 = parseTransactionDate(t2);
      const diffMinutes = Math.abs(d2.getTime() - d1.getTime()) / 60000;

      if (
        diffMinutes <= 5 &&
        t1.amountMinor === t2.amountMinor &&
        t1.currency === t2.currency &&
        t1.account === t2.account &&
        normalizeMerchant(t1.merchant) === normalizeMerchant(t2.merchant)
      ) {
        insights.push({
          rule_id: "DUPLICATE_TRANSACTION",
          title: "Potential Duplicate Transaction",
          description: `Two identical charges of ${(Math.abs(t1.amountMinor) / 100).toFixed(2)} ${t1.currency} at "${t1.merchant}" occurred ${diffMinutes.toFixed(0)} mins apart.`,
          severity: "medium",
          transaction_ids: [t1.id, t2.id],
          supporting_metrics: {
            merchant: t1.merchant,
            amount_minor: Math.abs(t1.amountMinor),
            currency: t1.currency,
            account: t1.account,
            diff_minutes: Number(diffMinutes.toFixed(1)),
          },
          icon: "lucide:copy",
        });
      }
    }
  }

  /* -------------------------------------------------------------------------
     RULE 14: UNUSUAL_LOCATION
     Icon: lucide:map-pin
     ------------------------------------------------------------------------- */
  const locationTxs = sorted.filter((t) => t.location?.country || t.location?.city);
  if (locationTxs.length >= 10) {
    const historicalCountries = new Set<string>();
    for (let i = 0; i < locationTxs.length; i++) {
      const t = locationTxs[i];
      const country = t.location?.country;
      if (country && i >= 10 && !historicalCountries.has(country)) {
        insights.push({
          rule_id: "UNUSUAL_LOCATION",
          title: "New Geographic Location",
          description: `Transaction initiated in new country "${country}".`,
          severity: "medium",
          transaction_ids: [t.id],
          supporting_metrics: {
            country,
            city: t.location?.city ?? "Unknown",
            prior_countries_count: historicalCountries.size,
          },
          icon: "lucide:map-pin",
        });
      }
      if (country) historicalCountries.add(country);
    }
  }

  /* -------------------------------------------------------------------------
     RULE 15: RAPID_LOCATION_CHANGE
     Icon: lucide:plane
     ------------------------------------------------------------------------- */
  const geoTxs = sorted.filter(
    (t) =>
      t.location?.lat !== undefined &&
      t.location?.lon !== undefined &&
      (t.timestamp || t.bookedOn.includes("T")),
  );

  const speedLimitKmH = options.travelSpeedThresholdKmH ?? 800;

  for (let i = 1; i < geoTxs.length; i++) {
    const prev = geoTxs[i - 1];
    const curr = geoTxs[i];
    const hours = (parseTransactionDate(curr).getTime() - parseTransactionDate(prev).getTime()) / (1000 * 60 * 60);

    if (hours > 0 && hours < 24) {
      const dist = haversineDistanceKm(
        prev.location!.lat!,
        prev.location!.lon!,
        curr.location!.lat!,
        curr.location!.lon!,
      );
      const speed = dist / hours;
      if (speed > speedLimitKmH && dist > 200) {
        insights.push({
          rule_id: "RAPID_LOCATION_CHANGE",
          title: "Implausible Travel Velocity",
          description: `Consecutive transactions separated by ${Math.round(dist)} km within ${hours.toFixed(1)} hours (required speed: ${Math.round(speed)} km/h).`,
          severity: "high",
          transaction_ids: [prev.id, curr.id],
          supporting_metrics: {
            distance_km: Math.round(dist),
            time_delta_hours: Number(hours.toFixed(2)),
            required_speed_kmh: Math.round(speed),
            threshold_speed_kmh: speedLimitKmH,
          },
          icon: "lucide:plane",
        });
      }
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
    for (let i = 0; i < sorted.length; i++) {
      const curDate = parseTransactionDate(sorted[i]);
      const windowTxs = sorted.filter((t) => {
        const td = parseTransactionDate(t);
        const diff = (curDate.getTime() - td.getTime()) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 7;
      });

      let netOutflow = 0;
      let largestExpense: TransactionInput | null = null;
      for (const w of windowTxs) {
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
            severity,
            transaction_ids: [],
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
            severity: "medium",
            transaction_ids: [],
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
            severity: "low",
            transaction_ids: [],
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
      t.category.toLowerCase().includes("cash") ||
      t.category.toLowerCase().includes("atm") ||
      t.merchant.toLowerCase().includes("atm") ||
      t.merchant.toLowerCase().includes("bancomat") ||
      t.merchant.toLowerCase().includes("postomat"),
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
            severity: "low",
            transaction_ids: [],
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
              severity,
              transaction_ids: [],
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

  let finalInsights = rawInsights;
  if (options.targetTransactionIds) {
    const targetSet =
      options.targetTransactionIds instanceof Set
        ? options.targetTransactionIds
        : new Set(options.targetTransactionIds);
    finalInsights = rawInsights.filter((r) =>
      r.transaction_ids.some((id) => targetSet.has(id)),
    );
  }

  return finalInsights.map((r) => ({
    ...r,
    emoji: RULE_EMOJIS[r.rule_id] ?? "⚠️",
  }));
}
