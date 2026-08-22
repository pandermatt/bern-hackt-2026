"use server";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getLocale } from "next-intl/server";

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
  emojiFor,
  type AnomalyInsight,
  type AnomalySeverity,
} from "@/lib/anomaly-engine";
import {
  analyzeTransactionInsights,
  type TransactionContext,
} from "@/lib/llm/analyze-insights";
import { getCurrentUser } from "@/lib/auth";
import { getAnomalyText, type TranslatableFinding } from "@/lib/anomaly-text";
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
 * The scan carries the reader's locale only for the narrative layer's sake:
 * the deterministic findings are stored as rule plus values and translated
 * when they are read, but the model writes prose, and prose has to be written
 * in some language at the moment it is written. Findings scanned in German and
 * read in English fall back to the rule messages — see `lib/anomaly-text.ts`.
 */
async function runScan(runId: number, userId: number, locale: AppLocale): Promise<void> {
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
 * now, and whether the last one's findings still describe the transactions.
 *
 * The dashboard needs this to tell three very different states apart: "no
 * findings because nobody has scanned yet" — worth prompting about — "no
 * findings because a scan ran and the account is clean", which is a result and
 * not a gap, and a completed scan whose findings all point at transactions that
 * no longer exist. Counting rows in `anomalies` alone cannot distinguish any of
 * them, and would nag people whose books are simply in order.
 *
 * Staleness is two existence probes rather than a count: whether the account
 * has any findings at all, and whether any of them still lands on a live
 * transaction. `anomalies.transactionId` is deliberately not a foreign key — a
 * scan is a snapshot, and a re-import reissues transaction ids — so the rows
 * outlive what they describe and the intersection is the only honest test. It
 * is the same question `getAnomalyOverview` answers from the rows it has
 * already loaded; here there are no rows to load, so it asks SQLite.
 */
export async function getAnomalyScanState(): Promise<{
  hasCompletedScan: boolean;
  running: boolean;
  stale: boolean;
}> {
  const user = await getCurrentUser();
  if (!user) return { hasCompletedScan: false, running: false, stale: false };

  const [runs, anyFinding, anyLiveFinding] = await Promise.all([
    db
      .select({ status: anomalyRuns.status })
      .from(anomalyRuns)
      .where(eq(anomalyRuns.userId, user.id))
      .orderBy(desc(anomalyRuns.id))
      .limit(20),
    db
      .select({ id: anomalies.id })
      .from(anomalies)
      .where(eq(anomalies.userId, user.id))
      .limit(1),
    db
      .select({ id: anomalies.id })
      .from(anomalies)
      .innerJoin(transactions, eq(anomalies.transactionId, transactions.id))
      .where(
        and(eq(anomalies.userId, user.id), eq(transactions.userId, user.id)),
      )
      .limit(1),
  ]);

  return {
    hasCompletedScan: runs.some((r) => r.status === "done"),
    running: runs.some((r) => r.status === "running"),
    stale: anyFinding.length > 0 && anyLiveFinding.length === 0,
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
  emoji: string;
  severity: AnomalySeverity;
  /** The most recent finding's own words — see the note in `getAnomalyOverview`. */
  description: string;
  /** Distinct transactions, and only ones that still exist. */
  transactionCount: number;
  latestOn: string | null;
};

export type AnomalyOverview = {
  action: AnomalyGroup[];
  context: AnomalyGroup[];
  hasCompletedScan: boolean;
  running: boolean;
  /**
   * Findings exist, but every one of them points at a transaction that is gone
   * — the statements were re-imported after the last scan, and ids are reissued
   * on the way in. Without this the page would report "nothing looks off",
   * which is the one wrong answer: nothing was checked, and the state is one
   * re-scan away from being right.
   */
  stale: boolean;
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
export async function getAnomalyOverview(): Promise<AnomalyOverview> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      action: [],
      context: [],
      hasCompletedScan: false,
      running: false,
      stale: false,
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
          emoji: row.emoji || emojiFor(row.ruleId),
          severity: row.severity,
          description: text.description,
          transactionCount: 0,
          latestOn: null,
        },
        ids: new Set(),
        latestSeen: null,
      };
      buckets.set(row.ruleId, bucket);
    }

    bucket.ids.add(row.transactionId);
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
    groups.push(bucket.group);
  }

  const byLatest = (a: AnomalyGroup, b: AnomalyGroup) =>
    (b.latestOn ?? "").localeCompare(a.latestOn ?? "") ||
    b.transactionCount - a.transactionCount ||
    a.ruleId.localeCompare(b.ruleId);

  return {
    // Severity leads here because it is the engine's own claim about urgency,
    // and it is the order the ledger badges already use. It is close to a
    // per-rule constant though, so recency is the real discriminator.
    action: groups
      .filter((g) => attentionFor(g.ruleId) === "action")
      .sort(
        (a, b) =>
          SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || byLatest(a, b),
      ),
    // Severity is a dead key in this column — nearly everything here is "low" —
    // so it reads as a feed of what is new.
    context: groups.filter((g) => attentionFor(g.ruleId) === "context").sort(byLatest),
    ...scan,
    // Deliberately overrides the `stale` the scan state carries: that one asks
    // SQLite the same question, this one answers it from the very rows the page
    // is about to render, so the flag and the empty list can never disagree.
    stale: rows.length > 0 && groups.length === 0,
  };
}

/** The same shape the ledger's `?anomaly=` filter accepts. */
const RULE_ID_PATTERN = /^[A-Z_]{1,60}$/;

export type AnomalyRuleDetail = {
  ruleId: string;
  title: string;
  emoji: string;
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
      emoji: anomalies.emoji,
      severity: anomalies.severity,
      params: anomalies.params,
      baseRuleId: anomalies.baseRuleId,
      narrativeLocale: anomalies.narrativeLocale,
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
    emoji: usable[0]?.emoji || emojiFor(ruleId),
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
  };
}
