import { faker } from "@faker-js/faker";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions, type NewTransaction } from "@/db/schema";

interface GenerateOptions {
  year?: number;
  seed?: number;
}

const MERCHANTS_BY_CATEGORY = {
  "Food & Drink": [
    { name: "Coop Supermarkt", slug: "CoopSupermarkt", accounts: ["Privatkonto", "KK-Konto"], min: 15, max: 180 },
    { name: "Migros", slug: "Migros", accounts: ["Privatkonto", "KK-Konto"], min: 12, max: 160 },
    { name: "Kantine AG", slug: "KantineAG", accounts: ["Privatkonto"], min: 11, max: 22 },
    { name: "Ristorante Luce", slug: "Ristorante_Luce", accounts: ["KK-Konto"], min: 45, max: 140 },
    { name: "Pizzeria & Grill", slug: "Pizzeria_Grill", accounts: ["KK-Konto"], min: 28, max: 85 },
    { name: "Local Bakery & Café", slug: "LocalBakery", accounts: ["Privatkonto"], min: 6, max: 24 },
  ],
  Transport: [
    { name: "SBB", slug: "SBB", accounts: ["Privatkonto", "KK-Konto"], min: 8, max: 110 },
    { name: "Libero-Tarifverbund", slug: "Libero", accounts: ["Privatkonto"], min: 14, max: 78 },
    { name: "Coop Tankstelle", slug: "CoopTankstelle", accounts: ["Privatkonto"], min: 45, max: 110 },
    { name: "Taxi Services", slug: "Taxi", accounts: ["KK-Konto"], min: 22, max: 65 },
  ],
  Clothing: [
    { name: "Zalando", slug: "Zalando", accounts: ["KK-Konto"], min: 40, max: 220 },
    { name: "H&M", slug: "H&M", accounts: ["KK-Konto"], min: 25, max: 130 },
    { name: "Manor AG", slug: "Manor_AG", accounts: ["Privatkonto", "KK-Konto"], min: 35, max: 190 },
    { name: "Nike", slug: "Nike", accounts: ["KK-Konto"], min: 60, max: 210 },
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

export function generateYearlyTransactions(
  userId: number,
  options: GenerateOptions = {},
): NewTransaction[] {
  const year = options.year ?? 2025;
  if (options.seed !== undefined) {
    faker.seed(options.seed);
  }

  const rows: NewTransaction[] = [];
  let seq = 1;

  // 1. Monthly Recurring Salary & Inflows
  const monthlySalaryBase = 7200;

  for (let month = 1; month <= 12; month++) {
    const salaryDate = formatIsoDate(year, month, 25);
    const salaryAmount = (monthlySalaryBase + faker.number.int({ min: -150, max: 350 })) * 100;
    
    rows.push({
      userId,
      externalId: `faker-${year}-${month}-salary-${seq++}`,
      bookedOn: salaryDate,
      kind: "income",
      amountMinor: salaryAmount,
      currency: "CHF",
      originalAmountMinor: salaryAmount,
      account: "Privatkonto",
      merchant: "Employer AG",
      category: "Salary",
      description: `Salärzahlung Monat ${month}/${year}`,
      createdAt: new Date(),
    });

    // Occasional refund or minor reimbursement (every 2-3 months)
    if (month % 3 === 0 || month === 7) {
      const refundDay = faker.number.int({ min: 5, max: 20 });
      const refundAmount = faker.number.int({ min: 25, max: 180 }) * 100;
      const refDate = formatIsoDate(year, month, refundDay);
      rows.push({
        userId,
        externalId: `faker-${year}-${month}-refund-${seq++}`,
        bookedOn: refDate,
        kind: "income",
        amountMinor: refundAmount,
        currency: "CHF",
        originalAmountMinor: refundAmount,
        account: "Privatkonto",
        merchant: "Zalando Retoure",
        category: "Refund",
        description: "Gutschrift Rücksendung",
        createdAt: new Date(),
      });
    }
  }

  // 2. Monthly Fixed Expenses
  for (let month = 1; month <= 12; month++) {
    // Rent on 1st
    const rentAmount = 185000;
    rows.push({
      userId,
      externalId: `faker-${year}-${month}-rent-${seq++}`,
      bookedOn: formatIsoDate(year, month, 1),
      kind: "expense",
      amountMinor: -rentAmount,
      currency: "CHF",
      originalAmountMinor: rentAmount,
      account: "Privatkonto",
      merchant: "Rent",
      category: "Housing",
      description: `Miete Wohnung ${month}/${year}`,
      createdAt: new Date(),
    });

    // Health insurance on 4th
    const healthAmount = 39500;
    rows.push({
      userId,
      externalId: `faker-${year}-${month}-health-${seq++}`,
      bookedOn: formatIsoDate(year, month, 4),
      kind: "expense",
      amountMinor: -healthAmount,
      currency: "CHF",
      originalAmountMinor: healthAmount,
      account: "Privatkonto",
      merchant: "Krankenkasse",
      category: "Health & Insurance",
      description: `Monatsprämie ${month}/${year}`,
      createdAt: new Date(),
    });

    // Utilities / Telecom on 10th
    const telecomAmount = 7990;
    rows.push({
      userId,
      externalId: `faker-${year}-${month}-telecom-${seq++}`,
      bookedOn: formatIsoDate(year, month, 10),
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

    // Subscriptions on 12th & 15th
    const netflixAmount = 2190;
    rows.push({
      userId,
      externalId: `faker-${year}-${month}-netflix-${seq++}`,
      bookedOn: formatIsoDate(year, month, 12),
      kind: "expense",
      amountMinor: -netflixAmount,
      currency: "CHF",
      originalAmountMinor: netflixAmount,
      account: "Privatkonto",
      merchant: "Netflix",
      category: "Subscriptions",
      description: "Netflix Premium Monat",
      createdAt: new Date(),
    });

    const spotifyAmount = 1495;
    rows.push({
      userId,
      externalId: `faker-${year}-${month}-spotify-${seq++}`,
      bookedOn: formatIsoDate(year, month, 15),
      kind: "expense",
      amountMinor: -spotifyAmount,
      currency: "CHF",
      originalAmountMinor: spotifyAmount,
      account: "Privatkonto",
      merchant: "Spotify",
      category: "Subscriptions",
      description: "Spotify Premium",
      createdAt: new Date(),
    });
  }

  // 3. Variable Everyday Expenses across all 12 months
  const daysInMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  for (let month = 1; month <= 12; month++) {
    const daysInMonth = daysInMonths[month - 1];
    let kkMonthlySpendMinor = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      // Probability of a transaction on any given day
      const numTxToday = faker.number.int({ min: 0, max: 3 });

      for (let t = 0; t < numTxToday; t++) {
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

        if (account === "KK-Konto") {
          kkMonthlySpendMinor += amountMinor;
        }

        const dateStr = formatIsoDate(year, month, day);

        rows.push({
          userId,
          externalId: `faker-${year}-${month}-${day}-${seq++}`,
          bookedOn: dateStr,
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
    }

    // 4. Summer and Winter Travel Expenses
    if (month === 7 || month === 8 || month === 12) {
      const travelDay = faker.number.int({ min: 10, max: 24 });
      const flightMinor = faker.number.int({ min: 280, max: 620 }) * 100;
      const hotelMinor = faker.number.int({ min: 450, max: 1100 }) * 100;

      rows.push({
        userId,
        externalId: `faker-${year}-${month}-swiss-${seq++}`,
        bookedOn: formatIsoDate(year, month, travelDay),
        kind: "expense",
        amountMinor: -flightMinor,
        currency: "CHF",
        originalAmountMinor: flightMinor,
        account: "KK-Konto",
        merchant: "SWISS",
        category: "Travel",
        description: "SWISS Flugbuchung",
        createdAt: new Date(),
      });
      kkMonthlySpendMinor += flightMinor;

      rows.push({
        userId,
        externalId: `faker-${year}-${month}-hotel-${seq++}`,
        bookedOn: formatIsoDate(year, month, travelDay + 2),
        kind: "expense",
        amountMinor: -hotelMinor,
        currency: "CHF",
        originalAmountMinor: hotelMinor,
        account: "KK-Konto",
        merchant: "AirBnB",
        category: "Travel",
        description: "Unterkunft Ferien",
        createdAt: new Date(),
      });
      kkMonthlySpendMinor += hotelMinor;
    }

    // 5. Monthly Credit Card Settlement Transfer on 24th
    if (kkMonthlySpendMinor > 0) {
      const transferDate = formatIsoDate(year, month, 24);
      rows.push({
        userId,
        externalId: `faker-${year}-${month}-transfer-${seq++}`,
        bookedOn: transferDate,
        kind: "transfer",
        amountMinor: -kkMonthlySpendMinor,
        currency: "CHF",
        originalAmountMinor: kkMonthlySpendMinor,
        account: "Privatkonto",
        merchant: "Credit card payment",
        category: "Transfer",
        description: `Kreditkarten-Abrechnung ${month}/${year}`,
        createdAt: new Date(),
      });
    }
  }

  // Sort chronological by date
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
