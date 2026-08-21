import { faker } from "@faker-js/faker";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions, type NewTransaction } from "@/db/schema";

export interface GenerateOptions {
  startYear?: number;
  yearsCount?: number;
  targetCount?: number;
  seed?: number;
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

/**
 * Generates an array of realistic synthetic bank transactions with intentional anomalies.
 */
export function generateYearlyTransactions(
  userId: number,
  options: GenerateOptions = {},
): NewTransaction[] {
  const startYear = options.startYear ?? 2025;
  const yearsCount = Math.max(1, Math.min(options.yearsCount ?? 1, 5));
  const targetCount = options.targetCount ?? 500;

  if (options.seed !== undefined) {
    faker.seed(options.seed);
  }

  const rows: NewTransaction[] = [];
  let seq = 1;
  const daysInMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  for (let y = 0; y < yearsCount; y++) {
    const currentYear = startYear + y;
    const monthlySalaryBase = 7200;

    // 1. Monthly Recurring Salary & Standard Inflows
    for (let month = 1; month <= 12; month++) {
      const salaryDate = formatIsoDate(currentYear, month, 25);
      const salaryAmount = (monthlySalaryBase + faker.number.int({ min: -150, max: 350 })) * 100;

      rows.push({
        userId,
        externalId: `faker-${currentYear}-${month}-salary-${seq++}`,
        bookedOn: salaryDate,
        kind: "income",
        amountMinor: salaryAmount,
        currency: "CHF",
        originalAmountMinor: salaryAmount,
        account: "Privatkonto",
        merchant: "Employer AG",
        category: "Salary",
        description: `Salärzahlung Monat ${month}/${currentYear}`,
        createdAt: new Date(),
      });

      // Regular refund
      if (month % 3 === 0) {
        const refDay = faker.number.int({ min: 5, max: 20 });
        const refAmount = faker.number.int({ min: 25, max: 180 }) * 100;
        rows.push({
          userId,
          externalId: `faker-${currentYear}-${month}-refund-${seq++}`,
          bookedOn: formatIsoDate(currentYear, month, refDay),
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

    // 2. Fixed Monthly Recurring Expenses
    for (let month = 1; month <= 12; month++) {
      // Rent
      const rentAmount = 185000;
      rows.push({
        userId,
        externalId: `faker-${currentYear}-${month}-rent-${seq++}`,
        bookedOn: formatIsoDate(currentYear, month, 1),
        kind: "expense",
        amountMinor: -rentAmount,
        currency: "CHF",
        originalAmountMinor: rentAmount,
        account: "Privatkonto",
        merchant: "Rent",
        category: "Housing",
        description: `Miete Wohnung ${month}/${currentYear}`,
        createdAt: new Date(),
      });

      // Health Insurance
      const healthAmount = 39500;
      rows.push({
        userId,
        externalId: `faker-${currentYear}-${month}-health-${seq++}`,
        bookedOn: formatIsoDate(currentYear, month, 4),
        kind: "expense",
        amountMinor: -healthAmount,
        currency: "CHF",
        originalAmountMinor: healthAmount,
        account: "Privatkonto",
        merchant: "Krankenkasse",
        category: "Health & Insurance",
        description: `Monatsprämie ${month}/${currentYear}`,
        createdAt: new Date(),
      });

      // Telecom
      const telecomAmount = 7990;
      rows.push({
        userId,
        externalId: `faker-${currentYear}-${month}-telecom-${seq++}`,
        bookedOn: formatIsoDate(currentYear, month, 10),
        kind: "expense",
        amountMinor: -telecomAmount,
        currency: "CHF",
        originalAmountMinor: telecomAmount,
        account: "Privatkonto",
        merchant: "Mobile Provider",
        category: "Utilities & Telecom",
        description: "Mobile & Internet Abo",
        createdAt: new Date(),
      });

      // Subscriptions
      rows.push({
        userId,
        externalId: `faker-${currentYear}-${month}-netflix-${seq++}`,
        bookedOn: formatIsoDate(currentYear, month, 12),
        kind: "expense",
        amountMinor: -2190,
        currency: "CHF",
        originalAmountMinor: 2190,
        account: "Privatkonto",
        merchant: "Netflix",
        category: "Subscriptions",
        description: "Netflix Premium Monat",
        createdAt: new Date(),
      });

      rows.push({
        userId,
        externalId: `faker-${currentYear}-${month}-spotify-${seq++}`,
        bookedOn: formatIsoDate(currentYear, month, 15),
        kind: "expense",
        amountMinor: -1495,
        currency: "CHF",
        originalAmountMinor: 1495,
        account: "Privatkonto",
        merchant: "Spotify",
        category: "Subscriptions",
        description: "Spotify Premium",
        createdAt: new Date(),
      });
    }

    // 3. ANOMALIES INJECTION per year
    // Anomaly Type A: Outlier high-value luxury / emergency expense (Whale spend)
    const whaleMonth = faker.number.int({ min: 2, max: 11 });
    const whaleAmountMinor = faker.number.int({ min: 4500, max: 9500 }) * 100;
    rows.push({
      userId,
      externalId: `faker-${currentYear}-anomaly-whale-${seq++}`,
      bookedOn: formatIsoDate(currentYear, whaleMonth, 14),
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

    // Anomaly Type B: Double-Charge Glitch (Duplicate transaction on same or next day)
    const dupMonth = faker.number.int({ min: 1, max: 12 });
    const dupDay = faker.number.int({ min: 1, max: 27 });
    const dupAmount = 14995;
    rows.push({
      userId,
      externalId: `faker-${currentYear}-anomaly-dup-1-${seq++}`,
      bookedOn: formatIsoDate(currentYear, dupMonth, dupDay),
      kind: "expense",
      amountMinor: -dupAmount,
      currency: "CHF",
      originalAmountMinor: dupAmount,
      account: "KK-Konto",
      merchant: "Digitec Galaxus",
      category: "Electronics",
      description: "ANOMALY: Duplicate Charge (Bank statement glitch #1)",
      createdAt: new Date(),
    });
    rows.push({
      userId,
      externalId: `faker-${currentYear}-anomaly-dup-2-${seq++}`,
      bookedOn: formatIsoDate(currentYear, dupMonth, dupDay),
      kind: "expense",
      amountMinor: -dupAmount,
      currency: "CHF",
      originalAmountMinor: dupAmount,
      account: "KK-Konto",
      merchant: "Digitec Galaxus",
      category: "Electronics",
      description: "ANOMALY: Duplicate Charge (Bank statement glitch #2)",
      createdAt: new Date(),
    });

    // Anomaly Type C: Rapid Micro-Transactions Burst (Card Testing / Fraud simulation)
    const fraudMonth = faker.number.int({ min: 1, max: 12 });
    const fraudDay = faker.number.int({ min: 1, max: 28 });
    const microAmounts = [199, 249, 499, 149, 399];
    for (const micro of microAmounts) {
      rows.push({
        userId,
        externalId: `faker-${currentYear}-anomaly-micro-${seq++}`,
        bookedOn: formatIsoDate(currentYear, fraudMonth, fraudDay),
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

    // Anomaly Type D: Rare high-risk categories (Casino / Crypto / Penalty Tax)
    const casinoMonth = faker.number.int({ min: 3, max: 10 });
    rows.push({
      userId,
      externalId: `faker-${currentYear}-anomaly-casino-${seq++}`,
      bookedOn: formatIsoDate(currentYear, casinoMonth, 18),
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

    const taxPenaltyMonth = faker.number.int({ min: 4, max: 9 });
    rows.push({
      userId,
      externalId: `faker-${currentYear}-anomaly-tax-${seq++}`,
      bookedOn: formatIsoDate(currentYear, taxPenaltyMonth, 22),
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
    const windfallMonth = faker.number.int({ min: 2, max: 11 });
    const windfallAmount = faker.number.int({ min: 10000, max: 25000 }) * 100;
    rows.push({
      userId,
      externalId: `faker-${currentYear}-anomaly-windfall-${seq++}`,
      bookedOn: formatIsoDate(currentYear, windfallMonth, 11),
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
    const subGlitchedMonth = faker.number.int({ min: 1, max: 12 });
    rows.push({
      userId,
      externalId: `faker-${currentYear}-anomaly-subshock-${seq++}`,
      bookedOn: formatIsoDate(currentYear, subGlitchedMonth, 16),
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
    const yearOffset = faker.number.int({ min: 0, max: yearsCount - 1 });
    const currentYear = startYear + yearOffset;
    const month = faker.number.int({ min: 1, max: 12 });
    const day = faker.number.int({ min: 1, max: daysInMonths[month - 1] });

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
      externalId: `faker-${currentYear}-${month}-${day}-var-${seq++}`,
      bookedOn: formatIsoDate(currentYear, month, day),
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

  // 5. Compute and add Credit Card Monthly Settlement Transfers
  for (let y = 0; y < yearsCount; y++) {
    const currentYear = startYear + y;
    for (let month = 1; month <= 12; month++) {
      const monthPrefix = `${currentYear}-${String(month).padStart(2, "0")}`;
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
          externalId: `faker-${currentYear}-${month}-transfer-${seq++}`,
          bookedOn: formatIsoDate(currentYear, month, 24),
          kind: "transfer",
          amountMinor: -kkExpensesThisMonth,
          currency: "CHF",
          originalAmountMinor: kkExpensesThisMonth,
          account: "Privatkonto",
          merchant: "Credit card payment",
          category: "Transfer",
          description: `Kreditkarten-Abrechnung ${month}/${currentYear}`,
          createdAt: new Date(),
        });
      }
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

  return { count: rows.length };
}
