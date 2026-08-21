import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions, users, type User } from "@/db/schema";
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
    const rows = generateYearlyTransactions(user1.id, { year: 2025, seed: 42 });

    expect(rows.length).toBeGreaterThan(200);

    const months = new Set(rows.map((r) => r.bookedOn.slice(0, 7)));
    expect(months.size).toBe(12);

    for (let m = 1; m <= 12; m++) {
      const monthStr = `2025-${String(m).padStart(2, "0")}`;
      expect(months.has(monthStr)).toBe(true);
    }
  });

  it("assigns valid categories, accounts, and signed minor amounts", () => {
    const rows = generateYearlyTransactions(user1.id, { year: 2025, seed: 100 });
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
      year: 2025,
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
  it("loads and classifies statements from Account 1 and Account 3 CSVs", async () => {
    const { count } = await loadDemoCsvForUser(user1.id);

    // Shipped CSVs have 513 unique transaction keys after deduplicating CC payments
    expect(count).toBe(513);

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, user1.id));

    expect(rows.length).toBe(513);

    const categories = new Set(rows.map((r) => r.category));
    expect(categories.has("Food & Drink")).toBe(true);
    expect(categories.has("Housing")).toBe(true);
    expect(categories.has("Salary")).toBe(true);
    expect(categories.has("Transport")).toBe(true);
  });
});
