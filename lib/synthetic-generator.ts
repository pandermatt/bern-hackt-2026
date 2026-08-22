import { faker } from "@faker-js/faker";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions, type NewTransaction } from "@/db/schema";
import { rebindAnomalies } from "@/lib/anomaly-sync";

export interface GenerateOptions {
  /** How many years the window covers, counting back from `endDate`. 1–5. */
  yearsCount?: number;
  targetCount?: number;
  seed?: number;
  /**
   * ISO `YYYY-MM-DD` the window ends on (inclusive). Defaults to today, so a
   * fresh generation always runs right up to the present and never into the
   * future. Tests pin it to keep assertions date-independent.
   */
  endDate?: string;
}

const MERCHANTS_BY_CATEGORY: Record<
  string,
  { name: string; slug: string; accounts: string[]; min: number; max: number }[]
> = {
  "Food & Drink": [
    { name: "Coop Supermarkt", slug: "CoopSupermarkt", accounts: ["Privatkonto", "KK-Konto"], min: 15, max: 180 },
    { name: "Migros", slug: "Migros", accounts: ["Privatkonto", "KK-Konto"], min: 12, max: 160 },
    { name: "Kantine AG", slug: "KantineAG", accounts: ["Privatkonto"], min: 11, max: 24 },
    { name: "Ristorante Luce", slug: "Ristorante_Luce", accounts: ["KK-Konto"], min: 45, max: 160 },
    { name: "Pizzeria & Grill", slug: "Pizzeria_Grill", accounts: ["KK-Konto"], min: 28, max: 85 },
    { name: "Local Bakery & Café", slug: "LocalBakery", accounts: ["Privatkonto"], min: 6, max: 24 },
    { name: "Starbucks Coffee", slug: "Starbucks", accounts: ["KK-Konto"], min: 8, max: 28 },
  ],
  Transport: [
    { name: "SBB", slug: "SBB", accounts: ["Privatkonto", "KK-Konto"], min: 8, max: 110 },
    { name: "Libero-Tarifverbund", slug: "Libero", accounts: ["Privatkonto"], min: 14, max: 78 },
    { name: "Coop Tankstelle", slug: "CoopTankstelle", accounts: ["Privatkonto"], min: 45, max: 110 },
    { name: "Taxi Services", slug: "Taxi", accounts: ["KK-Konto"], min: 22, max: 65 },
    { name: "Uber B.V.", slug: "Uber", accounts: ["KK-Konto"], min: 18, max: 55 },
  ],
  Clothing: [
    { name: "Zalando", slug: "Zalando", accounts: ["KK-Konto"], min: 40, max: 240 },
    { name: "H&M", slug: "H&M", accounts: ["KK-Konto"], min: 25, max: 130 },
    { name: "Manor AG", slug: "Manor_AG", accounts: ["Privatkonto", "KK-Konto"], min: 35, max: 190 },
    { name: "Nike", slug: "Nike", accounts: ["KK-Konto"], min: 60, max: 210 },
    { name: "Globus", slug: "Globus", accounts: ["KK-Konto"], min: 75, max: 380 },
  ],
  Electronics: [
    { name: "Digitec Galaxus", slug: "Digitec_Galaxus", accounts: ["KK-Konto", "Privatkonto"], min: 35, max: 480 },
    { name: "Apple Online Store", slug: "Apple_Online_Store", accounts: ["KK-Konto"], min: 29, max: 350 },
    { name: "MediaMarkt", slug: "Mediamarkt_AG", accounts: ["Privatkonto"], min: 25, max: 290 },
  ],
  "Sports & Leisure": [
    { name: "Ochsner Sport", slug: "OchsnerSport", accounts: ["Privatkonto", "KK-Konto"], min: 30, max: 180 },
    { name: "Veloshop", slug: "Veloshop", accounts: ["Privatkonto"], min: 25, max: 160 },
    { name: "Gurten Festival", slug: "GurtenFestival", accounts: ["KK-Konto"], min: 80, max: 220 },
    { name: "Fitnesspark", slug: "Fitnesspark", accounts: ["Privatkonto"], min: 90, max: 140 },
  ],
  Marketplace: [
    { name: "Amazon", slug: "Amazon", accounts: ["KK-Konto"], min: 15, max: 150 },
    { name: "PayPal", slug: "Paypal", accounts: ["Privatkonto"], min: 10, max: 95 },
  ],
  "Home & Office": [
    { name: "Die Post", slug: "Post", accounts: ["Privatkonto"], min: 8, max: 45 },
    { name: "IKEA", slug: "IKEA", accounts: ["KK-Konto"], min: 40, max: 320 },
  ],
  "Books & Media": [
    { name: "Orell Füssli", slug: "OrellFuessli", accounts: ["Privatkonto", "KK-Konto"], min: 18, max: 65 },
  ],
};

function formatIsoDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/** Leap-aware. `month` is 1-based; day 0 of the next month is this month's last. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function todayIso(): string {
  const now = new Date();
  return formatIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * One calendar month of the generation window. The first and last month are
 * usually partial — the window runs day-exact from `endDate` backwards — so
 * every date the generator books has to fall inside `[minDay, maxDay]`.
 */
type MonthWindow = { year: number; month: number; minDay: number; maxDay: number };

/**
 * The window as a list of calendar months, oldest first: `yearsCount` years,
 * ending on `endIso` inclusive. Ending 2026-08-22 with one year runs
 * 2025-08-23 → 2026-08-22 — thirteen calendar months, two of them partial.
 */
function buildWindows(endIso: string, yearsCount: number): MonthWindow[] {
  const [endYear, endMonth, endDay] = endIso.split("-").map(Number);
  // Day-exact start: same day-of-month `yearsCount` years back, plus one day.
  // Date arithmetic absorbs the edges (a Feb 29 that has no earlier twin, a
  // start day past the month's end).
  const start = new Date(Date.UTC(endYear - yearsCount, endMonth - 1, endDay));
  start.setUTCDate(start.getUTCDate() + 1);
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const startDay = start.getUTCDate();

  const windows: MonthWindow[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    windows.push({
      year,
      month,
      minDay: year === startYear && month === startMonth ? startDay : 1,
      maxDay: year === endYear && month === endMonth ? endDay : daysInMonth(year, month),
    });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return windows;
}

/**
 * Generates realistic synthetic bank transactions with intentional anomalies,
 * covering the `yearsCount` years that end on `endDate` (today by default) —
 * so the history always reaches the present and never runs past it.
 */
export function generateYearlyTransactions(
  userId: number,
  options: GenerateOptions = {},
): NewTransaction[] {
  const yearsCount = Math.max(1, Math.min(options.yearsCount ?? 1, 5));
  const targetCount = Math.max(0, Math.min(options.targetCount ?? 500, 50000));
  const endIso = /^\d{4}-\d{2}-\d{2}$/.test(options.endDate ?? "")
    ? (options.endDate as string)
    : todayIso();

  if (options.seed !== undefined) {
    faker.seed(options.seed);
  }

  const windows = buildWindows(endIso, yearsCount);
  const rows: NewTransaction[] = [];
  let seq = 1;

  /** A day inside both the wanted range and the window, or null if they miss —
   * a fixed booking day can fall outside a partial first or last month. */
  const dayWithin = (w: MonthWindow, min: number, max: number): number | null => {
    const lo = Math.max(min, w.minDay);
    const hi = Math.min(max, w.maxDay);
    return lo > hi ? null : faker.number.int({ min: lo, max: hi });
  };
  const hasDay = (w: MonthWindow, day: number): boolean =>
    day >= w.minDay && day <= w.maxDay;
  const pickWindow = (): MonthWindow => faker.helpers.arrayElement(windows);

  const monthlySalaryBase = 7200;

  for (const w of windows) {
    // 1. Monthly Recurring Salary & Standard Inflows
    if (hasDay(w, 25)) {
      const salaryAmount =
        (monthlySalaryBase + faker.number.int({ min: -150, max: 350 })) * 100;
      rows.push({
        userId,
        externalId: `faker-${w.year}-${w.month}-salary-${seq++}`,
        bookedOn: formatIsoDate(w.year, w.month, 25),
        kind: "income",
        amountMinor: salaryAmount,
        currency: "CHF",
        originalAmountMinor: salaryAmount,
        account: "Privatkonto",
        merchant: "Employer AG",
        category: "Salary",
        description: `Salärzahlung Monat ${w.month}/${w.year}`,
        createdAt: new Date(),
      });
    }

    // Regular refund every third calendar month
    if (w.month % 3 === 0) {
      const refDay = dayWithin(w, 5, 20);
      if (refDay !== null) {
        const refAmount = faker.number.int({ min: 25, max: 180 }) * 100;
        rows.push({
          userId,
          externalId: `faker-${w.year}-${w.month}-refund-${seq++}`,
          bookedOn: formatIsoDate(w.year, w.month, refDay),
          kind: "income",
          amountMinor: refAmount,
          currency: "CHF",
          originalAmountMinor: refAmount,
          account: "Privatkonto",
          merchant: "Zalando Retoure",
          category: "Refund",
          description: "Gutschrift Rücksendung",
          createdAt: new Date(),
        });
      }
    }

    // 2. Fixed Monthly Recurring Expenses — each on its usual booking day,
    // skipped when that day falls outside a partial first or last month.
    const recurring: {
      day: number;
      key: string;
      amountMinor: number;
      merchant: string;
      category: string;
      description: string;
    }[] = [
      { day: 1, key: "rent", amountMinor: 185000, merchant: "Rent", category: "Housing", description: `Miete Wohnung ${w.month}/${w.year}` },
      { day: 4, key: "health", amountMinor: 39500, merchant: "Krankenkasse", category: "Health & Insurance", description: `Monatsprämie ${w.month}/${w.year}` },
      { day: 10, key: "telecom", amountMinor: 7990, merchant: "Mobile Provider", category: "Utilities & Telecom", description: "Mobile & Internet Abo" },
      { day: 12, key: "netflix", amountMinor: 2190, merchant: "Netflix", category: "Subscriptions", description: "Netflix Premium Monat" },
      { day: 15, key: "spotify", amountMinor: 1495, merchant: "Spotify", category: "Subscriptions", description: "Spotify Premium" },
    ];
    for (const item of recurring) {
      if (!hasDay(w, item.day)) continue;
      rows.push({
        userId,
        externalId: `faker-${w.year}-${w.month}-${item.key}-${seq++}`,
        bookedOn: formatIsoDate(w.year, w.month, item.day),
        kind: "expense",
        amountMinor: -item.amountMinor,
        currency: "CHF",
        originalAmountMinor: item.amountMinor,
        account: "Privatkonto",
        merchant: item.merchant,
        category: item.category,
        description: item.description,
        createdAt: new Date(),
      });
    }
  }

  // 3. ANOMALIES INJECTION — one set per year of window, each landing on a
  // random month (and a day that month actually covers).
  for (let y = 0; y < yearsCount; y++) {
    // Anomaly Type A: Outlier high-value luxury / emergency expense (Whale spend)
    const whale = pickWindow();
    const whaleDay = dayWithin(whale, whale.minDay, whale.maxDay) as number;
    const whaleAmountMinor = faker.number.int({ min: 4500, max: 9500 }) * 100;
    rows.push({
      userId,
      externalId: `faker-${whale.year}-anomaly-whale-${seq++}`,
      bookedOn: formatIsoDate(whale.year, whale.month, whaleDay),
      kind: "expense",
      amountMinor: -whaleAmountMinor,
      currency: "CHF",
      originalAmountMinor: whaleAmountMinor,
      account: "KK-Konto",
      merchant: "Bucherer Luxury Watches",
      category: "Clothing",
      description: "ANOMALY: Outlier Luxury Purchase - High Value",
      createdAt: new Date(),
    });

    // Anomaly Type B: Double-Charge Glitch (Duplicate transaction, same day)
    const dup = pickWindow();
    const dupDay = dayWithin(dup, dup.minDay, dup.maxDay) as number;
    const dupAmount = 14995;
    for (const glitch of [1, 2]) {
      rows.push({
        userId,
        externalId: `faker-${dup.year}-anomaly-dup-${glitch}-${seq++}`,
        bookedOn: formatIsoDate(dup.year, dup.month, dupDay),
        kind: "expense",
        amountMinor: -dupAmount,
        currency: "CHF",
        originalAmountMinor: dupAmount,
        account: "KK-Konto",
        merchant: "Digitec Galaxus",
        category: "Electronics",
        description: `ANOMALY: Duplicate Charge (Bank statement glitch #${glitch})`,
        createdAt: new Date(),
      });
    }

    // Anomaly Type C: Rapid Micro-Transactions Burst (Card Testing / Fraud simulation)
    const fraud = pickWindow();
    const fraudDay = dayWithin(fraud, fraud.minDay, fraud.maxDay) as number;
    const microAmounts = [199, 249, 499, 149, 399];
    for (const micro of microAmounts) {
      rows.push({
        userId,
        externalId: `faker-${fraud.year}-anomaly-micro-${seq++}`,
        bookedOn: formatIsoDate(fraud.year, fraud.month, fraudDay),
        kind: "expense",
        amountMinor: -micro,
        currency: "CHF",
        originalAmountMinor: micro,
        account: "KK-Konto",
        merchant: "Unknown Digital Merchant UK",
        category: "Subscriptions",
        description: "ANOMALY: Rapid Micro-transaction burst (Fraud pattern)",
        createdAt: new Date(),
      });
    }

    // Anomaly Type D: Rare high-risk categories (Casino / Penalty Tax)
    const casino = pickWindow();
    rows.push({
      userId,
      externalId: `faker-${casino.year}-anomaly-casino-${seq++}`,
      bookedOn: formatIsoDate(
        casino.year,
        casino.month,
        dayWithin(casino, casino.minDay, casino.maxDay) as number,
      ),
      kind: "expense",
      amountMinor: -125000,
      currency: "CHF",
      originalAmountMinor: 125000,
      account: "KK-Konto",
      merchant: "Swiss Casinos Interlaken",
      category: "Sports & Leisure",
      description: "ANOMALY: High-risk entertainment spike",
      createdAt: new Date(),
    });

    const tax = pickWindow();
    rows.push({
      userId,
      externalId: `faker-${tax.year}-anomaly-tax-${seq++}`,
      bookedOn: formatIsoDate(
        tax.year,
        tax.month,
        dayWithin(tax, tax.minDay, tax.maxDay) as number,
      ),
      kind: "expense",
      amountMinor: -348000,
      currency: "CHF",
      originalAmountMinor: 348000,
      account: "Privatkonto",
      merchant: "Steuerverwaltung",
      category: "Taxes & Fees",
      description: "ANOMALY: Unexpected Tax Adjustment & Surcharge",
      createdAt: new Date(),
    });

    // Anomaly Type E: Sudden Large Windfall Inflow (Lottery or Insurance payout)
    const windfall = pickWindow();
    const windfallAmount = faker.number.int({ min: 10000, max: 25000 }) * 100;
    rows.push({
      userId,
      externalId: `faker-${windfall.year}-anomaly-windfall-${seq++}`,
      bookedOn: formatIsoDate(
        windfall.year,
        windfall.month,
        dayWithin(windfall, windfall.minDay, windfall.maxDay) as number,
      ),
      kind: "income",
      amountMinor: windfallAmount,
      currency: "CHF",
      originalAmountMinor: windfallAmount,
      account: "Privatkonto",
      merchant: "Swisslos Interkantonale Lotterie",
      category: "Refund",
      description: "ANOMALY: Outlier Income Windfall - Swisslos Prize",
      createdAt: new Date(),
    });

    // Anomaly Type F: Subscription Price Shock (10x billing glitch)
    const shock = pickWindow();
    rows.push({
      userId,
      externalId: `faker-${shock.year}-anomaly-subshock-${seq++}`,
      bookedOn: formatIsoDate(
        shock.year,
        shock.month,
        dayWithin(shock, shock.minDay, shock.maxDay) as number,
      ),
      kind: "expense",
      amountMinor: -21900,
      currency: "CHF",
      originalAmountMinor: 21900,
      account: "Privatkonto",
      merchant: "Netflix",
      category: "Subscriptions",
      description: "ANOMALY: Subscription Billing Shock (10x erroneous charge)",
      createdAt: new Date(),
    });
  }

  // 4. Fill with Everyday Variable Expenses until reaching targetCount
  const fixedCount = rows.length;
  const remainingNeeded = Math.max(0, targetCount - fixedCount);

  for (let i = 0; i < remainingNeeded; i++) {
    const w = pickWindow();
    const day = faker.number.int({ min: w.minDay, max: w.maxDay });

    const categoryKey = faker.helpers.arrayElement(
      Object.keys(MERCHANTS_BY_CATEGORY) as (keyof typeof MERCHANTS_BY_CATEGORY)[],
    );
    const merchantList = MERCHANTS_BY_CATEGORY[categoryKey];
    const merchantObj = faker.helpers.arrayElement(merchantList);

    const amountChf = faker.number.float({
      min: merchantObj.min,
      max: merchantObj.max,
      fractionDigits: 2,
    });
    const amountMinor = Math.round(amountChf * 100);
    const account = faker.helpers.arrayElement(merchantObj.accounts);

    rows.push({
      userId,
      externalId: `faker-${w.year}-${w.month}-${day}-var-${seq++}`,
      bookedOn: formatIsoDate(w.year, w.month, day),
      kind: "expense",
      amountMinor: -amountMinor,
      currency: "CHF",
      originalAmountMinor: amountMinor,
      account,
      merchant: merchantObj.name,
      category: categoryKey,
      description: `Einkauf ${merchantObj.name}`,
      createdAt: new Date(),
    });
  }

  // 5. Compute and add Credit Card Monthly Settlement Transfers. A month whose
  // window ends before the 24th (the partial month "today" sits in) gets no
  // settlement — that statement has not been billed yet.
  for (const w of windows) {
    if (!hasDay(w, 24)) continue;
    const monthPrefix = `${w.year}-${String(w.month).padStart(2, "0")}`;
    const kkExpensesThisMonth = rows
      .filter(
        (r) =>
          r.bookedOn.startsWith(monthPrefix) &&
          r.account === "KK-Konto" &&
          r.kind === "expense",
      )
      .reduce((sum, r) => sum + Math.abs(r.amountMinor), 0);

    if (kkExpensesThisMonth > 0) {
      rows.push({
        userId,
        externalId: `faker-${w.year}-${w.month}-transfer-${seq++}`,
        bookedOn: formatIsoDate(w.year, w.month, 24),
        kind: "transfer",
        amountMinor: -kkExpensesThisMonth,
        currency: "CHF",
        originalAmountMinor: kkExpensesThisMonth,
        account: "Privatkonto",
        merchant: "Credit card payment",
        category: "Transfer",
        description: `Kreditkarten-Abrechnung ${w.month}/${w.year}`,
        createdAt: new Date(),
      });
    }
  }

  // 6. Solvency pass: the effective account balance — the running sum of
  // income minus expenses, transfers excluded, exactly as `monthlySeries`
  // computes it — must end positive. The variable spending scales with
  // `targetCount` while the salary does not, so a dense history would
  // otherwise sink ever deeper into the red. Raising every salary by the same
  // rounded amount keeps the pay realistic (the per-month jitter survives)
  // and lands the history at a ~6% savings rate instead of a deficit.
  const totalIncome = rows
    .filter((r) => r.kind === "income")
    .reduce((sum, r) => sum + r.amountMinor, 0);
  const totalExpense = rows
    .filter((r) => r.kind === "expense")
    .reduce((sum, r) => sum + Math.abs(r.amountMinor), 0);
  const salaries = rows.filter((r) => r.category === "Salary");
  const shortfall = Math.ceil(totalExpense * 1.06) - totalIncome;
  if (shortfall > 0 && salaries.length > 0) {
    // Whole francs per salary, rounded up so the balance clears zero.
    const raise = Math.ceil(shortfall / salaries.length / 100) * 100;
    for (const salary of salaries) {
      salary.amountMinor += raise;
      salary.originalAmountMinor = salary.amountMinor;
    }
  }

  // Sort chronologically by date
  return rows.sort((a, b) => a.bookedOn.localeCompare(b.bookedOn));
}

/**
 * Saves generated transactions for the user, replacing existing rows.
 */
export async function saveGeneratedTransactionsForUser(
  userId: number,
  options: GenerateOptions = {},
): Promise<{ count: number }> {
  const rows = generateYearlyTransactions(userId, options);

  db.delete(transactions).where(eq(transactions.userId, userId)).run();

  for (let i = 0; i < rows.length; i += 100) {
    db.insert(transactions).values(rows.slice(i, i + 100)).run();
  }

  /*
   * The ids just changed, so every stored finding now points at nothing.
   * Re-point the ones whose statement line came back and drop the rest --
   * without this a scan is voided by every import. Different data here means
   * nothing matches and everything is dropped, which is the honest outcome:
   * those findings describe statements that no longer exist.
   */
  rebindAnomalies(db, userId);

  return { count: rows.length };
}
