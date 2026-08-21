"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { budgets, transactions, type Transaction } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  budgetRows,
  defaultBudgetMonth,
  stackByCategory,
  type BudgetRow,
} from "@/lib/insights";

export type BudgetOverview = {
  /** Every month the statements cover, ascending. */
  months: string[];
  /** The month being viewed. Null when there is nothing imported yet. */
  month: string | null;
  rows: BudgetRow[];
};

/**
 * A limit is a positive amount in **major** units as typed by the user, capped
 * at a number SQLite stores exactly. Blank means "no limit for this category",
 * which deletes the row rather than storing a zero — zero is a real budget of
 * nothing, and the two must not collapse into each other.
 */
const entrySchema = z.object({
  category: z.string().trim().min(1).max(40),
  amount: z
    .string()
    .trim()
    .transform((value) => value.replace(/[’'\s]/g, "").replace(",", ".")),
});

/** Rows this account owns. Scoped by `userId` like every other query here. */
async function ownedRows(userId: number): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.bookedOn), asc(transactions.id));
}

/** "2026-08" for the server's today. Kept out of `lib/insights.ts`, which
 *  never constructs a `Date`. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function getBudgetOverview(
  rawMonth?: string,
): Promise<BudgetOverview | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const rows = await ownedRows(user.id);
  const { months } = stackByCategory(rows);

  // A junk month in the URL renders the default, not an empty page.
  const requested =
    rawMonth && months.includes(rawMonth)
      ? rawMonth
      : defaultBudgetMonth(months, currentMonth());

  const saved = await db
    .select()
    .from(budgets)
    .where(eq(budgets.userId, user.id));
  const limits = new Map(saved.map((row) => [row.category, row.limitMinor]));

  return {
    months,
    month: requested,
    rows: requested ? budgetRows(rows, requested, limits) : [],
  };
}

export type SaveBudgetsResult = { ok: true } | { ok: false; error: string };

/**
 * Upserts the limits the user typed and deletes the ones they cleared.
 *
 * One transaction, so a half-saved budget is not a state the page can land in.
 * The `{ ok }` envelope is the mutation contract — the client raises a toast
 * off it; reads on this page return their data directly.
 */
export async function saveBudgets(
  entries: { category: string; amount: string }[],
): Promise<SaveBudgetsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to set a budget." };

  const parsed = z.array(entrySchema).max(64).safeParse(entries);
  if (!parsed.success) return { ok: false, error: "That budget looks malformed." };

  const upserts: { category: string; limitMinor: number }[] = [];
  const clears: string[] = [];

  for (const { category, amount } of parsed.data) {
    if (amount === "") {
      clears.push(category);
      continue;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: `“${amount}” is not an amount.` };
    }
    // Rappen, rounded — the user types francs and half a rappen is not money.
    const limitMinor = Math.round(value * 100);
    if (limitMinor > 1_000_000_000) {
      return { ok: false, error: "That limit is larger than this app can hold." };
    }
    upserts.push({ category, limitMinor });
  }

  try {
    db.transaction((tx) => {
      if (clears.length > 0) {
        tx.delete(budgets)
          .where(
            and(
              eq(budgets.userId, user.id),
              inArray(budgets.category, clears),
            ),
          )
          .run();
      }
      for (const row of upserts) {
        tx.insert(budgets)
          .values({
            userId: user.id,
            category: row.category,
            limitMinor: row.limitMinor,
            updatedAt: new Date(),
          })
          // The unique index on (user_id, category) is what makes this an
          // upsert instead of a read-then-write race.
          .onConflictDoUpdate({
            target: [budgets.userId, budgets.category],
            set: { limitMinor: row.limitMinor, updatedAt: new Date() },
          })
          .run();
      }
    });
  } catch {
    return { ok: false, error: "Could not save that budget. Try again." };
  }

  revalidatePath("/budget");
  return { ok: true };
}
