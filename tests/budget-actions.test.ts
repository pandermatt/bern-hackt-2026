import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { budgets, sessions, transactions, users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { cookieJar } from "./cookie-jar";

/* Outside a request there is no locale and no catalog loaded, so the error
 * strings are served from `messages/en.json` — the ones the app really ships.
 * Same shape as tests/merchant-overrides.test.ts. */
vi.mock("next-intl/server", async () => {
  const { translator } = await import("./stubs/i18n");
  return {
    getLocale: async () => "en",
    getTranslations: async (namespace: string) => translator(namespace),
  };
});

const { applyBudgetFix, getBudgetOverview, saveBudgets } = await import(
  "@/app/actions/budget",
);

async function signIn() {
  const [user] = await db
    .insert(users)
    .values({
      email: "budget@example.com",
      passwordHash: await hashPassword("correct horse"),
    })
    .returning();
  await createSession(user.id);
  return user;
}

/** A month of spending in one category, enough to make it a budget row. */
function spend(
  userId: number,
  category: string,
  amountMinor: number,
  externalId: string,
): typeof transactions.$inferInsert {
  return {
    userId,
    externalId,
    bookedOn: "2026-03-04",
    kind: "expense",
    amountMinor: -amountMinor,
    currency: "CHF",
    originalAmountMinor: amountMinor,
    account: "Privatkonto",
    merchant: "Landlord",
    category,
    description: "",
  };
}

const savedRows = (userId: number) =>
  db.select().from(budgets).where(eq(budgets.userId, userId));

const rowFor = async (category: string) =>
  (await getBudgetOverview())?.rows.find((row) => row.category === category);

beforeEach(async () => {
  cookieJar.clear();
  await db.delete(budgets);
  await db.delete(transactions);
  await db.delete(sessions);
  await db.delete(users);
});

describe("saveBudgets", () => {
  it("refuses a caller with no session", async () => {
    const result = await saveBudgets([{ category: "Housing", amount: "100" }]);
    expect(result).toEqual({ ok: false, error: "Sign in to set a budget." });
  });

  it("stores a limit, and warns about it unless told otherwise", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));

    expect(await saveBudgets([{ category: "Housing", amount: "1000" }])).toEqual({
      ok: true,
    });

    const [stored] = await savedRows(user.id);
    expect(stored).toMatchObject({ category: "Housing", limitMinor: 100_000 });
    expect(await rowFor("Housing")).toMatchObject({
      limitMinor: 100_000,
      warnOverspend: true,
    });
  });

  it("carries a silenced category through the round trip", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));

    await saveBudgets([{ category: "Housing", amount: "1000", warn: false }]);

    const [stored] = await savedRows(user.id);
    expect(stored.warnOverspend).toBe(false);
    // Still over its limit — only the telling is off.
    expect(await rowFor("Housing")).toMatchObject({
      usedMinor: 180_000,
      warnOverspend: false,
    });
  });

  it("switches the warning back on", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));

    await saveBudgets([{ category: "Housing", amount: "1000", warn: false }]);
    await saveBudgets([{ category: "Housing", amount: "1000", warn: true }]);

    expect((await savedRows(user.id))[0].warnOverspend).toBe(true);
  });

  it("takes the flag with the row when the limit is cleared", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));
    await saveBudgets([{ category: "Housing", amount: "1000", warn: false }]);

    // A category with no limit has no warning to configure either.
    await saveBudgets([{ category: "Housing", amount: "" }]);

    expect(await savedRows(user.id)).toEqual([]);
    expect(await rowFor("Housing")).toMatchObject({
      limitMinor: null,
      warnOverspend: true,
    });
  });

  it("reads a row that predates the column as one that still warns", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));
    // NULL is what `drizzle-kit push` leaves on every existing row, and it is
    // not an opinion — a budget set before the switch existed keeps warning.
    await db
      .insert(budgets)
      .values({ userId: user.id, category: "Housing", limitMinor: 100_000 });

    expect((await savedRows(user.id))[0].warnOverspend).toBeNull();
    expect(await rowFor("Housing")).toMatchObject({ warnOverspend: true });
  });

  it("keeps one account's budgets out of another's", async () => {
    const mine = await signIn();
    await db.insert(transactions).values(spend(mine.id, "Housing", 180_000, "a"));
    await saveBudgets([{ category: "Housing", amount: "1000", warn: false }]);

    const [theirs] = await db
      .insert(users)
      .values({
        email: "other@example.com",
        passwordHash: await hashPassword("correct horse"),
      })
      .returning();

    expect(await savedRows(theirs.id)).toEqual([]);
  });
});

describe("applyBudgetFix", () => {
  it("refuses a caller with no session", async () => {
    const result = await applyBudgetFix({ category: "Housing", action: "mute" });
    expect(result).toEqual({ ok: false, error: "Sign in to set a budget." });
  });

  it("raises the limit to what was actually spent", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));
    await saveBudgets([{ category: "Housing", amount: "1000" }]);

    // The client names the category and the choice; the figure is resolved
    // here, from the same overview the card was built from.
    const result = await applyBudgetFix({ category: "Housing", action: "raise" });

    expect(result).toEqual({ ok: true, limitMinor: 180_000, warn: true });
    expect((await savedRows(user.id))[0]).toMatchObject({ limitMinor: 180_000 });
  });

  it("leaves a silenced category silenced when its limit is raised", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));
    await saveBudgets([{ category: "Housing", amount: "1000", warn: false }]);

    await applyBudgetFix({ category: "Housing", action: "raise" });

    // Switching the warning back on would be a second change nobody asked for.
    expect((await savedRows(user.id))[0]).toMatchObject({
      limitMinor: 180_000,
      warnOverspend: false,
    });
  });

  it("mutes without touching the limit", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));
    await saveBudgets([{ category: "Housing", amount: "1000" }]);

    const result = await applyBudgetFix({ category: "Housing", action: "mute" });

    expect(result).toEqual({ ok: true, limitMinor: 100_000, warn: false });
    expect((await savedRows(user.id))[0]).toMatchObject({
      limitMinor: 100_000,
      warnOverspend: false,
    });
  });

  it("refuses a category with no limit to change", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));

    // What a card left open in a tab asks for after the budget was cleared
    // somewhere else.
    const result = await applyBudgetFix({ category: "Housing", action: "raise" });

    expect(result).toEqual({
      ok: false,
      error: "That category has no limit to change any more.",
    });
  });

  it("cannot be aimed at a category that is not on the account", async () => {
    const user = await signIn();
    await db.insert(transactions).values(spend(user.id, "Housing", 180_000, "a"));

    const result = await applyBudgetFix({ category: "Pets", action: "mute" });

    expect(result.ok).toBe(false);
    expect(await savedRows(user.id)).toEqual([]);
  });
});
