"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { budgets, transactions, type Transaction } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  applyMerchantOverrides,
  merchantOverridesFor,
} from "@/lib/merchant-overrides";
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
  /**
   * Whether going over this limit should say anything. Optional, and absent
   * means yes — the same reading NULL has in the column, so a caller that
   * predates the switch keeps every warning it had.
   */
  warn: z.boolean().optional(),
});

/**
 * Rows this account owns, read as the account holder has decided they read.
 * Scoped by `userId` like every other query here, and put through the same
 * overrides as `app/actions/transactions.ts` — a merchant re-filed on
 * `/account` counts against the category it was moved *to*, or this page would
 * budget a different set of francs than the dashboard reports.
 */
async function ownedRows(userId: number): Promise<Transaction[]> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.bookedOn), asc(transactions.id));

  return applyMerchantOverrides(rows, await merchantOverridesFor(userId));
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
  // Only an explicit `false` silences anything: a row written before the
  // column existed carries NULL, which is not an opinion and still warns.
  const muted = new Set(
    saved.filter((row) => row.warnOverspend === false).map((row) => row.category),
  );

  return {
    months,
    month: requested,
    rows: requested ? budgetRows(rows, requested, limits, undefined, muted) : [],
  };
}

export type SaveBudgetsResult = { ok: true } | { ok: false; error: string };

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
 */
export async function saveBudgets(
  entries: {
    category: string;
    amount: string;
    /** Whether to warn when this category goes over. Absent means yes. */
    warn?: boolean;
  }[],
): Promise<SaveBudgetsResult> {
  const user = await getCurrentUser();
  if (!user) return budgetError("notSignedIn");

  const parsed = z.array(entrySchema).max(64).safeParse(entries);
  if (!parsed.success) return budgetError("malformed");

  const upserts: { category: string; limitMinor: number; warn: boolean }[] = [];
  const clears: string[] = [];

  for (const { category, amount, warn } of parsed.data) {
    if (amount === "") {
      // A category with no limit has no warning to configure either, so the
      // flag goes with the row rather than lingering as a setting about
      // nothing.
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
    upserts.push({ category, limitMinor, warn: warn ?? true });
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
            warnOverspend: row.warn,
            updatedAt: new Date(),
          })
          // The unique index on (user_id, category) is what makes this an
          // upsert instead of a read-then-write race.
          .onConflictDoUpdate({
            target: [budgets.userId, budgets.category],
            set: {
              limitMinor: row.limitMinor,
              warnOverspend: row.warn,
              updatedAt: new Date(),
            },
          })
          .run();
      }
    });
  } catch {
    return budgetError("saveFailed");
  }

  revalidatePath("/[locale]/budget", "page");
  // `/home` reads the same limits for the dragon's deck, and switching a
  // warning off is a change to what that page says.
  revalidatePath("/[locale]/home", "page");
  return { ok: true };
}
