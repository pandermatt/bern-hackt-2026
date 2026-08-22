"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  savingsAllocations,
  savingsGoals,
  transactions,
  type Transaction,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { currentMonth, monthHasEnded } from "@/lib/clock";
import {
  defaultBudgetMonth,
  monthSurplus,
  monthlySeries,
  potSlot,
  stackByCategory,
  type SavingsPot,
} from "@/lib/insights";

/**
 * The Sparziele half of the budget page.
 *
 * Two questions, answered together because they only make sense together:
 * what the pots hold, and how much of the viewed month is still unclaimed.
 * The second is what the first gets filled from.
 */
export type SavingsOverview = {
  month: string | null;
  /** Whether the month is over. A running month has no final surplus. */
  monthEnded: boolean;
  /**
   * Income the month did not spend, or `null` while it is still running.
   * Zero is a real answer — the month spent everything it earned.
   */
  surplusMinor: number | null;
  /** Already put away out of that month. */
  allocatedMinor: number;
  /** Surplus minus what is already allocated. Never negative. */
  freeMinor: number;
  pots: SavingsPot[];
};

export type SavingsResult = { ok: true } | { ok: false; error: string };

/** Larger than this and SQLite stops holding the integer exactly. */
const MAX_MINOR = 1_000_000_000;

/**
 * An amount as the user typed it — Swiss thousands separators and a comma
 * decimal are both normal here, and neither should be a validation error.
 */
const amountSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[’'\s]/g, "").replace(",", "."));

const goalSchema = z.object({
  name: z.string().trim().min(1).max(60),
  amount: amountSchema,
});

const allocationSchema = z.object({
  goalId: z.number().int().positive(),
  amount: amountSchema,
});

/**
 * Errors are phrased here, not in the component.
 *
 * The client raises whatever string it gets straight into a toast, so it has
 * to arrive already translated — the same shape `app/actions/auth.ts` uses.
 */
async function savingsError(
  key: string,
  values?: Record<string, string>,
): Promise<SavingsResult> {
  const t = await getTranslations("SavingsErrors");
  return { ok: false, error: t(key, values) };
}

/**
 * Major units as typed → rappen, or the *key* of what was wrong.
 *
 * A key rather than a sentence: this is called from four actions, and phrasing
 * the message here would mean reaching for a translator in a helper that is
 * otherwise pure. The callers hand the key to `savingsError`.
 */
type AmountProblem = { key: "notAnAmount"; amount: string } | { key: "tooLarge" };

function toMinor(amount: string): number | AmountProblem {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return { key: "notAnAmount", amount };
  const minor = Math.round(value * 100);
  if (minor > MAX_MINOR) return { key: "tooLarge" };
  return minor;
}

/** The `toMinor` failure branch, as a translated result. */
function amountError(problem: AmountProblem): Promise<SavingsResult> {
  return savingsError(
    problem.key,
    problem.key === "notAnAmount" ? { amount: problem.amount } : undefined,
  );
}

/** Rows this account owns. Scoped by `userId` like every other query here. */
async function ownedRows(userId: number): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.bookedOn), asc(transactions.id));
}

export async function getSavingsOverview(
  rawMonth?: string,
): Promise<SavingsOverview | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const rows = await ownedRows(user.id);
  const { months } = stackByCategory(rows);

  // Resolved the same way the budget half resolves it, so both halves of the
  // page are always looking at the same month.
  const month =
    rawMonth && months.includes(rawMonth)
      ? rawMonth
      : defaultBudgetMonth(months, currentMonth());

  const [goals, allocations] = await Promise.all([
    db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.userId, user.id))
      .orderBy(asc(savingsGoals.id)),
    db
      .select()
      .from(savingsAllocations)
      .where(eq(savingsAllocations.userId, user.id)),
  ]);

  // One pass over every allocation rather than a query per pot: an account has
  // a handful of goals and a few dozen rows, and this is the same "fetch once,
  // aggregate in JavaScript" trade the dashboard makes.
  const saved = new Map<number, number>();
  const thisMonth = new Map<number, number>();
  for (const row of allocations) {
    saved.set(row.goalId, (saved.get(row.goalId) ?? 0) + row.amountMinor);
    if (month && row.month === month) {
      thisMonth.set(row.goalId, (thisMonth.get(row.goalId) ?? 0) + row.amountMinor);
    }
  }

  const monthEnded = month !== null && monthHasEnded(month);
  const surplusMinor = month
    ? monthSurplus(monthlySeries(rows), month, monthEnded)
    : null;
  const allocatedMinor = [...thisMonth.values()].reduce(
    (sum, amount) => sum + amount,
    0,
  );

  return {
    month,
    monthEnded,
    surplusMinor,
    allocatedMinor,
    freeMinor: Math.max(0, (surplusMinor ?? 0) - allocatedMinor),
    pots: goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      targetMinor: goal.targetMinor,
      savedMinor: saved.get(goal.id) ?? 0,
      monthMinor: thisMonth.get(goal.id) ?? 0,
      slot: potSlot(goal.id),
    })),
  };
}

export async function createSavingsGoal(
  name: string,
  amount: string,
): Promise<SavingsResult> {
  const user = await getCurrentUser();
  if (!user) return savingsError("notSignedInCreate");

  const parsed = goalSchema.safeParse({ name, amount });
  if (!parsed.success) return savingsError("malformedGoal");

  const target = toMinor(parsed.data.amount);
  if (typeof target !== "number") return amountError(target);
  if (target <= 0) return savingsError("targetAboveZero");

  try {
    await db
      .insert(savingsGoals)
      .values({ userId: user.id, name: parsed.data.name, targetMinor: target });
  } catch {
    // The unique index on (user_id, name) is the only thing that realistically
    // fails here, and it fails for a reason worth naming.
    return savingsError("duplicateName", { name: parsed.data.name });
  }

  revalidatePath("/[locale]/budget", "page");
  return { ok: true };
}

/**
 * Changes a goal's target.
 *
 * Only the target. The name stays fixed because it is what picks the pot's
 * glyph — renaming would silently repaint the card, and there is no icon
 * column to override that with. Delete and re-add is the honest way to change
 * what a goal *is*.
 *
 * A new target below what is already saved is allowed: the pot simply reads
 * over 100%, which is a truthful thing for it to say. Money is never thrown
 * away to make a number fit.
 */
export async function updateSavingsGoal(
  goalId: number,
  amount: string,
): Promise<SavingsResult> {
  const user = await getCurrentUser();
  if (!user) return savingsError("notSignedInEdit");

  const parsed = amountSchema.safeParse(amount);
  if (!parsed.success) return savingsError("malformedTarget");

  const target = toMinor(parsed.data);
  if (typeof target !== "number") return amountError(target);
  if (target <= 0) return savingsError("targetAboveZero");

  const changed = await db
    .update(savingsGoals)
    .set({ targetMinor: target })
    // Scoped by owner as well as id: the id alone would let anyone retarget
    // anyone's goal by guessing a number.
    .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, user.id)))
    .returning({ id: savingsGoals.id });

  if (changed.length === 0) {
    return savingsError("goalGone");
  }

  revalidatePath("/[locale]/budget", "page");
  return { ok: true };
}

/**
 * Deletes a goal and, by cascade, everything ever allocated to it.
 *
 * That money returns to its months: the surplus a month had is a property of
 * the statements, so deleting the pot it went into frees it up again rather
 * than losing it.
 */
export async function deleteSavingsGoal(goalId: number): Promise<SavingsResult> {
  const user = await getCurrentUser();
  if (!user) return savingsError("notSignedInDelete");

  await db
    .delete(savingsGoals)
    // Scoped by owner as well as id: the id alone would let anyone delete
    // anyone's goal by guessing a number.
    .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, user.id)));

  revalidatePath("/[locale]/budget", "page");
  return { ok: true };
}

/**
 * Spreads a finished month's leftover money across the pots.
 *
 * The month's surplus is recomputed here rather than trusted from the client —
 * it is the one number that bounds the whole operation, and a client that
 * posts its own ceiling has no ceiling. Everything lands in one transaction so
 * a half-allocated month is not a state the page can show.
 */
export async function allocateSurplus(
  month: string,
  entries: { goalId: number; amount: string }[],
): Promise<SavingsResult> {
  const user = await getCurrentUser();
  if (!user) return savingsError("notSignedInAllocate");

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return savingsError("notAMonth");
  }
  if (!monthHasEnded(month)) {
    return savingsError("monthRunning");
  }

  const parsed = z.array(allocationSchema).max(64).safeParse(entries);
  if (!parsed.success) return savingsError("malformedAllocation");

  const rows = await ownedRows(user.id);
  const surplus = monthSurplus(monthlySeries(rows), month, true) ?? 0;

  // Only this account's goals, so a posted id cannot fund someone else's pot.
  const goals = await db
    .select({ id: savingsGoals.id })
    .from(savingsGoals)
    .where(eq(savingsGoals.userId, user.id));
  const owned = new Set(goals.map((goal) => goal.id));

  const upserts: { goalId: number; amountMinor: number }[] = [];
  const clears: number[] = [];
  let total = 0;

  for (const entry of parsed.data) {
    if (!owned.has(entry.goalId)) {
      return savingsError("goalGone");
    }
    if (entry.amount === "") {
      clears.push(entry.goalId);
      continue;
    }
    const minor = toMinor(entry.amount);
    if (typeof minor !== "number") return amountError(minor);
    // Zero and blank mean the same thing here — unlike a budget, where zero is
    // a real limit of nothing. No contribution is no row.
    if (minor === 0) {
      clears.push(entry.goalId);
      continue;
    }
    total += minor;
    upserts.push({ goalId: entry.goalId, amountMinor: minor });
  }

  if (total > surplus) return savingsError("overSurplus");

  try {
    db.transaction((tx) => {
      if (clears.length > 0) {
        tx.delete(savingsAllocations)
          .where(
            and(
              eq(savingsAllocations.userId, user.id),
              eq(savingsAllocations.month, month),
              inArray(savingsAllocations.goalId, clears),
            ),
          )
          .run();
      }
      for (const row of upserts) {
        tx.insert(savingsAllocations)
          .values({
            userId: user.id,
            goalId: row.goalId,
            month,
            amountMinor: row.amountMinor,
            updatedAt: new Date(),
          })
          // The unique index on (goal_id, month) is what makes revising an
          // allocation an upsert rather than a duplicate row.
          .onConflictDoUpdate({
            target: [savingsAllocations.goalId, savingsAllocations.month],
            set: { amountMinor: row.amountMinor, updatedAt: new Date() },
          })
          .run();
      }
    });
  } catch {
    return savingsError("moveFailed");
  }

  revalidatePath("/[locale]/budget", "page");
  return { ok: true };
}
