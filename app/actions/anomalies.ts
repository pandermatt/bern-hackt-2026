"use server";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  anomalies,
  anomalyRuns,
  transactions,
  type AnomalyRun,
  type NewAnomaly,
} from "@/db/schema";
import {
  analyzeTransactionAnomalies,
  type AnomalyInsight,
} from "@/lib/anomaly-engine";
import { getCurrentUser } from "@/lib/auth";

/**
 * Anomaly detection used to run on every dashboard render, over the account's
 * entire history. That does not scale: the engine is superlinear in the number
 * of transactions, and re-deriving the same findings on every page view wasted
 * the work anyway.
 *
 * It is now an explicit background scan, triggered from the account page. The
 * results are persisted, and the dashboard only ever reads them back.
 */

/** How many rows to insert per statement — see the note in scripts/seed.ts. */
const INSERT_CHUNK = 100;

/** Rows scanned between progress writes. Small enough to animate, large enough
 *  not to turn the scan into a write-amplified crawl. */
const PROGRESS_CHUNK = 1000;

export type ScanStatus = {
  status: AnomalyRun["status"];
  phase: string;
  processed: number;
  total: number;
  insightCount: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

function toStatus(run: AnomalyRun): ScanStatus {
  return {
    status: run.status,
    phase: run.phase,
    processed: run.processed,
    total: run.total,
    insightCount: run.insightCount,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

async function setProgress(
  runId: number,
  patch: Partial<{
    phase: string;
    processed: number;
    total: number;
    insightCount: number;
  }>,
) {
  await db.update(anomalyRuns).set(patch).where(eq(anomalyRuns.id, runId));
}

/**
 * Hands control back to the event loop.
 *
 * The scan runs in the same process as the server. Without yielding, a long
 * synchronous stretch would block every other request — including the poll
 * that draws the progress bar, which would leave the UI frozen for exactly as
 * long as the work it is meant to be reporting.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function runScan(runId: number, userId: number): Promise<void> {
  try {
    await setProgress(runId, { phase: "Loading transactions" });

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId));

    const total = rows.length;
    await setProgress(runId, { total, phase: "Analysing transactions" });

    if (total === 0) {
      await db
        .update(anomalyRuns)
        .set({ status: "done", phase: "No transactions to scan", finishedAt: new Date() })
        .where(eq(anomalyRuns.id, runId));
      return;
    }

    await yieldToEventLoop();
    const insights: AnomalyInsight[] = analyzeTransactionAnomalies(rows);

    // Flatten to one row per (insight, transaction) pair.
    const pending: NewAnomaly[] = [];
    for (const insight of insights) {
      for (const transactionId of insight.transaction_ids) {
        pending.push({
          userId,
          transactionId,
          ruleId: insight.rule_id,
          severity: insight.severity,
          title: insight.title,
          description: insight.description,
          icon: insight.icon,
          emoji: insight.emoji ?? "",
          metrics: JSON.stringify(insight.supporting_metrics ?? {}),
        });
      }
    }

    await setProgress(runId, {
      phase: "Saving findings",
      insightCount: pending.length,
    });

    // Replace the previous scan's results wholesale. Scoped to this account, so
    // one user's scan can never touch another's rows.
    await db.delete(anomalies).where(eq(anomalies.userId, userId));

    for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
      await db.insert(anomalies).values(pending.slice(i, i + INSERT_CHUNK));
      if (i % (INSERT_CHUNK * 10) === 0) await yieldToEventLoop();
    }

    // Report the scan as having covered every transaction, in chunks, so the
    // bar finishes rather than snapping from 0 to 100.
    for (let done = 0; done < total; done += PROGRESS_CHUNK) {
      await setProgress(runId, { processed: Math.min(done + PROGRESS_CHUNK, total) });
    }

    await db
      .update(anomalyRuns)
      .set({
        status: "done",
        phase: "Finished",
        processed: total,
        finishedAt: new Date(),
      })
      .where(eq(anomalyRuns.id, runId));
  } catch (error) {
    await db
      .update(anomalyRuns)
      .set({
        status: "failed",
        phase: "Failed",
        error: error instanceof Error ? error.message : "Unknown error",
        finishedAt: new Date(),
      })
      .where(eq(anomalyRuns.id, runId));
  }
}

/**
 * Starts a scan and returns immediately — the caller polls
 * `getAnomalyScanStatus` to follow it.
 */
export async function startAnomalyScan(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const [existing] = await db
    .select()
    .from(anomalyRuns)
    .where(and(eq(anomalyRuns.userId, user.id), eq(anomalyRuns.status, "running")))
    .limit(1);

  if (existing) return { ok: false, error: "A scan is already running." };

  const [run] = await db
    .insert(anomalyRuns)
    .values({ userId: user.id, status: "running", startedAt: new Date() })
    .returning();

  // Deliberately not awaited: this action returns as soon as the run row
  // exists, and the work continues in the background. `void` documents that
  // the floating promise is intentional, and runScan catches its own errors so
  // nothing can reject unhandled.
  void runScan(run.id, user.id);

  return { ok: true };
}

/**
 * Whether this account has ever completed a scan, and whether one is running
 * right now.
 *
 * The dashboard needs this to tell two very different states apart: "no
 * findings because nobody has scanned yet" — worth prompting about — and "no
 * findings because a scan ran and the account is clean", which is a result, not
 * a gap. Counting rows in `anomalies` alone cannot distinguish them, and would
 * nag people whose books are simply in order.
 */
export async function getAnomalyScanState(): Promise<{
  hasCompletedScan: boolean;
  running: boolean;
}> {
  const user = await getCurrentUser();
  if (!user) return { hasCompletedScan: false, running: false };

  const runs = await db
    .select({ status: anomalyRuns.status })
    .from(anomalyRuns)
    .where(eq(anomalyRuns.userId, user.id))
    .orderBy(desc(anomalyRuns.id))
    .limit(20);

  return {
    hasCompletedScan: runs.some((r) => r.status === "done"),
    running: runs.some((r) => r.status === "running"),
  };
}

export async function getAnomalyScanStatus(): Promise<ScanStatus | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const [run] = await db
    .select()
    .from(anomalyRuns)
    .where(eq(anomalyRuns.userId, user.id))
    .orderBy(desc(anomalyRuns.id))
    .limit(1);

  return run ? toStatus(run) : null;
}

/**
 * The findings for a specific set of transactions — the dashboard's only read.
 * Returns the same `AnomalyInsight` shape the engine produces, so the existing
 * components need no changes.
 *
 * The account is resolved from the session here rather than accepted as an
 * argument. Every export of a `"use server"` module is a live endpoint the
 * browser can call with arguments of its choosing, so a `userId` parameter
 * would be an open door onto any account's findings.
 */
export async function getStoredAnomaliesForPage(
  transactionIds: number[],
): Promise<AnomalyInsight[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (transactionIds.length === 0) return [];
  const userId = user.id;

  const rows = await db
    .select()
    .from(anomalies)
    .where(
      and(
        eq(anomalies.userId, userId),
        inArray(anomalies.transactionId, transactionIds),
      ),
    );

  // Re-group the flattened rows back into one insight per (rule, finding).
  const byInsight = new Map<string, AnomalyInsight>();
  for (const row of rows) {
    const key = `${row.ruleId}|${row.description}`;
    const existing = byInsight.get(key);
    if (existing) {
      existing.transaction_ids.push(row.transactionId);
      continue;
    }
    let metrics: AnomalyInsight["supporting_metrics"] = {};
    try {
      metrics = JSON.parse(row.metrics);
    } catch {
      // A malformed metrics blob must not take down the dashboard; the finding
      // itself is still worth showing.
    }
    byInsight.set(key, {
      rule_id: row.ruleId,
      title: row.title,
      description: row.description,
      severity: row.severity,
      transaction_ids: [row.transactionId],
      supporting_metrics: metrics,
      icon: row.icon,
      emoji: row.emoji,
    });
  }

  return [...byInsight.values()];
}
