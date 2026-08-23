"use server";

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db";
import {
  anomalies,
  anomalyRuns,
  transactions,
  type AnomalyRun,
  type NewAnomaly,
  type Transaction,
} from "@/db/schema";
import {
  analyzeTransactionAnomalies,
  attentionFor,
  strongestKind,
  type AnomalyInsight,
  type AnomalyKind,
  type AnomalySeverity,
} from "@/lib/anomaly-engine";
import {
  analyzeTransactionInsights,
  type TransactionContext,
} from "@/lib/llm/analyze-insights";
import { getCurrentUser } from "@/lib/auth";
import {
  applyMerchantOverrides,
  merchantOverridesFor,
} from "@/lib/merchant-overrides";
import { isGroupResolved } from "@/lib/nudges";
import { getAnomalyText, type TranslatableFinding } from "@/lib/anomaly-text";
import { fingerprintOf } from "@/lib/anomaly-sync";
import { defaultLocale, isAppLocale, type AppLocale } from "@/i18n/routing";

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

/** Share of the bar the analysis phase owns, before the LLM phase starts. */
const ANALYSIS_SHARE = 0.1;

/** Share the LLM phase walks through, leaving the tail for the inserts. */
const AI_SHARE = 0.85;

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

/**
 * The key a resolution is remembered by, across a scan and across a re-import.
 *
 * Not the transaction id. `scripts/seed.ts` and `lib/demo-loader.ts` both
 * delete-then-insert, and `npm run start` runs the seed on every boot, so ids
 * are reissued on every deploy. `transactions.externalId` is the statement
 * line's own natural key and survives that.
 */
function resolutionKey(ruleId: string, externalId: string): string {
  return `${ruleId}|${externalId}`;
}

/**
 * The resolutions to lift over the wholesale delete, keyed by
 * `resolutionKey`.
 *
 * A scan replaces its predecessor's findings entirely — that is what makes
 * re-running idempotent — but the work someone did ticking findings off is not
 * the scan's to throw away. Read before the delete, re-stamped on the way back
 * in.
 *
 * `idToExternal` covers rows written before `transactionExternalId` existed:
 * their key is recovered from the current transactions table, which is right
 * up until the next re-import and no worse than nothing after it.
 */
async function priorResolutions(
  userId: number,
  idToExternal: Map<number, string>,
): Promise<Map<string, Date>> {
  const prior = await db
    .select({
      ruleId: anomalies.ruleId,
      transactionId: anomalies.transactionId,
      transactionExternalId: anomalies.transactionExternalId,
      resolvedAt: anomalies.resolvedAt,
    })
    .from(anomalies)
    .where(and(eq(anomalies.userId, userId), isNotNull(anomalies.resolvedAt)));

  const carried = new Map<string, Date>();
  for (const row of prior) {
    const externalId =
      row.transactionExternalId ?? idToExternal.get(row.transactionId);
    // Neither stored nor recoverable: the transaction is gone and there is
    // nothing left to match the next scan's finding against.
    if (!externalId || !row.resolvedAt) continue;
    carried.set(resolutionKey(row.ruleId, externalId), row.resolvedAt);
  }
  return carried;
}

/** The carried timestamp for one finding, or `null` if it was never ticked off. */
function resolvedAtFor(
  carried: Map<string, Date>,
  idToExternal: Map<number, string>,
  ruleId: string,
  transactionId: number,
): Date | null {
  const externalId = idToExternal.get(transactionId);
  if (!externalId) return null;
  return carried.get(resolutionKey(ruleId, externalId)) ?? null;
}

/**
 * The scan carries the reader's locale only for the narrative layer's sake:
 * the deterministic findings are stored as rule plus values and translated
 * when they are read, but the model writes prose, and prose has to be written
 * in some language at the moment it is written. Findings scanned in German and
 * read in English fall back to the rule messages — see `lib/anomaly-text.ts`.
 */
async function runScan(runId: number, userId: number, locale: AppLocale): Promise<void> {
  try {
    await setProgress(runId, { phase: "Loading transactions" });

    // Overridden the same way the ledger reads them: several rules take their
    // baseline from a merchant's *category*, so a scan over the importer's
    // answer would explain a finding in terms of a category the reader no
    // longer sees on the row.
    const rows = applyMerchantOverrides(
      await db.select().from(transactions).where(eq(transactions.userId, userId)),
      await merchantOverridesFor(userId),
    );

    const total = rows.length;
    await setProgress(runId, { total, phase: "Analysing transactions" });

    // Read before anything is deleted, and before the analysis — the delete
    // below is wholesale, so this is the only moment the previous scan's
    // resolutions still exist.
    const idToExternal = new Map(rows.map((row) => [row.id, row.externalId]));
    const carried = await priorResolutions(userId, idToExternal);

    if (total === 0) {
      await db
        .update(anomalyRuns)
        .set({
          status: "done",
          phase: "No transactions to scan",
          // Stamped here too, or an account with nothing in it would read as
          // permanently out of date.
          transactionFingerprint: fingerprintOf([]),
          finishedAt: new Date(),
        })
        .where(eq(anomalyRuns.id, runId));
      return;
    }

    await yieldToEventLoop();
    let insights: AnomalyInsight[] = analyzeTransactionAnomalies(rows);

    if (insights.length > 0) {
      await setProgress(runId, {
        phase: "Generating insights with AI",
        processed: Math.floor(total * ANALYSIS_SHARE),
      });

      /*
       * The narrative layer groups findings by merchant and month, but the
       * rules that produce the most findings — amount spikes, repeat charges —
       * record neither in their metrics, and their descriptions do not name the
       * merchant either. The ledger is already in memory, so hand it over
       * rather than let the model guess.
       */
      const context = new Map<number, TransactionContext>();
      for (const row of rows) {
        context.set(row.id, {
          merchant: row.merchant,
          category: row.category,
          month: row.bookedOn.slice(0, 7),
        });
      }

      insights = await analyzeTransactionInsights(insights, {
        contextOf: (id) => context.get(id),

        // The model writes prose, and prose has to be written in some language
        // at the moment it is written — the deterministic findings around it
        // are translated when they are read instead.
        locale,

        /*
         * Real progress, one step per batch. This used to be a timer walking
         * the bar forward on no information at all, which reached its clamp in
         * ten seconds and then sat frozen for the rest of the phase.
         */
        onProgress: (done, batches) => {
          const share = ANALYSIS_SHARE + AI_SHARE * (done / batches);
          // Floating on purpose: a dropped progress write is not worth failing
          // a scan over, and nothing downstream reads it back.
          void setProgress(runId, {
            phase: `Generating insights with AI (${done}/${batches})`,
            processed: Math.min(total - 1, Math.floor(total * share)),
          }).catch(() => {});
        },
      });
    }

    await setProgress(runId, { processed: total });

    // Flatten to one row per (insight, transaction) pair.
    const pending: NewAnomaly[] = [];
    for (const insight of insights) {
      for (const transactionId of insight.transaction_ids) {
        pending.push({
          userId,
          transactionId,
          ruleId: insight.rule_id,
          severity: insight.severity,
          kind: insight.kind,
          title: insight.title,
          description: insight.description,
          icon: insight.icon,
          emoji: insight.emoji ?? "",
          metrics: JSON.stringify(insight.supporting_metrics ?? {}),
          baseRuleId: insight.base_rule_id ?? insight.rule_id,
          params: insight.params ? JSON.stringify(insight.params) : null,
          narrativeLocale: insight.narrative_locale ?? null,
          transactionExternalId: idToExternal.get(transactionId) ?? null,
          /*
           * The original timestamp, not `new Date()`: the scan did not resolve
           * anything, it only carried a resolution across its own delete.
           */
          resolvedAt: resolvedAtFor(carried, idToExternal, insight.rule_id, transactionId),
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

    await db
      .update(anomalyRuns)
      .set({
        status: "done",
        phase: "Finished",
        processed: total,
        /*
         * What this scan actually covered. Computed from the rows already in
         * memory, so it costs no extra query, and it is what
         * `getAnomalyScanState` later compares against to decide whether the
         * statements have moved on.
         */
        transactionFingerprint: fingerprintOf(rows.map((row) => row.externalId)),
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

export type ScanError = "sessionExpired" | "alreadyRunning";

/**
 * Starts a scan and returns immediately — the caller polls
 * `getAnomalyScanStatus` to follow it.
 *
 * The failure is a code rather than a sentence: a server action has no reader
 * to write for, and the toast that shows it is rendered in whichever language
 * the page is in. `AnomalyScan.error*` holds the words.
 */
export async function startAnomalyScan(): Promise<
  { ok: true } | { ok: false; error: ScanError }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "sessionExpired" };

  const [existing] = await db
    .select()
    .from(anomalyRuns)
    .where(and(eq(anomalyRuns.userId, user.id), eq(anomalyRuns.status, "running")))
    .limit(1);

  if (existing) return { ok: false, error: "alreadyRunning" };

  const [run] = await db
    .insert(anomalyRuns)
    .values({ userId: user.id, status: "running", startedAt: new Date() })
    .returning();

  // The locale is resolved here rather than inside the scan: `getLocale()`
  // reads the request, and by the time the background work runs there is no
  // request left to read.
  const requested = await getLocale();
  const locale = isAppLocale(requested) ? requested : defaultLocale;

  // Deliberately not awaited: this action returns as soon as the run row
  // exists, and the work continues in the background. `void` documents that
  // the floating promise is intentional, and runScan catches its own errors so
  // nothing can reject unhandled.
  void runScan(run.id, user.id, locale);

  return { ok: true };
}

/**
 * Whether this account has ever completed a scan, whether one is running right
 * now, and whether the last one still describes the current statements.
 *
 * The dashboard needs this to tell three very different states apart: "no
 * findings because nobody has scanned yet" -- worth prompting about -- "no
 * findings because a scan ran and the account is clean", which is a result and
 * not a gap, and a completed scan the statements have since moved past.
 *
 * **`outdated` is a content comparison, not a timestamp one.** Every importer
 * delete-then-inserts and `npm run start` re-seeds on every boot, so
 * `transactions.createdAt` and the transaction ids are both reset constantly;
 * anything derived from them reported a scan as out of date on every single
 * deploy, which is what trained people to re-run the detection by reflex. The
 * fingerprint is over the natural keys, so re-importing identical statements
 * changes nothing.
 *
 * This replaced a pair of existence probes asking whether any finding still
 * landed on a live transaction. That question is now answered at import time by
 * `rebindAnomalies`, which re-points the findings instead of letting them
 * orphan, so it can no longer be true for the reason it used to be.
 *
 * The cost is one column scan of the account's transactions per call, where it
 * used to be two indexed `limit 1` probes. At this size that is well inside the
 * house rule -- `getDashboard` already loads every row of the account. Past
 * ~50k rows per account, compare `anomalyRuns.total` against a `count(*)` first
 * and only hash when the counts agree.
 */
export async function getAnomalyScanState(): Promise<{
  hasCompletedScan: boolean;
  running: boolean;
  outdated: boolean;
}> {
  const user = await getCurrentUser();
  if (!user) return { hasCompletedScan: false, running: false, outdated: false };

  const [runs, lastDone, live] = await Promise.all([
    db
      .select({ status: anomalyRuns.status })
      .from(anomalyRuns)
      .where(eq(anomalyRuns.userId, user.id))
      .orderBy(desc(anomalyRuns.id))
      .limit(20),
    db
      .select({ transactionFingerprint: anomalyRuns.transactionFingerprint })
      .from(anomalyRuns)
      .where(and(eq(anomalyRuns.userId, user.id), eq(anomalyRuns.status, "done")))
      .orderBy(desc(anomalyRuns.id))
      .limit(1),
    db
      .select({ externalId: transactions.externalId })
      .from(transactions)
      .where(eq(transactions.userId, user.id)),
  ]);

  const scanned = lastDone[0]?.transactionFingerprint ?? null;

  return {
    hasCompletedScan: runs.some((r) => r.status === "done"),
    running: runs.some((r) => r.status === "running"),
    /*
     * A NULL fingerprint is "unknown", not "outdated". Scans that predate the
     * column should not start nagging just because it shipped -- they are one
     * re-scan away from being knowable, and until then silence is the better
     * wrong answer than a permanent prompt.
     */
    outdated:
      scanned !== null &&
      scanned !== fingerprintOf(live.map((row) => row.externalId)),
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
    /*
     * Severity and kind belong in the key. Two findings can share a rule and a
     * wording and still be classified differently — the narrative layer sees
     * them in separate batches — and merging those would silently hand the
     * second one the first's colour.
     */
    const key = `${row.ruleId}|${row.severity}|${row.kind}|${row.description}`;
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
    const params = parseParams(row.params) ?? undefined;
    byInsight.set(key, {
      rule_id: row.ruleId,
      title: row.title,
      description: row.description,
      params,
      base_rule_id: row.baseRuleId ?? row.ruleId,
      narrative_locale: row.narrativeLocale ?? undefined,
      severity: row.severity,
      kind: row.kind,
      transaction_ids: [row.transactionId],
      supporting_metrics: metrics,
      icon: row.icon,
      emoji: row.emoji,
    });
  }

  return [...byInsight.values()];
}

/**
 * The stored values a finding is re-rendered from, or `null` when the blob is
 * unreadable — which costs the translation, never the finding itself.
 */
function parseParams(params: string | null): TranslatableFinding["params"] {
  if (!params) return null;
  try {
    return JSON.parse(params);
  } catch {
    return null;
  }
}

/**
 * A stored row as the text resolver wants it.
 *
 * The columns are the same three everywhere: the rule whose message renders
 * this finding, the values that message needs, and the language the stored
 * sentence is in when a model wrote it. See `lib/anomaly-text.ts`.
 */
function findingOf(row: {
  ruleId: string;
  title: string;
  description: string;
  params: string | null;
  baseRuleId: string | null;
  narrativeLocale: string | null;
}): TranslatableFinding {
  return {
    rule_id: row.ruleId,
    title: row.title,
    description: row.description,
    params: parseParams(row.params),
    base_rule_id: row.baseRuleId,
    narrative_locale: row.narrativeLocale,
  };
}

/** One kind of finding, and how much of it there is. */
export type AnomalyGroup = {
  ruleId: string;
  title: string;
  /** The rule's own lucide name, so the row wears the badge the ledger wears. */
  icon: string;
  severity: AnomalySeverity;
  /** The most recent finding's own words — see the note in `getAnomalyOverview`. */
  description: string;
  /** Distinct transactions, and only ones that still exist. */
  transactionCount: number;
  /**
   * How many of those have been ticked off. A transaction counts as resolved
   * only when *every* finding of this rule pointing at it is — one rule can
   * flag the same transaction twice, and a half-resolved row is not done.
   */
  resolvedCount: number;
  latestOn: string | null;
};

export type AnomalyOverview = {
  action: AnomalyGroup[];
  context: AnomalyGroup[];
  hasCompletedScan: boolean;
  running: boolean;
  /**
   * The statements have changed since the last completed scan, so its findings
   * no longer describe them. Without this the page would report "nothing looks
   * off" for an account nobody has looked at in its current shape, which is the
   * one wrong answer.
   *
   * Passed straight through from `getAnomalyScanState`. It used to be
   * recomputed here as "findings exist but none land on a live transaction" —
   * that condition is gone now that `rebindAnomalies` re-points findings at
   * import time instead of letting them orphan, and recomputing it here would
   * report a clean re-import as a problem.
   */
  outdated: boolean;
  /**
   * How many kinds of finding are fully worked through — counted before
   * `hideResolved` takes them out, which is what lets the page tell "you have
   * resolved everything" apart from "the scan found nothing". Only the second
   * is a statement about the statements.
   */
  resolvedGroupCount: number;
};

const SEVERITY_ORDER: Record<AnomalySeverity, number> = { high: 3, medium: 2, low: 1 };

/**
 * Every finding this account has, folded into one row per kind.
 *
 * No arguments, and the account comes from the session — every export of a
 * `"use server"` module is an endpoint the browser can call with arguments of
 * its choosing, so a `userId` parameter here would be a door onto anyone's
 * findings.
 *
 * Three things this deliberately does not do:
 *
 *  - It does not reuse the `ruleId|description` regrouping above. That key
 *    collides by design — `UNUSUALLY_LARGE_TRANSACTION` describes itself with
 *    the amount alone, so two separate CHF 1'766.50 purchases months apart
 *    would fold into one "finding" and the count would understate. Counting
 *    distinct transactions needs no such key.
 *  - It does not trust `anomalies.transactionId`. That column is deliberately
 *    not a foreign key (a scan is a snapshot), so findings outlive the rows
 *    they point at. Counting them raw would advertise five transactions and
 *    then show none, so the count is an intersection with live rows and a group
 *    with nothing left is dropped entirely rather than rendered as a dead link.
 *  - It does not leave the order to SQLite. There is no `ORDER BY` on the read,
 *    so without a total sort — tie-broken on `ruleId` — the page would
 *    reshuffle itself between renders.
 */
export async function getAnomalyOverview(
  hideResolved = false,
): Promise<AnomalyOverview> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      action: [],
      context: [],
      hasCompletedScan: false,
      running: false,
      outdated: false,
      resolvedGroupCount: 0,
    };
  }

  const scan = await getAnomalyScanState();

  // The stored sentence is the scan's; what this page shows is the reader's.
  const anomalyText = await getAnomalyText();

  const [rows, live] = await Promise.all([
    db
      .select()
      .from(anomalies)
      .where(eq(anomalies.userId, user.id)),
    db
      .select({ id: transactions.id, bookedOn: transactions.bookedOn })
      .from(transactions)
      .where(eq(transactions.userId, user.id)),
  ]);

  const bookedOn = new Map(live.map((t) => [t.id, t.bookedOn]));

  type Bucket = {
    group: AnomalyGroup;
    ids: Set<number>;
    /** Transactions with at least one finding of this rule still open. */
    openIds: Set<number>;
    /** Tracks which description belongs to `latestOn`. */
    latestSeen: string | null;
  };
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const day = bookedOn.get(row.transactionId);
    // A finding whose transaction is gone — a re-import since the last scan.
    if (day === undefined) continue;

    const text = anomalyText(findingOf(row));

    let bucket = buckets.get(row.ruleId);
    if (!bucket) {
      bucket = {
        group: {
          ruleId: row.ruleId,
          title: text.title,
          icon: row.icon,
          severity: row.severity,
          description: text.description,
          transactionCount: 0,
          resolvedCount: 0,
          latestOn: null,
        },
        ids: new Set(),
        openIds: new Set(),
        latestSeen: null,
      };
      buckets.set(row.ruleId, bucket);
    }

    bucket.ids.add(row.transactionId);
    if (row.resolvedAt === null) bucket.openIds.add(row.transactionId);
    if (SEVERITY_ORDER[row.severity] > SEVERITY_ORDER[bucket.group.severity]) {
      bucket.group.severity = row.severity;
    }
    // The newest finding's prose, because for the absence-shaped rules the
    // description is the only place the finding actually is: a missed salary
    // links to the last salary that *did* arrive, which explains nothing on its
    // own.
    if (bucket.latestSeen === null || day > bucket.latestSeen) {
      bucket.latestSeen = day;
      bucket.group.latestOn = day;
      bucket.group.description = text.description;
    }
  }

  const groups: AnomalyGroup[] = [];
  for (const bucket of buckets.values()) {
    bucket.group.transactionCount = bucket.ids.size;
    bucket.group.resolvedCount = bucket.ids.size - bucket.openIds.size;
    groups.push(bucket.group);
  }

  const byLatest = (a: AnomalyGroup, b: AnomalyGroup) =>
    (b.latestOn ?? "").localeCompare(a.latestOn ?? "") ||
    b.transactionCount - a.transactionCount ||
    a.ruleId.localeCompare(b.ruleId);

  /*
   * A rule with nothing left open is done, so it leaves the list entirely.
   * Partly-worked rules stay — with their ring drawn empty, because what the
   * ring reports is what the list is showing.
   */
  const visible = hideResolved
    ? groups.filter((g) => g.resolvedCount < g.transactionCount)
    : groups;

  return {
    // Severity leads here because it is the engine's own claim about urgency,
    // and it is the order the ledger badges already use. It is close to a
    // per-rule constant though, so recency is the real discriminator.
    action: visible
      .filter((g) => attentionFor(g.ruleId) === "action")
      .sort(
        (a, b) =>
          SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || byLatest(a, b),
      ),
    // Severity is a dead key in this column — nearly everything here is "low" —
    // so it reads as a feed of what is new.
    context: visible.filter((g) => attentionFor(g.ruleId) === "context").sort(byLatest),
    resolvedGroupCount: groups.filter(isGroupResolved).length,
    ...scan,
  };
}

/** The same shape the ledger's `?anomaly=` filter accepts. */
const RULE_ID_PATTERN = /^[A-Z_]{1,60}$/;

export type AnomalyRuleDetail = {
  ruleId: string;
  title: string;
  icon: string;
  severity: AnomalySeverity;
  /**
   * The one finding that named transaction belongs to — the four charges of a
   * single duplicate billing, rather than every duplicate of the year. `null`
   * when no transaction was named, or when the one named is gone.
   */
  focus: { description: string; rows: Transaction[]; totalMinor: number } | null;
  /** Everything else this rule flagged, newest first. */
  others: Transaction[];
  transactionCount: number;
  /**
   * The live transactions fully ticked off under this rule — every finding of
   * it pointing at them is resolved. An array rather than a `Set` because it
   * crosses into a server component's props.
   */
  resolvedIds: number[];
};

/**
 * One rule, everything it found, and which of it the reader asked about.
 *
 * `ruleId` is a parameter where `userId` never could be: it only narrows a set
 * already scoped to the session, so the worst a caller can do by choosing it is
 * look at their own data differently.
 *
 * On identifying "this finding": a finding has no id of its own — its identity
 * is the composite of rule and description, which collides for the rules whose
 * description omits the date (`UNUSUALLY_LARGE_TRANSACTION` describes itself
 * with the amount alone, so two purchases months apart read alike). This never
 * needs to solve that in general, only to answer "which finding is the one
 * covering this transaction", which resolves exactly: take that row's
 * description, and the finding is every row sharing it. Where the composite is
 * genuinely ambiguous the two findings read as one thing to a person anyway.
 */
export async function getAnomalyRuleDetail(
  ruleId: string,
  focusTransactionId?: number,
): Promise<AnomalyRuleDetail | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  // Checked before the query, so a hand-edited URL is a 404 rather than a scan.
  if (!RULE_ID_PATTERN.test(ruleId)) return null;

  const found = await db
    .select({
      transactionId: anomalies.transactionId,
      ruleId: anomalies.ruleId,
      description: anomalies.description,
      title: anomalies.title,
      icon: anomalies.icon,
      severity: anomalies.severity,
      params: anomalies.params,
      baseRuleId: anomalies.baseRuleId,
      narrativeLocale: anomalies.narrativeLocale,
      resolvedAt: anomalies.resolvedAt,
    })
    .from(anomalies)
    .where(and(eq(anomalies.userId, user.id), eq(anomalies.ruleId, ruleId)));

  if (found.length === 0) return null;

  // Only the rows the findings point at, and only ones that still exist — a
  // scan is a snapshot, so findings outlive a re-import.
  const live = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, user.id),
        inArray(
          transactions.id,
          found.map((f) => f.transactionId),
        ),
      ),
    )
    .orderBy(desc(transactions.bookedOn), asc(transactions.id));

  if (live.length === 0) return null;

  const liveIds = new Set(live.map((t) => t.id));
  const usable = found.filter((f) => liveIds.has(f.transactionId));

  const focusDescription =
    focusTransactionId === undefined
      ? null
      : (usable.find((f) => f.transactionId === focusTransactionId)?.description ?? null);

  const focusIds = new Set(
    focusDescription === null
      ? []
      : usable.filter((f) => f.description === focusDescription).map((f) => f.transactionId),
  );

  const focusRows = live.filter((t) => focusIds.has(t.id));
  const others = live.filter((t) => !focusIds.has(t.id));

  /*
   * Translated after the grouping, not before: a finding's identity is its
   * stored description (see the note above), and re-keying that on translated
   * prose would make which rows belong together depend on the reader.
   */
  const anomalyText = await getAnomalyText();
  const focusFinding = usable.find((f) => f.description === focusDescription);

  return {
    ruleId,
    title: usable[0] ? anomalyText(findingOf(usable[0])).title : ruleId,
    icon: usable[0]?.icon ?? "",
    severity: usable.reduce<AnomalySeverity>(
      (worst, f) => (SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[worst] ? f.severity : worst),
      "low",
    ),
    focus:
      focusDescription === null || focusRows.length === 0
        ? null
        : {
            description: focusFinding
              ? anomalyText(findingOf(focusFinding)).description
              : focusDescription,
            rows: focusRows,
            totalMinor: focusRows.reduce((sum, t) => sum + Math.abs(t.amountMinor), 0),
          },
    others,
    transactionCount: live.length,
    /*
     * Resolved means every finding of this rule on that transaction is — one
     * rule can flag the same row twice, and half of it being ticked off is not
     * the same as being done with it.
     */
    resolvedIds: [...liveIds].filter((id) =>
      usable.every((f) => f.transactionId !== id || f.resolvedAt !== null),
    ),
  };
}

/**
 * The worst kind flagged against each transaction, for the whole account.
 *
 * The calendar's read. Unlike `getStoredAnomaliesForPage` this is not bounded
 * by a page of ids — a month grid is a summary of every day in it, so there is
 * no page to bound it by — which is why it selects two columns rather than the
 * row: one covering scan of `anomalies_user_id_idx`, no metrics blobs parsed,
 * and nothing but a classification crossing back.
 *
 * `kind`, not `severity`. Severity is how far from baseline a number sits; kind
 * is how much a person should worry, and it is what the ledger's rows and
 * badges are already coloured by. A day tinted on one axis above a row tinted
 * on the other would be two classifications of the same event.
 *
 * The account is resolved from the session, never from an argument — same
 * contract as every other export here.
 */
export async function getAnomalyKindByTransaction(): Promise<
  Map<number, AnomalyKind>
> {
  const user = await getCurrentUser();
  if (!user) return new Map();

  const rows = await db
    .select({
      transactionId: anomalies.transactionId,
      kind: anomalies.kind,
    })
    .from(anomalies)
    .where(eq(anomalies.userId, user.id));

  const worst = new Map<number, AnomalyKind>();
  for (const row of rows) {
    const seen = worst.get(row.transactionId);
    worst.set(row.transactionId, seen ? strongestKind(seen, row.kind) : row.kind);
  }

  return worst;
}

export type ResolveResult = { ok: true; changed: number } | { ok: false; error: string };

/**
 * Errors are phrased here, not in the component — the client raises whatever
 * string it gets straight into a toast, so it has to arrive translated. Same
 * shape `app/actions/budget.ts` uses.
 */
async function resolveError(key: string): Promise<ResolveResult> {
  const t = await getTranslations("AnomalyErrors");
  return { ok: false, error: t(key) };
}

const resolveInputSchema = z.object({
  ruleId: z.string().regex(RULE_ID_PATTERN),
  /** Omitted means every finding of this rule — the subpage's "resolve all". */
  transactionIds: z.array(z.number().int().finite()).max(5000).optional(),
  resolved: z.boolean(),
});

/**
 * Tick a set of findings off, or put them back.
 *
 * The account is resolved from the session, never from an argument — every
 * export of a `"use server"` module is an endpoint the browser can call with
 * arguments of its choosing. `ruleId` and `transactionIds` are safe parameters
 * where `userId` never could be: they only narrow a set already scoped to the
 * session, so the worst a caller can do by choosing them is change their own
 * data.
 *
 * `resolved` rather than a toggle computed here: the caller already knows what
 * it is looking at, and a server-side flip would race two clicks into a no-op.
 *
 * The `{ ok }` envelope is the mutation contract; the reads above return their
 * data directly.
 */
export async function setAnomalyResolved(input: {
  ruleId: string;
  transactionIds?: number[];
  resolved: boolean;
}): Promise<ResolveResult> {
  const user = await getCurrentUser();
  if (!user) return resolveError("notSignedIn");

  // Checked before the query, so a hand-edited rule id is a rejection rather
  // than a scan.
  const parsed = resolveInputSchema.safeParse(input);
  if (!parsed.success) return resolveError("unknownRule");
  const { ruleId, transactionIds, resolved } = parsed.data;
  if (transactionIds?.length === 0) return { ok: true, changed: 0 };

  const scope = and(
    eq(anomalies.userId, user.id),
    eq(anomalies.ruleId, ruleId),
    ...(transactionIds ? [inArray(anomalies.transactionId, transactionIds)] : []),
  );

  try {
    /*
     * Backfilling the natural key is what makes a resolution stick. Rows
     * written before `transaction_external_id` existed carry none, and without
     * it the next re-import — which every `npm run start` performs — would
     * leave this resolution with nothing to match against. Done in the same
     * transaction as the update, so a row is never resolved without its key.
     */
    const changed = db.transaction((tx) => {
      const targets = tx
        .select({
          id: anomalies.id,
          transactionId: anomalies.transactionId,
          transactionExternalId: anomalies.transactionExternalId,
        })
        .from(anomalies)
        .where(scope)
        .all();

      if (targets.length === 0) return 0;

      const missing = targets.filter((row) => row.transactionExternalId === null);
      if (missing.length > 0) {
        const live = tx
          .select({ id: transactions.id, externalId: transactions.externalId })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, user.id),
              inArray(
                transactions.id,
                missing.map((row) => row.transactionId),
              ),
            ),
          )
          .all();
        const idToExternal = new Map(live.map((row) => [row.id, row.externalId]));
        for (const row of missing) {
          const externalId = idToExternal.get(row.transactionId);
          if (!externalId) continue;
          tx
            .update(anomalies)
            .set({ transactionExternalId: externalId })
            .where(eq(anomalies.id, row.id))
            .run();
        }
      }

      tx
        .update(anomalies)
        .set({ resolvedAt: resolved ? new Date() : null })
        .where(scope)
        .run();

      return targets.length;
    });

    revalidatePath("/[locale]/anomalies", "page");
    revalidatePath("/[locale]/anomalies/[ruleId]", "page");
    return { ok: true, changed };
  } catch {
    return resolveError("saveFailed");
  }
}
