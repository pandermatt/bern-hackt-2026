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

const {
  allocateSurplus,
  getSavingsGoalNames,
  getSavingsOverview,
  withdrawSavings,
} = await import("@/app/actions/savings");

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
    expect(overview.surplusMinor).toBe(10000); // June alone left CHF 100
    // The pool is every month up to June: March's CHF 4'000 and June's CHF 100.
    expect(overview.pooledMinor).toBe(410000);
    // To date, not this month's — March's allocation still spends the pool.
    expect(overview.allocatedMinor).toBe(400000);
    expect(overview.withdrawnMinor).toBe(90000);
    // 4'100 pooled, 4'000 in the pot, 900 taken back out.
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

describe("the pool", () => {
  it("lets a pot outlive the month it was filled from", async () => {
    // June left CHF 100 of its own, but March left CHF 4'000 and nothing has
    // claimed it. The old per-month rule rejected this outright.
    expect(
      await allocateSurplus(LATE, [{ goalId: goal.id, amount: "3000.00" }]),
    ).toEqual({ ok: true });

    const overview = (await getSavingsOverview(LATE))!;
    expect(overview.pooledMinor).toBe(410000);
    expect(overview.freeMinor).toBe(110000);
    // The month's own leftover is untouched and still says CHF 100.
    expect(overview.surplusMinor).toBe(10000);
  });

  it("stops at what the account has actually had left over", async () => {
    expect(
      (await allocateSurplus(LATE, [{ goalId: goal.id, amount: "4100.01" }])).ok,
    ).toBe(false);
    expect(
      await allocateSurplus(LATE, [{ goalId: goal.id, amount: "4100.00" }]),
    ).toEqual({ ok: true });
  });

  it("counts another month's allocation against the same pool", async () => {
    await allocateSurplus(EARLY, [{ goalId: goal.id, amount: "4000.00" }]);
    // Only CHF 100 of the pool is left, so June cannot claim more than that.
    expect(
      (await allocateSurplus(LATE, [{ goalId: goal.id, amount: "100.01" }])).ok,
    ).toBe(false);
  });

  it("reads the pool as of the month being viewed", async () => {
    // Standing in March, June's CHF 100 has not happened yet.
    expect((await getSavingsOverview(EARLY))!.pooledMinor).toBe(400000);
    expect((await getSavingsOverview(LATE))!.pooledMinor).toBe(410000);
  });

  it("does not count a later month's allocation against an earlier view", async () => {
    await allocateSurplus(LATE, [{ goalId: goal.id, amount: "100.00" }]);
    const early = (await getSavingsOverview(EARLY))!;
    expect(early.allocatedMinor).toBe(0);
    expect(early.pots[0].savedMinor).toBe(0);
    expect(early.freeMinor).toBe(400000);
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

describe("getSavingsGoalNames", () => {
  it("lists this account's pots oldest first, and nobody else's", async () => {
    const [mine] = await db
      .insert(users)
      .values({ email: "mine@example.com", passwordHash: await hashPassword("correct horse") })
      .returning();
    const [theirs] = await db
      .insert(users)
      .values({ email: "theirs@example.com", passwordHash: await hashPassword("correct horse") })
      .returning();

    await db.insert(savingsGoals).values([
      { userId: mine.id, name: "Holiday", targetMinor: 500_000 },
      { userId: mine.id, name: "Bike", targetMinor: 200_000 },
      { userId: theirs.id, name: "Not mine", targetMinor: 100_000 },
    ]);

    signedIn.user = mine;
    // Oldest first is what makes `/onboarding` name the goal that was just
    // added rather than an arbitrary one.
    await expect(getSavingsGoalNames()).resolves.toEqual(["Holiday", "Bike"]);
  });

  it("is empty for an account with no pots, and for no account at all", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "empty@example.com", passwordHash: await hashPassword("correct horse") })
      .returning();

    signedIn.user = user;
    await expect(getSavingsGoalNames()).resolves.toEqual([]);

    // The empty list is what makes onboarding offer the form, so a signed-out
    // reader must not be told somebody else's.
    signedIn.user = null;
    await expect(getSavingsGoalNames()).resolves.toEqual([]);
  });
});
