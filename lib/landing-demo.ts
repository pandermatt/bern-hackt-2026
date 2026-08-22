import { MONTH_LABELS, OTHER_CATEGORY, type MonthPoint } from "@/lib/insights";

/**
 * The figures the landing page's preview draws.
 *
 * Pure, for the same reasons `lib/insights.ts` is: no `server-only`, no
 * database import, no i18n call and no `Date`. The landing is a server
 * component and the preview is a client one, and both read from here — a
 * headline that disagreed with the chart under it would be worse than no
 * chart at all.
 *
 * Invented, and it has to look invented on inspection: the point of this data
 * is to show the *shapes* the dashboard, the budget page and the anomalies
 * page draw, on numbers nobody could mistake for their own. What is not
 * invented is the vocabulary — the category keys below are the real ones from
 * `scripts/lib/statement.ts`, so `categoryIcon()` and the `Categories`
 * namespace resolve for free and the preview cannot name a category the app
 * does not have.
 *
 * Money is **signed integer rappen**, months are `YYYY-MM` text: the same two
 * conventions the real data layer runs on, so the same formatters apply.
 * `tests/landing-copy.test.ts` holds the internal consistency.
 */

/** Where the demo year starts. A year, so the flow chart has twelve columns. */
const DEMO_YEAR = "2025";

/** The balance the running sum starts from — an account that already existed. */
const OPENING_BALANCE_MINOR = 1_240_00;

/**
 * Twelve months of net, in rappen. Two negative — a January that pays for
 * December and a July holiday — because a zero line with nothing below it is
 * a zero line nobody needs.
 */
const DEMO_NETS = [
  -31_050, 62_400, 48_900, 71_200, 39_650, 55_300,
  -18_400, 84_100, 46_750, 58_200, 43_900, 96_500,
] as const;

/** The month's outflow, so income can be derived rather than invented twice. */
const DEMO_EXPENSES = [
  512_300, 468_900, 486_400, 452_800, 495_150, 478_200,
  613_600, 441_700, 489_450, 471_300, 486_600, 428_900,
] as const;

/**
 * The flow view's series, in the app's own `MonthPoint` shape.
 *
 * `balance` is the running sum of `net` over `OPENING_BALANCE_MINOR`, which is
 * exactly the contract the real `monthlySeries` states — computed here rather
 * than typed out, so the line and the bars cannot drift apart.
 *
 * `label` stays English, like the real `monthlySeries` leaves it: the chart
 * reads its month names out of the `Months` catalog, because this module has
 * no locale to read.
 */
export const DEMO_MONTHS: MonthPoint[] = DEMO_NETS.map((net, index) => {
  const expense = DEMO_EXPENSES[index];
  return {
    month: `${DEMO_YEAR}-${String(index + 1).padStart(2, "0")}`,
    label: MONTH_LABELS[index],
    income: expense + net,
    expense,
    net,
    balance:
      OPENING_BALANCE_MINOR +
      DEMO_NETS.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
  };
});

/** The year, as the three tiles above the chart report it. */
export function demoTotals(): {
  income: number;
  expense: number;
  net: number;
} {
  return DEMO_MONTHS.reduce(
    (totals, point) => ({
      income: totals.income + point.income,
      expense: totals.expense + point.expense,
      net: totals.net + point.net,
    }),
    { income: 0, expense: 0, net: 0 },
  );
}

export type DemoCategory = {
  /** A real category key — see the note at the top of this file. */
  key: string;
  /** The palette slot, assigned once. 0 is the neutral fold-in bucket. */
  slot: number;
  total: number;
};

/**
 * Seven categories and the fold-in bucket.
 *
 * The slot is a property of the category, not of its position in this array —
 * the same contract `slotsOf` gives the dashboard. `OTHER_CATEGORY` takes slot
 * 0, the neutral bucket, and never competes for a hue.
 */
export const DEMO_CATEGORIES: DemoCategory[] = [
  { key: "Housing", slot: 1, total: 1_842_000 },
  { key: "Food & Drink", slot: 2, total: 1_186_500 },
  { key: "Transport", slot: 3, total: 684_300 },
  { key: "Health & Insurance", slot: 4, total: 562_800 },
  { key: "Utilities & Telecom", slot: 5, total: 398_400 },
  { key: "Subscriptions", slot: 6, total: 241_900 },
  { key: "Sports & Leisure", slot: 7, total: 187_200 },
  { key: OTHER_CATEGORY, slot: 0, total: 322_200 },
];

export type DemoBudgetRow = {
  key: string;
  slot: number;
  usedMinor: number;
  limitMinor: number;
};

/**
 * One month against its limits, for the radar.
 *
 * Exactly one row is over — that is the reading the radar exists for, and one
 * spoke pushing past the dashed outline is legible where three are just a
 * bigger shape.
 */
export const DEMO_BUDGET: DemoBudgetRow[] = [
  { key: "Housing", slot: 1, usedMinor: 154_000, limitMinor: 160_000 },
  { key: "Food & Drink", slot: 2, usedMinor: 112_400, limitMinor: 95_000 },
  { key: "Transport", slot: 3, usedMinor: 48_600, limitMinor: 60_000 },
  { key: "Health & Insurance", slot: 4, usedMinor: 46_900, limitMinor: 50_000 },
  { key: "Utilities & Telecom", slot: 5, usedMinor: 28_300, limitMinor: 35_000 },
  { key: "Subscriptions", slot: 6, usedMinor: 19_800, limitMinor: 25_000 },
];

/**
 * How worried a dot is, in the anomalies view.
 *
 * The engine's own `kind` vocabulary minus `warning`: `--brand` is 1.5:1 on
 * white and the palette rule is fills only, never a mark that has to be told
 * apart from its neighbours. Two flagged colours is the honest ceiling on a
 * canvas — `--accent` for "worth a look" and `--danger` for "this may not have
 * been you".
 */
export type DemoFindingKind = "none" | "info" | "alert";

export type DemoFinding = {
  /** 1–12. The x position; the scatter has no day resolution to speak of. */
  month: number;
  amountMinor: number;
  kind: DemoFindingKind;
  /**
   * The `Landing` message key holding this finding's caption — not a live
   * `AnomalyRules` id. The preview must not claim a real rule fired on data
   * that does not exist.
   */
  captionKey?: string;
};

/**
 * A year of expenses as dots, four of them flagged.
 *
 * Written out rather than generated: a random scatter re-rolled on every
 * render would move under the reader's cursor, and a seeded generator is more
 * machinery than sixty pairs of numbers deserve.
 */
export const DEMO_FINDINGS: DemoFinding[] = [
  { month: 1, amountMinor: 4_250, kind: "none" },
  { month: 1, amountMinor: 12_800, kind: "none" },
  { month: 1, amountMinor: 8_900, kind: "none" },
  { month: 1, amountMinor: 31_500, kind: "none" },
  { month: 1, amountMinor: 6_400, kind: "none" },
  { month: 2, amountMinor: 9_750, kind: "none" },
  { month: 2, amountMinor: 15_200, kind: "none" },
  { month: 2, amountMinor: 5_600, kind: "none" },
  { month: 2, amountMinor: 22_400, kind: "none" },
  { month: 3, amountMinor: 7_300, kind: "none" },
  { month: 3, amountMinor: 18_900, kind: "none" },
  { month: 3, amountMinor: 62_000, kind: "info", captionKey: "findingSpike" },
  { month: 3, amountMinor: 11_100, kind: "none" },
  { month: 4, amountMinor: 8_450, kind: "none" },
  { month: 4, amountMinor: 26_700, kind: "none" },
  { month: 4, amountMinor: 13_300, kind: "none" },
  { month: 4, amountMinor: 5_900, kind: "none" },
  { month: 5, amountMinor: 10_200, kind: "none" },
  { month: 5, amountMinor: 34_800, kind: "none" },
  { month: 5, amountMinor: 7_650, kind: "none" },
  { month: 5, amountMinor: 19_400, kind: "none" },
  { month: 6, amountMinor: 12_050, kind: "none" },
  { month: 6, amountMinor: 4_800, kind: "none" },
  { month: 6, amountMinor: 28_600, kind: "none" },
  { month: 6, amountMinor: 16_900, kind: "info", captionKey: "findingRepeat" },
  { month: 7, amountMinor: 41_200, kind: "none" },
  { month: 7, amountMinor: 88_500, kind: "alert", captionKey: "findingTransfer" },
  { month: 7, amountMinor: 9_300, kind: "none" },
  { month: 7, amountMinor: 23_700, kind: "none" },
  { month: 7, amountMinor: 14_600, kind: "none" },
  { month: 8, amountMinor: 6_100, kind: "none" },
  { month: 8, amountMinor: 17_800, kind: "none" },
  { month: 8, amountMinor: 30_400, kind: "none" },
  { month: 8, amountMinor: 8_200, kind: "none" },
  { month: 9, amountMinor: 11_500, kind: "none" },
  { month: 9, amountMinor: 25_300, kind: "none" },
  { month: 9, amountMinor: 5_400, kind: "none" },
  { month: 9, amountMinor: 19_900, kind: "none" },
  { month: 10, amountMinor: 13_700, kind: "none" },
  { month: 10, amountMinor: 47_500, kind: "info", captionKey: "findingSubscription" },
  { month: 10, amountMinor: 7_900, kind: "none" },
  { month: 10, amountMinor: 21_600, kind: "none" },
  { month: 11, amountMinor: 9_100, kind: "none" },
  { month: 11, amountMinor: 33_200, kind: "none" },
  { month: 11, amountMinor: 15_800, kind: "none" },
  { month: 11, amountMinor: 6_700, kind: "none" },
  { month: 12, amountMinor: 24_900, kind: "none" },
  { month: 12, amountMinor: 52_100, kind: "none" },
  { month: 12, amountMinor: 10_800, kind: "none" },
  { month: 12, amountMinor: 18_300, kind: "none" },
];
