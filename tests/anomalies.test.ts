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
import { fingerprintOf, rebindAnomalies } from "@/lib/anomaly-sync";
import { hashPassword } from "@/lib/auth";

const signedIn = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: async () => signedIn.user,
}));

/* A scan reads the locale to tell the narrative layer which language to write
 * in, and the findings are rendered against the catalogs on the way out —
 * outside a request there is neither a locale to resolve nor a catalog loaded,
 * so both are supplied here from `messages/en.json`. */
vi.mock("next-intl/server", async () => {
  const { translator } = await import("./stubs/i18n");
  return {
    getLocale: async () => "en",
    getTranslations: async (namespace: string) => translator(namespace),
  };
});

const {
  getAnomalyKindByTransaction,
  getAnomalyOverview,
  getAnomalyRuleDetail,
  getAnomalyScanState,
  getAnomalyScanStatus,
  getStoredAnomaliesForPage,
  setAnomalyResolved,
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

  /*
   * A finding is read back in whichever language its reader is in, so what has
   * to survive the round trip is not the sentence but the rule that produced it
   * and the values that rule needs. Without them a stored finding can only be
   * shown in the language the scan happened to run in.
   */
  it("stores what a finding needs to be rendered in either language", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();

    const stored = await db.select().from(anomalies);
    for (const row of stored) {
      expect(row.baseRuleId).toBe(row.ruleId);
      expect(JSON.parse(row.params ?? "null")).toBeTruthy();
      // Nothing here came from the model, so nothing is pinned to a language.
      expect(row.narrativeLocale).toBeNull();
    }

    const [spike] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, "a-spike"));
    const [found] = await getStoredAnomaliesForPage([spike.id]);
    expect(found.base_rule_id).toBe(found.rule_id);
    expect(found.params).toBeTruthy();
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
      error: "alreadyRunning",
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
  it("reports no completed scan on a fresh account", async () => {
    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: false,
      outdated: false,
    });
  });

  it("reports a scan in flight", async () => {
    await db
      .insert(anomalyRuns)
      .values({ userId: alice.id, status: "running", startedAt: new Date() });

    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: true,
      outdated: false,
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
    // The statements have not moved, so there is nothing to re-run for.
    expect(state.outdated).toBe(false);
  });

  it("stays current when the same statements are re-imported", async () => {
    /*
     * The whole point of the fingerprint. `npm run start` re-seeds on every
     * boot, and the delete-then-insert reissues every transaction id — which is
     * what used to make a scan look out of date on every single deploy.
     */
    const rows = history(alice.id, "a");
    await db.insert(transactions).values(rows);
    await startAnomalyScan();
    await waitForScan();

    await db.delete(transactions).where(eq(transactions.userId, alice.id));
    await db.insert(transactions).values(rows);

    expect((await getAnomalyScanState()).outdated).toBe(false);
  });

  it("reports a scan as outdated once a transaction is added", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();
    expect((await getAnomalyScanState()).outdated).toBe(false);

    await db.insert(transactions).values({
      userId: alice.id,
      externalId: "a-new",
      bookedOn: "2025-07-01",
      kind: "expense",
      amountMinor: -4200,
      currency: "CHF",
      originalAmountMinor: 4200,
      account: "Privatkonto",
      merchant: "Neue AG",
      category: "Other",
      description: "arrived after the scan",
    });

    expect((await getAnomalyScanState()).outdated).toBe(true);

    // And re-running settles it.
    await startAnomalyScan();
    await waitForScan();
    expect((await getAnomalyScanState()).outdated).toBe(false);
  });

  it("reports a scan as outdated once a transaction is removed", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();

    await db.delete(transactions).where(eq(transactions.externalId, "a-spike"));

    expect((await getAnomalyScanState()).outdated).toBe(true);
  });

  it("treats a run with no fingerprint as unknown rather than outdated", async () => {
    /*
     * Scans that predate the column carry no fingerprint. They must not start
     * nagging just because it shipped — silence is the better wrong answer than
     * a prompt nobody can clear except by re-running.
     */
    await db.insert(transactions).values(history(alice.id, "a"));
    await db.insert(anomalyRuns).values({
      userId: alice.id,
      status: "done",
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    expect((await getAnomalyScanState()).outdated).toBe(false);
  });

  it("does not read another account's scan", async () => {
    await db.insert(transactions).values(history(bob.id, "b"));
    signedIn.user = bob;
    await startAnomalyScan();
    await waitForScan();

    // Alice has transactions Bob's scan never saw, and no scan of her own.
    signedIn.user = alice;
    await db.insert(transactions).values(history(alice.id, "a"));

    const state = await getAnomalyScanState();
    expect(state.hasCompletedScan).toBe(false);
    expect(state.outdated).toBe(false);
  });

  it("reports nothing for a signed-out visitor", async () => {
    signedIn.user = null;
    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: false,
      outdated: false,
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
    // No scan has run here at all, so there is no fingerprint to be behind.
    expect(overview.outdated).toBe(false);
  });

  it("drops a finding whose transaction is gone rather than rendering a dead link", async () => {
    // Findings can still outlive their rows between an import and the re-bind,
    // and a group with nothing live left is not a group.
    await finding(alice.id, 999_999, "REPEAT_CHARGE");

    const overview = await getAnomalyOverview();
    expect(overview.action).toEqual([]);
    expect(overview.context).toEqual([]);
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
    expect(await getAnomalyKindByTransaction()).toEqual(new Map());
    expect(await getAnomalyOverview()).toEqual({
      action: [],
      context: [],
      hasCompletedScan: false,
      running: false,
      outdated: false,
      resolvedGroupCount: 0,
    });
    expect(await startAnomalyScan()).toEqual({
      ok: false,
      error: "sessionExpired",
    });
    expect(
      await setAnomalyResolved({ ruleId: "REPEAT_CHARGE", resolved: true }),
    ).toEqual({ ok: false, error: "Sign in to resolve a finding." });
  });
});

/** The calendar's read: which days to tint, and how loudly. */
describe("getAnomalyKindByTransaction", () => {
  /** A finding on `transactionId`, written straight in — the classification is
   * what is under test here, not the engine that produced it. */
  async function finding(userId: number, transactionId: number, kind: "info" | "warning" | "alert") {
    await db.insert(anomalies).values({
      userId,
      transactionId,
      ruleId: "TEST",
      severity: "medium",
      kind,
      title: "Test",
      description: `A ${kind}`,
      icon: "lucide:store",
    });
  }

  it("keeps the most concerning kind when a row carries several findings", async () => {
    await finding(alice.id, 42, "info");
    await finding(alice.id, 42, "alert");
    await finding(alice.id, 42, "warning");

    expect(await getAnomalyKindByTransaction()).toEqual(new Map([[42, "alert"]]));
  });

  it("is insensitive to the order the rows come back in", async () => {
    await finding(alice.id, 7, "alert");
    await finding(alice.id, 7, "info");

    expect((await getAnomalyKindByTransaction()).get(7)).toBe("alert");
  });

  it("never reaches another account's findings", async () => {
    await finding(bob.id, 99, "alert");
    await finding(alice.id, 1, "info");

    const mine = await getAnomalyKindByTransaction();
    expect(mine.has(99)).toBe(false);
    expect(mine.get(1)).toBe("info");
  });
});

describe("resolving findings", () => {
  /** One rule, three transactions, two of them the same day at the same shop. */
  async function seedFindings(userId: number, prefix: string) {
    const rows: NewTransaction[] = [
      {
        userId,
        externalId: `${prefix}-1`,
        bookedOn: "2025-03-01",
        kind: "expense",
        amountMinor: -2500,
        currency: "CHF",
        originalAmountMinor: 2500,
        account: "Privatkonto",
        merchant: "Coop",
        category: "Groceries",
        description: "first",
      },
      {
        userId,
        externalId: `${prefix}-2`,
        bookedOn: "2025-03-01",
        kind: "expense",
        amountMinor: -2500,
        currency: "CHF",
        originalAmountMinor: 2500,
        account: "Privatkonto",
        merchant: "Coop",
        category: "Groceries",
        description: "second, same day same shop",
      },
      {
        userId,
        externalId: `${prefix}-3`,
        bookedOn: "2025-04-02",
        kind: "expense",
        amountMinor: -9900,
        currency: "CHF",
        originalAmountMinor: 9900,
        account: "Privatkonto",
        merchant: "SBB",
        category: "Transport",
        description: "another day, another merchant",
      },
    ];
    const inserted = await db.insert(transactions).values(rows).returning();

    await db.insert(anomalies).values(
      inserted.map((row) => ({
        userId,
        transactionId: row.id,
        transactionExternalId: row.externalId,
        ruleId: "REPEAT_CHARGE",
        severity: "medium" as const,
        kind: "warning" as const,
        title: "Repeat charge",
        description: `finding for ${row.externalId}`,
        icon: "lucide:copy",
      })),
    );

    return inserted;
  }

  it("resolves one finding without touching its neighbours", async () => {
    const [first, second, third] = await seedFindings(alice.id, "a");

    expect(
      await setAnomalyResolved({
        ruleId: "REPEAT_CHARGE",
        transactionIds: [first.id],
        resolved: true,
      }),
    ).toEqual({ ok: true, changed: 1 });

    const detail = await getAnomalyRuleDetail("REPEAT_CHARGE");
    expect(detail?.resolvedIds).toEqual([first.id]);
    expect(detail?.resolvedIds).not.toContain(second.id);
    expect(detail?.resolvedIds).not.toContain(third.id);
  });

  it("resolves a day-and-merchant group in one call, and reopens it", async () => {
    const [first, second, third] = await seedFindings(alice.id, "a");
    const group = [first.id, second.id];

    await setAnomalyResolved({
      ruleId: "REPEAT_CHARGE",
      transactionIds: group,
      resolved: true,
    });

    let detail = await getAnomalyRuleDetail("REPEAT_CHARGE");
    expect(new Set(detail?.resolvedIds)).toEqual(new Set(group));
    expect(detail?.resolvedIds).not.toContain(third.id);

    // Reversible — a mis-click on a group is not a one-way door.
    await setAnomalyResolved({
      ruleId: "REPEAT_CHARGE",
      transactionIds: group,
      resolved: false,
    });

    detail = await getAnomalyRuleDetail("REPEAT_CHARGE");
    expect(detail?.resolvedIds).toEqual([]);
  });

  it("resolves every finding of a rule when no ids are named", async () => {
    const inserted = await seedFindings(alice.id, "a");

    expect(
      await setAnomalyResolved({ ruleId: "REPEAT_CHARGE", resolved: true }),
    ).toEqual({ ok: true, changed: inserted.length });

    const detail = await getAnomalyRuleDetail("REPEAT_CHARGE");
    expect(new Set(detail?.resolvedIds)).toEqual(new Set(inserted.map((r) => r.id)));
  });

  it("never reaches another account's findings", async () => {
    const mine = await seedFindings(alice.id, "a");
    const theirs = await seedFindings(bob.id, "b");

    // Alice asks for every finding of the rule, and Bob's are of the same rule.
    await setAnomalyResolved({ ruleId: "REPEAT_CHARGE", resolved: true });

    const bobRows = await db
      .select()
      .from(anomalies)
      .where(eq(anomalies.userId, bob.id));
    expect(bobRows).toHaveLength(theirs.length);
    expect(bobRows.every((row) => row.resolvedAt === null)).toBe(true);

    const aliceRows = await db
      .select()
      .from(anomalies)
      .where(eq(anomalies.userId, alice.id));
    expect(aliceRows).toHaveLength(mine.length);
    expect(aliceRows.every((row) => row.resolvedAt !== null)).toBe(true);
  });

  it("refuses a hand-edited rule id before it queries anything", async () => {
    await seedFindings(alice.id, "a");

    expect(
      await setAnomalyResolved({ ruleId: "'; DROP TABLE anomalies; --", resolved: true }),
    ).toEqual({ ok: false, error: "That finding could not be identified." });

    const rows = await db.select().from(anomalies);
    expect(rows.every((row) => row.resolvedAt === null)).toBe(true);
  });

  it("counts a transaction resolved only when every finding on it is", async () => {
    const [first] = await seedFindings(alice.id, "a");

    // A second finding of the same rule on the same transaction — one rule can
    // flag a row twice, and half of it being ticked off is not being done.
    await db.insert(anomalies).values({
      userId: alice.id,
      transactionId: first.id,
      transactionExternalId: first.externalId,
      ruleId: "REPEAT_CHARGE",
      severity: "medium",
      kind: "warning",
      title: "Repeat charge",
      description: "a second finding on the same row",
      icon: "lucide:copy",
    });

    await db
      .update(anomalies)
      .set({ resolvedAt: new Date() })
      .where(eq(anomalies.description, "finding for a-1"));

    const detail = await getAnomalyRuleDetail("REPEAT_CHARGE");
    expect(detail?.resolvedIds).not.toContain(first.id);
  });
});

describe("the overview's resolved counts", () => {
  it("reports progress per rule and hides the finished ones on request", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();

    const before = await getAnomalyOverview();
    const groups = [...before.action, ...before.context];
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.resolvedCount === 0)).toBe(true);
    expect(before.resolvedGroupCount).toBe(0);

    const target = groups[0];
    await setAnomalyResolved({ ruleId: target.ruleId, resolved: true });

    const after = await getAnomalyOverview();
    const resolved = [...after.action, ...after.context].find(
      (g) => g.ruleId === target.ruleId,
    );
    expect(resolved?.resolvedCount).toBe(target.transactionCount);
    expect(after.resolvedGroupCount).toBe(1);

    // Hidden, but still counted — that count is what lets the page say "you
    // resolved everything" rather than "nothing was found".
    const hidden = await getAnomalyOverview(true);
    expect(
      [...hidden.action, ...hidden.context].some((g) => g.ruleId === target.ruleId),
    ).toBe(false);
    expect(hidden.resolvedGroupCount).toBe(1);
  });
});

describe("resolutions across a re-scan", () => {
  it("survives a re-scan of the same statements", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();

    const [target] = [...(await getAnomalyOverview()).action, ...(await getAnomalyOverview()).context];
    await setAnomalyResolved({ ruleId: target.ruleId, resolved: true });

    await startAnomalyScan();
    await waitForScan();

    const after = [...(await getAnomalyOverview()).action, ...(await getAnomalyOverview()).context].find(
      (g) => g.ruleId === target.ruleId,
    );
    expect(after?.resolvedCount).toBe(after?.transactionCount);
  });

  it("survives the statements being re-imported with fresh ids", async () => {
    const rows = history(alice.id, "a");
    await db.insert(transactions).values(rows);
    await startAnomalyScan();
    await waitForScan();

    const overview = await getAnomalyOverview();
    const target = [...overview.action, ...overview.context][0];
    await setAnomalyResolved({ ruleId: target.ruleId, resolved: true });

    /*
     * What `npm run seed` does on every boot: delete-then-insert, so every
     * transaction comes back with a new id. A resolution matched on
     * `transaction_id` would be lost here; matched on the statement line's own
     * natural key it is not.
     */
    await db.delete(transactions).where(eq(transactions.userId, alice.id));
    await db.insert(transactions).values(rows);

    const reissued = await db
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, "a-spike"));
    const stale = await db
      .select()
      .from(anomalies)
      .where(eq(anomalies.userId, alice.id));
    expect(stale.every((row) => row.transactionId !== reissued[0].id)).toBe(true);

    await startAnomalyScan();
    await waitForScan();

    const after = [
      ...(await getAnomalyOverview()).action,
      ...(await getAnomalyOverview()).context,
    ].find((g) => g.ruleId === target.ruleId);
    expect(after).toBeDefined();
    expect(after?.resolvedCount).toBe(after?.transactionCount);
  });

  it("leaves an untouched rule unresolved after a re-scan", async () => {
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();

    await startAnomalyScan();
    await waitForScan();

    const overview = await getAnomalyOverview();
    expect(
      [...overview.action, ...overview.context].every((g) => g.resolvedCount === 0),
    ).toBe(true);
  });
});

describe("findings across a re-import", () => {
  /** What every importer does, and what `npm run start` does on every boot. */
  async function reimport(userId: number, rows: NewTransaction[]) {
    await db.delete(transactions).where(eq(transactions.userId, userId));
    await db.insert(transactions).values(rows);
    rebindAnomalies(db, userId);
  }

  it("survives a re-seed of the same statements, resolutions and all", async () => {
    /*
     * The bug this whole change exists for. `transactions.id` is AUTOINCREMENT
     * and the seed delete-then-inserts, so re-seeding the identical CSVs used
     * to leave every finding pointing at an id that no longer existed — a scan
     * was voided by every deploy.
     */
    const rows = history(alice.id, "a");
    await db.insert(transactions).values(rows);
    await startAnomalyScan();
    await waitForScan();

    const before = await db.select().from(anomalies).where(eq(anomalies.userId, alice.id));
    expect(before.length).toBeGreaterThan(0);

    const overview = await getAnomalyOverview();
    const target = [...overview.action, ...overview.context][0];
    await setAnomalyResolved({ ruleId: target.ruleId, resolved: true });

    await reimport(alice.id, rows);

    const after = await db.select().from(anomalies).where(eq(anomalies.userId, alice.id));
    expect(after).toHaveLength(before.length);

    // Every finding now points at a transaction that actually exists.
    const live = new Set(
      (
        await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.userId, alice.id))
      ).map((row) => row.id),
    );
    expect(after.every((row) => live.has(row.transactionId))).toBe(true);

    // And the account is not asked to re-run, nor has it lost the tick-offs.
    const state = await getAnomalyScanState();
    expect(state.outdated).toBe(false);
    const regrouped = await getAnomalyOverview();
    const same = [...regrouped.action, ...regrouped.context].find(
      (g) => g.ruleId === target.ruleId,
    );
    expect(same?.transactionCount).toBe(target.transactionCount);
    expect(same?.resolvedCount).toBe(target.transactionCount);
  });

  it("re-points a finding at the row carrying its natural key", async () => {
    const rows = history(alice.id, "a");
    await db.insert(transactions).values(rows);
    const [spike] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, "a-spike"));

    await db.insert(anomalies).values({
      userId: alice.id,
      transactionId: spike.id,
      transactionExternalId: spike.externalId,
      ruleId: "REPEAT_CHARGE",
      severity: "medium",
      kind: "warning",
      title: "Repeat charge",
      description: "d",
      icon: "lucide:copy",
    });

    await reimport(alice.id, rows);

    const [reissued] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, "a-spike"));
    expect(reissued.id).not.toBe(spike.id);

    const [finding] = await db.select().from(anomalies).where(eq(anomalies.userId, alice.id));
    expect(finding.transactionId).toBe(reissued.id);
  });

  it("drops findings whose statement line is gone, and reports the account outdated", async () => {
    // What regenerating the demo data does: different external ids entirely, so
    // nothing matches and the old findings describe statements that no longer
    // exist.
    await db.insert(transactions).values(history(alice.id, "a"));
    await startAnomalyScan();
    await waitForScan();
    expect((await db.select().from(anomalies)).length).toBeGreaterThan(0);

    await reimport(alice.id, history(alice.id, "different"));

    expect(await db.select().from(anomalies)).toEqual([]);
    expect((await getAnomalyScanState()).outdated).toBe(true);
  });

  it("never touches another account's findings", async () => {
    const mine = history(alice.id, "a");
    await db.insert(transactions).values(mine);
    await db.insert(transactions).values(history(bob.id, "b"));

    const [theirRow] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, "b-spike"));
    await db.insert(anomalies).values({
      userId: bob.id,
      transactionId: theirRow.id,
      transactionExternalId: theirRow.externalId,
      ruleId: "REPEAT_CHARGE",
      severity: "medium",
      kind: "warning",
      title: "t",
      description: "d",
      icon: "lucide:copy",
    });

    // Alice re-imports. Bob's finding points at a row Alice's import never saw,
    // and must come through untouched rather than being read as an orphan.
    await reimport(alice.id, mine);

    const theirs = await db.select().from(anomalies).where(eq(anomalies.userId, bob.id));
    expect(theirs).toHaveLength(1);
    expect(theirs[0].transactionId).toBe(theirRow.id);
  });
});

describe("fingerprintOf", () => {
  it("ignores the order the ids arrive in", () => {
    // Load-bearing: the read has no ORDER BY, so SQLite may hand them back in
    // any order and an order-sensitive hash would change at random.
    expect(fingerprintOf(["b", "a", "c"])).toBe(fingerprintOf(["c", "b", "a"]));
  });

  it("separates ids so a regrouping cannot collide", () => {
    expect(fingerprintOf(["ab", "c"])).not.toBe(fingerprintOf(["a", "bc"]));
  });

  it("changes when the set does", () => {
    expect(fingerprintOf(["a", "b"])).not.toBe(fingerprintOf(["a", "b", "c"]));
    expect(fingerprintOf([])).not.toBe(fingerprintOf(["a"]));
  });
});
