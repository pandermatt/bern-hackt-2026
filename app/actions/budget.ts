"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { budgets, transactions, type Transaction } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { currentMonth } from "@/lib/clock";
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

/**
 * A limit as it now stands in the database, `null` for a category whose row was
 * deleted. The client redraws the radar from these rather than from what it
 * typed: the parse that decides what a field *means* lives in the action, so
 * echoing the stored figures back is what keeps the chart drawn from the same
 * numbers the database holds instead of from a second parse that could differ.
 */
export type SavedLimit = { category: string; limitMinor: number | null };

export type SaveBudgetsResult =
  | { ok: true; limits: SavedLimit[] }
  | { ok: false; error: string };

/**
 * Errors are phrased here, not in the component.
 *
 * The client raises whatever string it gets straight into a toast, so it has
 * to arrive already translated — the same shape `app/actions/auth.ts` uses.
 */
async function budgetError(
  key: string,
  values?: Record<string, string>,
): Promise<SaveBudgetsResult> {
  const t = await getTranslations("BudgetErrors");
  return { ok: false, error: t(key, values) };
}

/**
 * Upserts the limits the user typed and deletes the ones they cleared.
 *
 * One transaction, so a half-saved budget is not a state the page can land in.
 * The `{ ok }` envelope is the mutation contract — the client raises a toast
 * off it; reads on this page return their data directly.
 *
 * A successful save carries the limits it wrote back with it. The radar is
 * drawn from those limits, and it used to sit on the old ones until the
 * refreshed server render arrived — a second round trip after this one, and
 * long enough on a slow connection to show the chart and the inputs disagreeing
 * about the budget. This is not a read dressed up as a mutation: it is the
 * *result* of the write, which only the write knows.
 */
export async function saveBudgets(
  entries: { category: string; amount: string }[],
): Promise<SaveBudgetsResult> {
  const user = await getCurrentUser();
  if (!user) return budgetError("notSignedIn");

  const parsed = z.array(entrySchema).max(64).safeParse(entries);
  if (!parsed.success) return budgetError("malformed");

  const upserts: { category: string; limitMinor: number }[] = [];
  const clears: string[] = [];

  for (const { category, amount } of parsed.data) {
    if (amount === "") {
      clears.push(category);
      continue;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      return budgetError("notAnAmount", { amount });
    }
    // Rappen, rounded — the user types francs and half a rappen is not money.
    const limitMinor = Math.round(value * 100);
    if (limitMinor > 1_000_000_000) {
      return budgetError("tooLarge");
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
    return budgetError("saveFailed");
  }

  revalidatePath("/[locale]/budget", "page");
  // The two halves of the write, back as one list of what each category now
  // holds — a cleared field is a `null` limit here rather than a missing entry,
  // so the caller can tell "no limit" from "not in this save".
  return {
    ok: true,
    limits: [
      ...clears.map((category) => ({ category, limitMinor: null })),
      ...upserts,
    ],
  };
}
