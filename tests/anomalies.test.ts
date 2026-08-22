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
  it("reports no completed scan on a fresh account", async () => {
    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: false,
    });
  });

  it("reports a scan in flight", async () => {
    await db
      .insert(anomalyRuns)
      .values({ userId: alice.id, status: "running", startedAt: new Date() });

    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: true,
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
  });

  it("reports nothing for a signed-out visitor", async () => {
    signedIn.user = null;
    expect(await getAnomalyScanState()).toEqual({
      hasCompletedScan: false,
      running: false,
    });
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
  });

  it("returns nothing at all when signed out", async () => {
    signedIn.user = null;
    expect(await getAnomalyScanStatus()).toBeNull();
    expect(await getStoredAnomaliesForPage([1, 2, 3])).toEqual([]);
    expect(await startAnomalyScan()).toEqual({
      ok: false,
      error: "Your session expired. Sign in again.",
    });
  });
});
