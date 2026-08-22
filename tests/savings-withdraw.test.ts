import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  savingsAllocations,
  savingsGoals,
  transactions,
  users,
  type NewTransaction,
  type User,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";

const signedIn = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: async () => signedIn.user,
}));

vi.mock("next-intl/server", async () => {
  const { translator } = await import("./stubs/i18n");
  return {
    getLocale: async () => "en",
    getTranslations: async (namespace: string) => translator(namespace),
  };
});

const { allocateSurplus, getSavingsOverview, withdrawSavings } = await import(
  "@/app/actions/savings"
);

/** A month that earned `income` francs and spent CHF 1'000. */
function month(userId: number, key: string, incomeMinor: number): NewTransaction[] {
  return [
    {
      userId,
      externalId: `${key}-in`,
      bookedOn: `${key}-25`,
      kind: "income",
      amountMinor: incomeMinor,
      currency: "CHF",
      originalAmountMinor: incomeMinor,
      account: "Privatkonto",
      merchant: "Arbeitgeber AG",
      category: "Salary",
      description: "salary",
    },
    {
      userId,
      externalId: `${key}-out`,
      bookedOn: `${key}-01`,
      kind: "expense",
      amountMinor: -100000,
      currency: "CHF",
      originalAmountMinor: 100000,
      account: "Privatkonto",
      merchant: "Hausverwaltung",
      category: "Housing",
      description: "rent",
    },
  ];
}

const EARLY = "2025-03"; // CHF 4'000 left over
const LATE = "2025-06"; //  CHF   100 left over

function rowsFor(goalId: number) {
  return db
    .select()
    .from(savingsAllocations)
    .where(eq(savingsAllocations.goalId, goalId))
    .orderBy(asc(savingsAllocations.month));
}

let user: User;
let goal: { id: number };

beforeEach(async () => {
  await db.delete(users);
  [user] = await db
    .insert(users)
    .values({ email: "saver@example.com", passwordHash: await hashPassword("x") })
    .returning();
  signedIn.user = user;
  await db
    .insert(transactions)
    .values([...month(user.id, EARLY, 500000), ...month(user.id, LATE, 110000)]);
  [goal] = await db
    .insert(savingsGoals)
    .values({ userId: user.id, name: "Ferien", targetMinor: 1_000_000 })
    .returning();
});

describe("withdrawSavings", () => {
  it("spends this month's own allocation before touching the balance", async () => {
    await allocateSurplus(EARLY, [{ goalId: goal.id, amount: "400.00" }]);
    expect(await withdrawSavings(EARLY, goal.id, "150.00")).toEqual({ ok: true });

    // No withdrawal row: undoing a month's own allocation is just a smaller
    // number, which is what keeps the allocator's input matching what is stored.
    const rows = await rowsFor(goal.id);
    expect(rows.map((r) => [r.month, r.amountMinor, r.withdrawnMinor])).toEqual([
      [EARLY, 25000, 0],
    ]);
  });

  it("reaches into an earlier month's savings without rewriting that month", async () => {
    await allocateSurplus(EARLY, [{ goalId: goal.id, amount: "4000.00" }]);
    // June left only CHF 100 over, so this is money March saved.
    expect(await withdrawSavings(LATE, goal.id, "900.00")).toEqual({ ok: true });

    const rows = await rowsFor(goal.id);
    expect(rows.map((r) => [r.month, r.amountMinor, r.withdrawnMinor])).toEqual([
      // March still says it put CHF 4'000 away, because it did.
      [EARLY, 400000, null],
      // June carries the minus, in the month it actually happened.
      [LATE, 0, 90000],
    ]);
  });

  it("returns the money to the month's free balance", async () => {
    await allocateSurplus(EARLY, [{ goalId: goal.id, amount: "4000.00" }]);
    await withdrawSavings(LATE, goal.id, "900.00");

    const overview = (await getSavingsOverview(LATE))!;
    expect(overview.surplusMinor).toBe(10000); // June left CHF 100
    expect(overview.allocatedMinor).toBe(0);
    expect(overview.withdrawnMinor).toBe(90000);
    // CHF 100 the month left, plus CHF 900 taken back out.
    expect(overview.freeMinor).toBe(100000);
    expect(overview.pots[0].savedMinor).toBe(310000);
    expect(overview.pots[0].monthWithdrawnMinor).toBe(90000);
  });

  it("refuses to take out more than the pot holds", async () => {
    await allocateSurplus(EARLY, [{ goalId: goal.id, amount: "400.00" }]);
    const result = await withdrawSavings(LATE, goal.id, "400.01");
    expect(result.ok).toBe(false);

    // And nothing was taken: a pot never goes negative.
    const overview = (await getSavingsOverview(LATE))!;
    expect(overview.pots[0].savedMinor).toBe(40000);
  });

  it("lets a reclaimed franc be committed again", async () => {
    await allocateSurplus(EARLY, [{ goalId: goal.id, amount: "4000.00" }]);
    await withdrawSavings(LATE, goal.id, "900.00");

    // June's ceiling is its own CHF 100 plus the CHF 900 just reclaimed.
    expect(
      await allocateSurplus(LATE, [{ goalId: goal.id, amount: "1000.00" }]),
    ).toEqual({ ok: true });
    expect(
      (await allocateSurplus(LATE, [{ goalId: goal.id, amount: "1000.01" }])).ok,
    ).toBe(false);
  });
});

describe("allocateSurplus with a withdrawal on the row", () => {
  it("clears an allocation without dropping the withdrawal beside it", async () => {
    await allocateSurplus(EARLY, [{ goalId: goal.id, amount: "4000.00" }]);
    await withdrawSavings(LATE, goal.id, "900.00");
    await allocateSurplus(LATE, [{ goalId: goal.id, amount: "500.00" }]);

    expect(await allocateSurplus(LATE, [{ goalId: goal.id, amount: "" }])).toEqual({
      ok: true,
    });

    const rows = await rowsFor(goal.id);
    expect(rows.map((r) => [r.month, r.amountMinor, r.withdrawnMinor])).toEqual([
      [EARLY, 400000, null],
      [LATE, 0, 90000],
    ]);
  });
});
