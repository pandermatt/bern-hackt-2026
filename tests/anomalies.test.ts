import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  anomalies,
  anomalyRuns,
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

const {
  getAnomalyOverview,
  getAnomalyRuleDetail,
  getAnomalyScanState,
  getAnomalyScanStatus,
  getStoredAnomaliesForPage,
  startAnomalyScan,
} = await import("@/app/actions/anomalies");

async function createUser(email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("correct horse") })
    .returning();
  return user;
}

/** A history with one obvious outlier: a merchant's usual spend, then 200x it. */
function history(userId: number, prefix: string): NewTransaction[] {
  const rows: NewTransaction[] = [];
  for (let i = 0; i < 60; i++) {
    const day = String((i % 28) + 1).padStart(2, "0");
    const month = String((i % 12) + 1).padStart(2, "0");
    rows.push({
      userId,
      externalId: `${prefix}-${i}`,
      bookedOn: `2025-${month}-${day}`,
      kind: "expense",
      amountMinor: -1000,
      currency: "CHF",
      originalAmountMinor: 1000,
      account: "Privatkonto",
      merchant: "Kantine AG",
      category: "Food & Drink",
      description: `lunch ${i}`,
    });
  }
  rows.push({
    userId,
    externalId: `${prefix}-spike`,
    bookedOn: "2025-06-15",
    kind: "expense",
    amountMinor: -20000000,
    currency: "CHF",
    originalAmountMinor: 20000000,
    account: "Privatkonto",
    merchant: "Kantine AG",
    category: "Food & Drink",
    description: "the outlier",
  });
  return rows;
}

/** The scan runs in the background, so tests wait for the run row to settle. */
async function waitForScan(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getAnomalyScanStatus();
    if (status && status.status !== "running") return status;
    if (Date.now() > deadline) throw new Error("scan did not finish in time");
    await new Promise((r) => setTimeout(r, 25));
  }
}

let alice: User;
let bob: User;

beforeEach(async () => {
  await db.delete(anomalies);
  await db.delete(anomalyRuns);
  await db.delete(transactions);
  await db.delete(users);

  alice = await createUser("alice@example.com");
  bob = await createUser("bob@example.com");
  signedIn.user = alice;
});

describe("running a scan", () => {
  it("persists findings and reports completion", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));

    expect(await startAnomalyScan()).toEqual({ ok: true });
    const status = await waitForScan();

    expect(status.status).toBe("done");
    expect(status.total).toBe(61);
    // The bar must actually reach the end, not stall short of it.
    expect(status.processed).toBe(61);
    expect(status.insightCount).toBeGreaterThan(0);

    const stored = await db.select().from(anomalies);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((row) => row.userId === alice.id)).toBe(true);
  });

  it("flags the outlier against the transaction it belongs to", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();

    const [spike] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, "a-spike"));

    const found = await getStoredAnomaliesForPage([spike.id]);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => f.transaction_ids.includes(spike.id))).toBe(true);
  });

  it("round-trips each finding's kind through the database", async () => {
    /*
     * `anomalies.kind` carries a column default, so forgetting to write it
     * compiles cleanly and silently stamps every row `warning`. The only way to
     * notice is to check a row that should not be one — the outlier is `high`
     * severity, so it derives `warning`, while the quiet findings around it
     * derive `info`.
     */
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();

    const rows = await db
      .select()
      .from(anomalies)
      .where(eq(anomalies.userId, alice.id));

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.kind).toBe(row.severity === "low" ? "info" : "warning");
    }

    // And it survives the read path, which regroups rows into insights.
    const found = await getStoredAnomaliesForPage(rows.map((r) => r.transactionId));
    for (const insight of found) {
      expect(insight.kind).toBe(insight.severity === "low" ? "info" : "warning");
    }
  });

  it("replaces the previous scan's results rather than appending", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));

    await startAnomalyScan();
    await waitForScan();
    const first = (await db.select().from(anomalies)).length;

    await startAnomalyScan();
    await waitForScan();
    const second = (await db.select().from(anomalies)).length;

    expect(second).toBe(first);
  });

  it("refuses to start a second scan while one is running", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    await db
      .insert(anomalyRuns)
      .values({ userId: alice.id, status: "running", startedAt: new Date() });

    expect(await startAnomalyScan()).toEqual({
      ok: false,
      error: "A scan is already running.",
    });
  });

  it("copes with an account that has no transactions", async () => {
    expect(await startAnomalyScan()).toEqual({ ok: true });
    const status = await waitForScan();

    expect(status.status).toBe("done");
    expect(status.total).toBe(0);
    expect(await db.select().from(anomalies)).toHaveLength(0);
  });
});

describe("scan state (drives the dashboard prompt)", () => {
  /** A finding pointing at an id no transaction has — what a re-import leaves. */
  function leftover(userId: number) {
    return {
      userId,
      transactionId: 999_999,
      ruleId: "REPEAT_CHARGE",
      severity: "medium" as const,
      title: "REPEAT_CHARGE title",
      description: "REPEAT_CHARGE description",
      icon: "lucide:arrow-up",
      emoji: "🔺",
      metrics: "{}",
    };
  }

  it("reports no completed scan on a fresh account", async () => {
    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: false,
      stale: false,
    });
  });

  it("reports a scan in flight", async () => {
    await db
      .insert(anomalyRuns)
      .values({ userId: alice.id, status: "running", startedAt: new Date() });

    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: true,
      stale: false,
    });
  });

  it("counts a clean scan as completed, so the prompt stops", async () => {
    // The distinction the prompt hangs on: an account with nothing wrong must
    // not be nagged to scan again just because it has no findings.
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();
    await db.delete(anomalies);

    const state = await getAnomalyScanState();
    expect(state.hasCompletedScan).toBe(true);
    expect(state.running).toBe(false);
    // Nothing was left behind, so this is a clean result and not a stale one.
    expect(state.stale).toBe(false);
  });

  it("keeps a completed scan un-stale while any finding still has its row", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    const [live] = await db.select({ id: transactions.id }).from(transactions).limit(1);
    await db.insert(anomalies).values([
      { ...leftover(alice.id), transactionId: live.id },
      // A re-import reissues ids, so some findings can be orphaned while others
      // survive. One survivor is enough for the results to still be about these
      // transactions.
      leftover(alice.id),
    ]);

    expect((await getAnomalyScanState()).stale).toBe(false);
  });

  it("reports findings left behind by a re-import as stale", async () => {
    // What a re-seed leaves: every finding points at a transaction id that no
    // longer exists, so the ledger shows no badges at all. Without this the
    // dashboard would silently look like a clean account.
    await db.insert(transactions).values(history(alice.id, "a"));
    await db.insert(anomalies).values(leftover(alice.id));

    expect((await getAnomalyScanState()).stale).toBe(true);
  });

  it("does not call another account's leftovers stale", async () => {
    await db.insert(anomalies).values(leftover(bob.id));

    expect((await getAnomalyScanState()).stale).toBe(false);
  });

  it("reports nothing for a signed-out visitor", async () => {
    signedIn.user = null;
    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: false,
      stale: false,
    });
  });
});

describe("the anomaly overview", () => {
  /** A transaction to hang findings on, returned by id. */
  async function txn(userId: number, key: string, bookedOn: string) {
    const [inserted] = await db
      .insert(transactions)
      .values({
        userId,
        externalId: key,
        bookedOn,
        kind: "expense",
        amountMinor: -5000,
        currency: "CHF",
        originalAmountMinor: 5000,
        account: "Privatkonto",
        merchant: "Kantine AG",
        category: "Food & Drink",
        description: key,
      })
      .returning();
    return inserted.id;
  }

  async function finding(
    userId: number,
    transactionId: number,
    ruleId: string,
    overrides: Partial<{ severity: "low" | "medium" | "high"; description: string }> = {},
  ) {
    await db.insert(anomalies).values({
      userId,
      transactionId,
      ruleId,
      severity: overrides.severity ?? "medium",
      title: `${ruleId} title`,
      description: overrides.description ?? `${ruleId} description`,
      icon: "lucide:arrow-up",
      emoji: "🔺",
      metrics: "{}",
    });
  }

  it("counts distinct transactions, not stored rows", async () => {
    const one = await txn(alice.id, "a-1", "2025-03-01");
    // Two findings of the same rule on one transaction is one transaction.
    await finding(alice.id, one, "REPEAT_CHARGE");
    await finding(alice.id, one, "REPEAT_CHARGE", { description: "another" });

    const overview = await getAnomalyOverview();
    const group = overview.action.find((g) => g.ruleId === "REPEAT_CHARGE");
    expect(group?.transactionCount).toBe(1);
  });

  it("splits findings into what needs acting on and what does not", async () => {
    const one = await txn(alice.id, "a-1", "2025-03-01");
    await finding(alice.id, one, "REPEAT_CHARGE");
    await finding(alice.id, one, "SAVINGS_RATE_CHANGE");

    const overview = await getAnomalyOverview();
    expect(overview.action.map((g) => g.ruleId)).toEqual(["REPEAT_CHARGE"]);
    expect(overview.context.map((g) => g.ruleId)).toEqual(["SAVINGS_RATE_CHANGE"]);
  });

  it("reports the group's worst severity and most recent date", async () => {
    const older = await txn(alice.id, "a-1", "2025-01-01");
    const newer = await txn(alice.id, "a-2", "2025-09-30");
    await finding(alice.id, older, "REPEAT_CHARGE", { severity: "low" });
    await finding(alice.id, newer, "REPEAT_CHARGE", {
      severity: "high",
      description: "the recent one",
    });

    const group = (await getAnomalyOverview()).action[0];
    expect(group.severity).toBe("high");
    expect(group.latestOn).toBe("2025-09-30");
    // The newest finding's own words — for the absence-shaped rules that prose
    // is the only place the finding actually is.
    expect(group.description).toBe("the recent one");
  });

  it("drops a finding whose transaction no longer exists", async () => {
    const live = await txn(alice.id, "a-1", "2025-03-01");
    await finding(alice.id, live, "REPEAT_CHARGE");
    // A scan is a snapshot and `transactionId` is deliberately not a foreign
    // key, so findings outlive a re-import. Counting them would advertise rows
    // the ledger cannot show.
    await finding(alice.id, 999_999, "REPEAT_CHARGE");
    await finding(alice.id, 999_998, "MISSING_EXPECTED_INCOME");

    const overview = await getAnomalyOverview();
    expect(overview.action.find((g) => g.ruleId === "REPEAT_CHARGE")?.transactionCount).toBe(1);
    // Nothing live at all, so the group is gone rather than a dead link.
    expect(overview.action.some((g) => g.ruleId === "MISSING_EXPECTED_INCOME")).toBe(false);
    // Something survived, so this is a real result rather than a stale one.
    expect(overview.stale).toBe(false);
  });

  it("calls out findings left behind by a re-import instead of reporting all clear", async () => {
    // Every finding pointing at a vanished transaction is what a re-seed leaves:
    // ids are reissued, so the old ones match nothing. Saying "nothing looks
    // off" there would be the one wrong answer — nothing was checked.
    await finding(alice.id, 999_999, "REPEAT_CHARGE");

    const overview = await getAnomalyOverview();
    expect(overview.action).toEqual([]);
    expect(overview.context).toEqual([]);
    expect(overview.stale).toBe(true);
  });

  it("orders deterministically, breaking ties on the rule id", async () => {
    // Same severity, same date — only the tiebreak can decide, and without one
    // the page would reshuffle itself between renders.
    const one = await txn(alice.id, "a-1", "2025-03-01");
    for (const rule of ["SUBSCRIPTION_ACCUMULATION", "INCOME_DEVIATION", "REPEAT_CHARGE"]) {
      await finding(alice.id, one, rule, { severity: "medium" });
    }

    const first = (await getAnomalyOverview()).action.map((g) => g.ruleId);
    const second = (await getAnomalyOverview()).action.map((g) => g.ruleId);
    expect(first).toEqual(["INCOME_DEVIATION", "REPEAT_CHARGE", "SUBSCRIPTION_ACCUMULATION"]);
    expect(second).toEqual(first);
  });

  it("puts the more urgent finding first, then the more recent one", async () => {
    const older = await txn(alice.id, "a-1", "2025-01-01");
    const newer = await txn(alice.id, "a-2", "2025-09-30");
    await finding(alice.id, older, "REPEAT_CHARGE", { severity: "high" });
    await finding(alice.id, newer, "INCOME_DEVIATION", { severity: "medium" });
    await finding(alice.id, newer, "SUBSCRIPTION_ACCUMULATION", { severity: "medium" });

    const order = (await getAnomalyOverview()).action.map((g) => g.ruleId);
    expect(order[0]).toBe("REPEAT_CHARGE");
  });

  it("reports an un-scanned account as empty rather than clean", async () => {
    const overview = await getAnomalyOverview();
    expect(overview.action).toEqual([]);
    expect(overview.context).toEqual([]);
    expect(overview.hasCompletedScan).toBe(false);
  });
});

describe("one rule's detail", () => {
  async function txn(userId: number, key: string, bookedOn: string) {
    const [inserted] = await db
      .insert(transactions)
      .values({
        userId,
        externalId: key,
        bookedOn,
        kind: "expense",
        amountMinor: -5000,
        currency: "CHF",
        originalAmountMinor: 5000,
        account: "Privatkonto",
        merchant: "SWISS",
        category: "Travel",
        description: key,
      })
      .returning();
    return inserted.id;
  }

  async function finding(
    userId: number,
    transactionId: number,
    ruleId: string,
    description: string,
  ) {
    await db.insert(anomalies).values({
      userId,
      transactionId,
      ruleId,
      severity: "medium",
      title: `${ruleId} title`,
      description,
      icon: "lucide:copy",
      emoji: "👯",
      metrics: "{}",
    });
  }

  it("returns nothing for a rule with no findings", async () => {
    expect(await getAnomalyRuleDetail("REPEAT_CHARGE")).toBeNull();
  });

  it("rejects a malformed rule id without going near the database", async () => {
    for (const bad of ["lowercase", "with spaces", "x".repeat(80), ""]) {
      expect(await getAnomalyRuleDetail(bad)).toBeNull();
    }
  });

  it("splits the finding you asked about from the rest of its kind", async () => {
    // Two separate duplicate-charge findings, each covering two transactions.
    const a1 = await txn(alice.id, "a-1", "2025-09-18");
    const a2 = await txn(alice.id, "a-2", "2025-09-18");
    const b1 = await txn(alice.id, "b-1", "2025-04-19");
    const b2 = await txn(alice.id, "b-2", "2025-04-19");
    for (const id of [a1, a2]) await finding(alice.id, id, "REPEAT_CHARGE", "four times in September");
    for (const id of [b1, b2]) await finding(alice.id, id, "REPEAT_CHARGE", "twice in April");

    const detail = await getAnomalyRuleDetail("REPEAT_CHARGE", a1);
    expect(detail?.focus?.description).toBe("four times in September");
    expect(detail?.focus?.rows.map((r) => r.id).sort()).toEqual([a1, a2].sort());
    expect(detail?.focus?.totalMinor).toBe(10000);
    expect(detail?.others.map((r) => r.id).sort()).toEqual([b1, b2].sort());
    expect(detail?.transactionCount).toBe(4);
  });

  it("puts everything under 'others' when no transaction was named", async () => {
    const one = await txn(alice.id, "a-1", "2025-09-18");
    await finding(alice.id, one, "REPEAT_CHARGE", "once");

    const detail = await getAnomalyRuleDetail("REPEAT_CHARGE");
    expect(detail?.focus).toBeNull();
    expect(detail?.others).toHaveLength(1);
  });

  it("degrades to no focus when the named transaction is gone", async () => {
    // A shared link that outlived a re-import still shows the rule.
    const one = await txn(alice.id, "a-1", "2025-09-18");
    await finding(alice.id, one, "REPEAT_CHARGE", "once");

    const detail = await getAnomalyRuleDetail("REPEAT_CHARGE", 999_999);
    expect(detail?.focus).toBeNull();
    expect(detail?.others).toHaveLength(1);
  });

  it("ignores findings whose transactions no longer exist", async () => {
    const live = await txn(alice.id, "a-1", "2025-09-18");
    await finding(alice.id, live, "REPEAT_CHARGE", "once");
    await finding(alice.id, 999_998, "REPEAT_CHARGE", "orphaned");

    const detail = await getAnomalyRuleDetail("REPEAT_CHARGE");
    expect(detail?.transactionCount).toBe(1);
  });

  it("returns nothing when every finding for the rule is orphaned", async () => {
    await finding(alice.id, 999_998, "REPEAT_CHARGE", "orphaned");
    expect(await getAnomalyRuleDetail("REPEAT_CHARGE")).toBeNull();
  });
});

describe("ownership", () => {
  it("never returns another account's findings", async () => {
    await db.insert(transactions).values(history(bob.id, "b"));
    signedIn.user = bob;
    await startAnomalyScan();
    await waitForScan();

    const bobsRows = await db.select().from(transactions);
    const bobsIds = bobsRows.map((r) => r.id);
    expect((await getStoredAnomaliesForPage(bobsIds)).length).toBeGreaterThan(0);

    // Alice asking for Bob's transaction ids gets nothing back.
    signedIn.user = alice;
    expect(await getStoredAnomaliesForPage(bobsIds)).toEqual([]);

    // And Bob's findings never reach Alice's overview or rule pages either.
    const alicesOverview = await getAnomalyOverview();
    expect(alicesOverview.action).toEqual([]);
    expect(alicesOverview.context).toEqual([]);
    expect(await getAnomalyRuleDetail("AMOUNT_SPIKE")).toBeNull();
  });

  it("returns nothing at all when signed out", async () => {
    signedIn.user = null;
    expect(await getAnomalyScanStatus()).toBeNull();
    expect(await getStoredAnomaliesForPage([1, 2, 3])).toEqual([]);
    expect(await getAnomalyRuleDetail("REPEAT_CHARGE")).toBeNull();
    expect(await getAnomalyOverview()).toEqual({
      action: [],
      context: [],
      hasCompletedScan: false,
      running: false,
      stale: false,
    });
    expect(await startAnomalyScan()).toEqual({
      ok: false,
      error: "Your session expired. Sign in again.",
    });
  });
});
