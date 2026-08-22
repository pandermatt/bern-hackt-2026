import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions, users, type Transaction, type User } from "@/db/schema";
import { detectSubscriptions } from "@/lib/assistant";
import { hashPassword } from "@/lib/auth";
import { loadDemoCsvForUser } from "@/lib/demo-loader";
import {
  generateYearlyTransactions,
  saveGeneratedTransactionsForUser,
} from "@/lib/synthetic-generator";
import { CATEGORIES } from "@/scripts/lib/statement";

async function createUser(email: string): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("pass-123456") })
    .returning();
  return user;
}

let user1: User;
let user2: User;

beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(users);

  user1 = await createUser("user1@example.com");
  user2 = await createUser("user2@example.com");
});

describe("Synthetic Transaction Generator (Faker)", () => {
  it("generates realistic transactions spanning all 12 months", () => {
    // A year-end endDate makes the window exactly the calendar year.
    const rows = generateYearlyTransactions(user1.id, { endDate: "2025-12-31", seed: 42 });

    expect(rows.length).toBeGreaterThan(200);

    const months = new Set(rows.map((r) => r.bookedOn.slice(0, 7)));
    expect(months.size).toBe(12);

    for (let m = 1; m <= 12; m++) {
      const monthStr = `2025-${String(m).padStart(2, "0")}`;
      expect(months.has(monthStr)).toBe(true);
    }
  });

  it("scales transaction volume according to targetCount and spans multiple years", () => {
    const target500 = generateYearlyTransactions(user1.id, {
      endDate: "2024-12-31",
      yearsCount: 2,
      targetCount: 500,
      seed: 123,
    });

    expect(target500.length).toBeGreaterThanOrEqual(450);

    const years = new Set(target500.map((r) => r.bookedOn.slice(0, 4)));
    expect(years.has("2023")).toBe(true);
    expect(years.has("2024")).toBe(true);
  });

  it("books everything inside the day-exact window ending on endDate", () => {
    const rows = generateYearlyTransactions(user1.id, {
      endDate: "2026-08-22",
      yearsCount: 1,
      targetCount: 500,
      seed: 314,
    });

    for (const row of rows) {
      expect(row.bookedOn >= "2025-08-23").toBe(true);
      expect(row.bookedOn <= "2026-08-22").toBe(true);
    }
    // Both partial edge months are populated, not skipped.
    const months = new Set(rows.map((r) => r.bookedOn.slice(0, 7)));
    expect(months.has("2025-08")).toBe(true);
    expect(months.has("2026-08")).toBe(true);
  });

  it("defaults the window to ending today and never books the future", () => {
    const rows = generateYearlyTransactions(user1.id, { seed: 271 });
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    for (const row of rows) {
      expect(row.bookedOn <= today).toBe(true);
    }
  });

  it("ends the history with a positive effective account balance", () => {
    // The balance the dashboard reports: income minus expenses, transfers
    // excluded — the same sum `monthlySeries` accumulates. Dense histories are
    // the regression risk: variable spending scales with targetCount, salary
    // does not, so the solvency pass has to close the gap.
    const shapes: [number, number, number][] = [
      [42, 500, 1],
      [7, 10000, 3],
      [99, 25000, 5],
    ];
    for (const [seed, targetCount, yearsCount] of shapes) {
      const rows = generateYearlyTransactions(user1.id, {
        yearsCount,
        targetCount,
        seed,
        endDate: "2026-08-22",
      });
      const balance = rows
        .filter((r) => r.kind !== "transfer")
        .reduce((sum, r) => sum + r.amountMinor, 0);
      expect(balance).toBeGreaterThan(0);
    }
  });

  it("produces recurring charges the assistant's subscription detector finds", () => {
    // The chat's "what subscriptions do I have" proposal is only a feature if
    // the demo account actually contains detectable rhythms.
    const rows = generateYearlyTransactions(user1.id, { endDate: "2025-12-31", seed: 42 });
    const subs = detectSubscriptions(rows as Transaction[]);

    expect(subs.length).toBeGreaterThanOrEqual(2);
    const monthly = subs.filter((s) => s.cadence === "monthly");
    expect(monthly.length).toBeGreaterThanOrEqual(2);
    for (const sub of subs) {
      expect(sub.yearlyMinor).toBeGreaterThan(0);
      expect(sub.payments).toBeGreaterThanOrEqual(2);
    }
  });

  it("injects rich financial anomalies into the transaction history", () => {
    const rows = generateYearlyTransactions(user1.id, {
      endDate: "2025-12-31",
      targetCount: 500,
      seed: 777,
    });

    const anomalies = rows.filter((r) => r.description.startsWith("ANOMALY:"));
    expect(anomalies.length).toBeGreaterThanOrEqual(5);

    // Check for specific anomaly types
    const hasWhale = anomalies.some((r) => r.merchant.includes("Bucherer"));
    const hasDup = anomalies.some((r) => r.description.includes("Duplicate Charge"));
    const hasMicroBurst = anomalies.some((r) => r.description.includes("Rapid Micro-transaction"));
    const hasWindfall = anomalies.some((r) => r.merchant.includes("Swisslos"));

    expect(hasWhale).toBe(true);
    expect(hasDup).toBe(true);
    expect(hasMicroBurst).toBe(true);
    expect(hasWindfall).toBe(true);
  });

  it("assigns valid categories, accounts, and signed minor amounts", () => {
    const rows = generateYearlyTransactions(user1.id, { endDate: "2025-12-31", seed: 100 });
    const validCategories = new Set<string>(CATEGORIES);

    for (const row of rows) {
      expect(validCategories.has(row.category)).toBe(true);
      expect(["Privatkonto", "KK-Konto"]).toContain(row.account);
      expect(row.bookedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.currency).toBe("CHF");

      if (row.kind === "income") {
        expect(row.amountMinor).toBeGreaterThan(0);
      } else {
        expect(row.amountMinor).toBeLessThan(0);
      }
    }

    // Must have salary entries
    const salaries = rows.filter((r) => r.category === "Salary");
    expect(salaries.length).toBe(12);

    // Must have housing rent entries
    const rent = rows.filter((r) => r.category === "Housing");
    expect(rent.length).toBe(12);
  });

  it("persists generated transactions into the database scoped to user", async () => {
    const { count } = await saveGeneratedTransactionsForUser(user1.id, {
      endDate: "2025-12-31",
      targetCount: 250,
      seed: 999,
    });

    const user1Rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, user1.id));
    expect(user1Rows.length).toBe(count);

    // User2 should have 0 transactions
    const user2Rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, user2.id));
    expect(user2Rows.length).toBe(0);
  });
});

describe("Demo CSV Loader", () => {
  it("loads and classifies every shipped statement", async () => {
    const { count } = await loadDemoCsvForUser(user1.id);

    // Shipped CSVs have 938 unique transaction keys after deduplicating CC
    // payments, plus the prepended opening-balance row — the same set
    // `npm run seed` imports, because both importers discover the same
    // directory. This number moving in one importer but not the other is
    // exactly the drift the discovery change exists to prevent.
    expect(count).toBe(939);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, user1.id));

    expect(rows.length).toBe(939);

    const categories = new Set(rows.map((r) => r.category));
    expect(categories.has("Food & Drink")).toBe(true);
    expect(categories.has("Housing")).toBe(true);
    expect(categories.has("Salary")).toBe(true);
    expect(categories.has("Transport")).toBe(true);
  });

  it("starts the history with a CHF 20'000 opening balance", async () => {
    await loadDemoCsvForUser(user1.id);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, user1.id));

    const opening = rows.filter((r) => r.category === "Opening balance");
    expect(opening).toHaveLength(1);
    expect(opening[0].amountMinor).toBe(2_000_000);
    expect(opening[0].kind).toBe("income");

    // Booked before every statement line, so the balance starts at the figure
    // and no statement month's net carries the spike.
    const earliest = rows
      .map((r) => r.bookedOn)
      .sort()[0];
    expect(opening[0].bookedOn).toBe(earliest);
    expect(rows.every((r) => r === opening[0] || r.bookedOn > opening[0].bookedOn)).toBe(true);
  });
});
