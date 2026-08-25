import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  anomalies,
  anomalyRuns,
  budgets,
  sessions,
  transactions,
  users,
} from "@/db/schema";
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

const { clearTransactions } = await import("@/app/actions/clear-transactions");
const { getTransactionAccounts } = await import("@/app/actions/transactions");

async function signUp(email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("correct horse") })
    .returning();
  return user;
}

/** A row with only the columns these tests care about. */
function row(
  userId: number,
  account: string,
  externalId: string,
): typeof transactions.$inferInsert {
  return {
    userId,
    externalId,
    bookedOn: "2026-03-04",
    kind: "expense",
    amountMinor: -1200,
    currency: "CHF",
    originalAmountMinor: 1200,
    account,
    merchant: "Coop",
    category: "Groceries",
    description: "",
  };
}

/** A finding pointing at one line, the way a scan leaves them. */
function finding(userId: number, transactionId: number, externalId: string) {
  return {
    userId,
    transactionId,
    transactionExternalId: externalId,
    ruleId: "AMOUNT_SPIKE",
    severity: "medium" as const,
    kind: "warning" as const,
    title: "Larger than usual",
    description: "",
    icon: "trending-up",
  };
}

/**
 * One account holding two bank accounts, with a finding on each, a scan run
 * over the lot, and a budget that must survive all of it.
 */
async function seedAccount(email: string) {
  const user = await signUp(email);
  const rows = await db
    .insert(transactions)
    .values([
      row(user.id, "Privatkonto", `${email}-p1`),
      row(user.id, "Privatkonto", `${email}-p2`),
      row(user.id, "KK-Konto", `${email}-k1`),
    ])
    .returning();

  await db.insert(anomalies).values([
    finding(user.id, rows[0].id, rows[0].externalId),
    finding(user.id, rows[2].id, rows[2].externalId),
  ]);
  await db.insert(anomalyRuns).values({
    userId: user.id,
    status: "done",
    transactionFingerprint: "3:whatever",
  });
  await db
    .insert(budgets)
    .values({ userId: user.id, category: "Groceries", limitMinor: 40_000 });

  return user;
}

const rowsOf = (userId: number) =>
  db.select().from(transactions).where(eq(transactions.userId, userId));
const findingsOf = (userId: number) =>
  db.select().from(anomalies).where(eq(anomalies.userId, userId));
const runsOf = (userId: number) =>
  db.select().from(anomalyRuns).where(eq(anomalyRuns.userId, userId));

beforeEach(async () => {
  cookieJar.clear();
  await db.delete(anomalies);
  await db.delete(anomalyRuns);
  await db.delete(budgets);
  await db.delete(transactions);
  await db.delete(sessions);
  await db.delete(users);
});

describe("clearTransactions", () => {
  it("refuses a caller with no session", async () => {
    const result = await clearTransactions({});
    expect(result).toEqual({ ok: false, error: "Sign in to clear transactions." });
  });

  it("clears every line of the signed-in account and nothing of anyone else's", async () => {
    const mine = await seedAccount("mine@example.com");
    const theirs = await seedAccount("theirs@example.com");
    await createSession(mine.id);

    const result = await clearTransactions({});

    expect(result).toEqual({ ok: true, deleted: 3 });
    expect(await rowsOf(mine.id)).toHaveLength(0);
    expect(await rowsOf(theirs.id)).toHaveLength(3);
    // The other account's findings and scan are not this one's to touch.
    expect(await findingsOf(theirs.id)).toHaveLength(2);
    expect(await runsOf(theirs.id)).toHaveLength(1);
  });

  it("clears one bank account and leaves the others alone", async () => {
    const user = await seedAccount("one@example.com");
    await createSession(user.id);

    const result = await clearTransactions({ account: "Privatkonto" });

    expect(result).toEqual({ ok: true, deleted: 2 });
    const left = await rowsOf(user.id);
    expect(left.map((r) => r.account)).toEqual(["KK-Konto"]);
  });

  it("drops the findings that describe cleared lines and keeps the rest", async () => {
    const user = await seedAccount("findings@example.com");
    await createSession(user.id);

    await clearTransactions({ account: "Privatkonto" });

    // A finding is a claim about a line, so it cannot outlive one — but the
    // surviving line keeps its id, and with it its finding.
    const left = await findingsOf(user.id);
    expect(left).toHaveLength(1);
    const [survivor] = await rowsOf(user.id);
    expect(left[0].transactionId).toBe(survivor.id);
  });

  it("keeps the scan run while statements remain, and drops it once none do", async () => {
    const user = await seedAccount("runs@example.com");
    await createSession(user.id);

    await clearTransactions({ account: "Privatkonto" });
    // Still statements here, so the scan is merely out of date — which is
    // true, and something the reader can act on.
    expect(await runsOf(user.id)).toHaveLength(1);

    await clearTransactions({ account: "KK-Konto" });
    // Nothing left for a scan to be about.
    expect(await runsOf(user.id)).toHaveLength(0);
  });

  it("leaves budgets alone — they are decisions, not statements", async () => {
    const user = await seedAccount("budget@example.com");
    await createSession(user.id);

    await clearTransactions({});

    const left = await db.select().from(budgets).where(eq(budgets.userId, user.id));
    expect(left).toHaveLength(1);
  });

  it("answers an account that matches nothing with an error, not a silent no-op", async () => {
    const user = await seedAccount("unknown@example.com");
    await createSession(user.id);

    const result = await clearTransactions({ account: "Nicht vorhanden" });

    expect(result).toEqual({
      ok: false,
      error: "There is nothing on that account any more.",
    });
    expect(await rowsOf(user.id)).toHaveLength(3);
  });

  it("cannot be aimed at another account's rows by naming theirs", async () => {
    const mine = await signUp("empty@example.com");
    const theirs = await seedAccount("full@example.com");
    await createSession(mine.id);

    const result = await clearTransactions({ account: "Privatkonto" });

    expect(result.ok).toBe(false);
    expect(await rowsOf(theirs.id)).toHaveLength(3);
  });
});

describe("getTransactionAccounts", () => {
  it("counts the lines under each account name, in name order", async () => {
    const user = await seedAccount("counts@example.com");
    await createSession(user.id);

    expect(await getTransactionAccounts()).toEqual([
      { account: "KK-Konto", count: 1 },
      { account: "Privatkonto", count: 2 },
    ]);
  });

  it("counts only the signed-in account's lines", async () => {
    await seedAccount("other@example.com");
    const mine = await signUp("mine2@example.com");
    await db
      .insert(transactions)
      .values(row(mine.id, "Privatkonto", "mine2-p1"));
    await createSession(mine.id);

    expect(await getTransactionAccounts()).toEqual([
      { account: "Privatkonto", count: 1 },
    ]);
  });

  it("has nothing to say to a signed-out reader", async () => {
    await seedAccount("signedout@example.com");
    expect(await getTransactionAccounts()).toEqual([]);
  });
});
