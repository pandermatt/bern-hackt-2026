/**
 * The synthetic account every recorded turn was captured against. Real
 * statements would make the fixtures un-shareable and the assertions
 * unstable; these figures are chosen so each one is unmistakable in an
 * answer — no two categories round to the same franc, and none of them
 * coincides with a number in the system prompt.
 *
 * Only the fields the tools actually read are populated; the rest of
 * `Dashboard` belongs to the ledger and the calendar, which no chat turn
 * touches.
 */
import type { AnomalyOverview } from "@/app/actions/anomalies";
import type { Dashboard } from "@/app/actions/transactions";
import type { Transaction } from "@/db/schema";
import type { Slice } from "@/lib/insights";

/** Amounts are minor units (rappen), signed the way the app stores them. */
const slice = (key: string, amount: number, count: number, share: number): Slice => ({
  key,
  amount,
  count,
  share,
});

const MONTHS = [
  { month: "2025-01", label: "Jan", income: 780_000, expense: 512_340 },
  { month: "2025-02", label: "Feb", income: 780_000, expense: 489_010 },
  { month: "2025-03", label: "Mar", income: 780_000, expense: 634_255 },
  { month: "2025-04", label: "Apr", income: 812_500, expense: 501_880 },
];

export const FIXTURE_DASHBOARD = {
  facets: {
    accounts: ["Privatkonto", "Sparkonto"],
    categories: ["Wohnen", "Lebensmittel", "Transport", "Restaurants"],
    merchants: ["Immobilien AG", "Coop", "Migros", "SBB"],
    first: "2025-01-03",
    last: "2025-04-28",
  },
  totals: {
    income: 3_152_500,
    salary: 3_120_000,
    refunds: 32_500,
    expense: 2_137_485,
    expenseCount: 218,
    net: 1_015_015,
    count: 226,
  },
  categories: [
    slice("Wohnen", 1_110_000, 4, 51.9),
    slice("Lebensmittel", 542_615, 96, 25.4),
    slice("Transport", 268_870, 41, 12.6),
    slice("Restaurants", 216_000, 77, 10.1),
  ],
  merchants: [
    slice("Immobilien AG", 1_110_000, 4, 51.9),
    slice("Coop", 301_455, 52, 14.1),
    slice("SBB", 268_870, 41, 12.6),
    slice("Migros", 241_160, 44, 11.3),
  ],
  monthly: MONTHS.map((m) => ({ ...m, net: m.income - m.expense, balance: 0 })),
} as unknown as Dashboard;

let nextId = 1;
const row = (
  bookedOn: string,
  merchant: string,
  category: string,
  amountMinor: number,
): Transaction =>
  ({
    id: nextId++,
    userId: 1,
    externalId: `fix-${nextId}`,
    bookedOn,
    kind: amountMinor < 0 ? "expense" : "income",
    amountMinor,
    currency: "CHF",
    originalAmountMinor: amountMinor,
    account: "Privatkonto",
    merchant,
    category,
    description: "",
    createdAt: new Date("2025-01-01T00:00:00Z"),
  }) as unknown as Transaction;

/**
 * What the SQL sandbox and the subscription detector are seeded with. The
 * monthly rent is a deliberate four-month rhythm so `detectSubscriptions` has
 * something real to find; the rest give the weekday questions an answer.
 */
export const FIXTURE_ROWS: Transaction[] = [
  ...MONTHS.map((m) => row(`${m.month}-01`, "Immobilien AG", "Wohnen", -277_500)),
  ...MONTHS.map((m) => row(`${m.month}-15`, "Coop", "Lebensmittel", -75_364)),
  // 2025-01-08 is a Wednesday; these make Wednesday the costliest weekday.
  row("2025-01-08", "SBB", "Transport", -120_000),
  row("2025-02-05", "SBB", "Transport", -98_870),
  row("2025-03-12", "Migros", "Lebensmittel", -60_290),
  row("2025-04-09", "Migros", "Lebensmittel", -55_870),
  ...MONTHS.map((m) => row(`${m.month}-25`, "Arbeitgeber AG", "Salary", 780_000)),
];

/** No scan findings: the anomaly tool is exercised, its content is not. */
export const FIXTURE_ANOMALIES = {
  action: [],
  context: [],
  hasCompletedScan: true,
  running: false,
  outdated: false,
} as unknown as AnomalyOverview;
