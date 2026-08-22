"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
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

/** Major units as typed → rappen, or an error string naming what was wrong. */
function toMinor(amount: string): number | string {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return `“${amount}” is not an amount.`;
  const minor = Math.round(value * 100);
  if (minor > MAX_MINOR) return "That amount is larger than this app can hold.";
  return minor;
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
  if (!user) return { ok: false, error: "Sign in to add a savings goal." };

  const parsed = goalSchema.safeParse({ name, amount });
  if (!parsed.success) return { ok: false, error: "Give the goal a name and a target." };

  const target = toMinor(parsed.data.amount);
  if (typeof target === "string") return { ok: false, error: target };
  if (target <= 0) return { ok: false, error: "A goal needs a target above zero." };

  try {
    await db
      .insert(savingsGoals)
      .values({ userId: user.id, name: parsed.data.name, targetMinor: target });
  } catch {
    // The unique index on (user_id, name) is the only thing that realistically
    // fails here, and it fails for a reason worth naming.
    return { ok: false, error: `You already have a goal called “${parsed.data.name}”.` };
  }

  revalidatePath("/budget");
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
  if (!user) return { ok: false, error: "Sign in to change your savings goals." };

  await db
    .delete(savingsGoals)
    // Scoped by owner as well as id: the id alone would let anyone delete
    // anyone's goal by guessing a number.
    .where(and(eq(savingsGoals.id, goalId), eq(savingsGoals.userId, user.id)));

  revalidatePath("/budget");
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
  if (!user) return { ok: false, error: "Sign in to move money into a pot." };

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: "That is not a month." };
  }
  if (!monthHasEnded(month)) {
    return { ok: false, error: "That month is still running." };
  }

  const parsed = z.array(allocationSchema).max(64).safeParse(entries);
  if (!parsed.success) return { ok: false, error: "That allocation looks malformed." };

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
      return { ok: false, error: "That savings goal no longer exists." };
    }
    if (entry.amount === "") {
      clears.push(entry.goalId);
      continue;
    }
    const minor = toMinor(entry.amount);
    if (typeof minor === "string") return { ok: false, error: minor };
    // Zero and blank mean the same thing here — unlike a budget, where zero is
    // a real limit of nothing. No contribution is no row.
    if (minor === 0) {
      clears.push(entry.goalId);
      continue;
    }
    total += minor;
    upserts.push({ goalId: entry.goalId, amountMinor: minor });
  }

  if (total > surplus) {
    return {
      ok: false,
      error: "That is more than the month had left over.",
    };
  }

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
    return { ok: false, error: "Could not move that money. Try again." };
  }

  revalidatePath("/budget");
  return { ok: true };
}
