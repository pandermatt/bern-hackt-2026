import { z } from "zod";

import {
  canEscalateToAlert,
  normalizeMerchant,
  strongestKind,
  type AnomalyInsight,
  type AnomalyKind,
  type AnomalySeverity,
} from "@/lib/anomaly-engine";

/*
 * The narrative layer.
 *
 * The anomaly engine has already decided what is unusual, how unusual, which
 * transactions are involved, every number quoted, and how much concern it
 * warrants. This module does the one thing none of that can: when a single
 * transaction collects a pile of findings, it says what they add up to.
 *
 * It is deliberately not asked to do more. The engine's own descriptions are
 * already numerically exact — "Apple Online Store charged CHF 35.00 2 times on
 * 14 Sep 2025, totalling CHF 70.00" — so a model rewriting them can only
 * paraphrase, at the cost of a network round trip and a chance to get a number
 * wrong. And classification stays deterministic: `canEscalateToAlert` in the
 * engine decides what turns red, because "this may not have been you" is not a
 * sentence to let an 8B model reach on its own.
 *
 * Everything except `title` and `description` is restored from the
 * deterministic findings after the model has spoken. A failure at any point
 * returns them untouched: the LLM is an enhancement, and a scan that cannot
 * reach it is still a useful scan.
 */

const APERTUS_URL =
  process.env.APERTUS_URL ??
  "https://llm.stoney-cloud.com/v1/chat/completions";

/**
 * Findings per request.
 *
 * The binding constraint is output, not input: one narrative runs 75-90 tokens,
 * so ten worst-case (nothing merged) is ~900 against a 1500 cap. The headroom is
 * the point — a response that runs over the cap is truncated mid-JSON, which is
 * unparseable, which loses the whole batch. Do not raise this to buy fewer
 * round trips.
 */
const MAX_BATCH_CANDIDATES = 10;

/** Second cap, against a pathological metrics blob rather than the normal path. */
const MAX_BATCH_CHARS = 6000;

/** Metrics sent per finding. The tail of a long blob is rarely the interesting part. */
const MAX_METRIC_KEYS = 6;

/** Per-request timeout. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Ceiling on the whole LLM phase, across every batch.
 *
 * A scan holds a `running` row that blocks the account from starting another,
 * so an endpoint that has gone slow rather than down must not be able to stretch
 * one scan indefinitely. When this trips the remaining batches fall back
 * deterministically and the scan finishes.
 */
const TOTAL_DEADLINE_MS = 120_000;

/** The whole of what the model may write. */
const llmInsightSchema = z.object({
  source_ids: z.array(z.string()).min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  /*
   * The model's half of the alert gate, and the only classification it may
   * touch. Optional because most answers should omit it, and unvalidated
   * beyond the enum: `buildFinalInsight` decides what it is worth, and a
   * proposal the engine will not co-sign costs nothing to ignore.
   */
  kind: z.enum(["info", "warning", "alert"]).optional(),
});

const llmResponseSchema = z.object({
  insights: z.array(llmInsightSchema),
});

type LlmInsight = z.infer<typeof llmInsightSchema>;

/**
 * A finding paired with a handle the model can cite.
 *
 * The handle is what makes the round trip sound. `rule_id` cannot serve: a
 * statement holds many `AMOUNT_SPIKE` findings, so citing the rule would pull
 * every one of them into whichever narrative mentioned it and pool their
 * transactions.
 */
type Candidate = {
  id: string;
  insight: AnomalyInsight;
};

/** What a transaction can tell the model about a finding that names no merchant. */
export type TransactionContext = {
  merchant: string;
  category: string;
  /** `YYYY-MM`. */
  month: string;
};

export type AnalyzeOptions = {
  /**
   * Resolves a transaction id to the merchant, category and month it belongs to.
   *
   * Needed because the highest-cardinality rules — `AMOUNT_SPIKE`,
   * `REPEAT_CHARGE`, `UNUSUALLY_LARGE_TRANSACTION`,
   * `ROUND_NUMBER_TRANSACTION` — put none of those in `supporting_metrics`, and
   * their descriptions do not name the merchant either. Without this the model
   * receives several findings distinguishable only by a float and is asked to
   * write a sentence about a shop; it would invent the name, and an invented
   * merchant is not something the rule-id allowlist can catch.
   *
   * Optional so callers with no ledger in hand still work, at the cost of
   * coarser grouping.
   */
  contextOf?: (transactionId: number) => TransactionContext | undefined;

  /**
   * Called after each batch resolves, so a caller driving a progress bar can
   * report where it actually is. The batch count is not knowable before
   * clustering, which is why this reports rather than returns it.
   */
  onProgress?: (completedBatches: number, totalBatches: number) => void;
};

function getHighestSeverity(candidates: AnomalyInsight[]): AnomalySeverity {
  if (candidates.some((c) => c.severity === "high")) return "high";
  if (candidates.some((c) => c.severity === "medium")) return "medium";
  return "low";
}

function mergeMetrics(
  candidates: AnomalyInsight[],
): Record<string, number | string | boolean | (number | string)[]> {
  return Object.assign({}, ...candidates.map((c) => c.supporting_metrics));
}

/**
 * The kind a merged narrative inherits.
 *
 * Taken from the findings it was built out of, never from the model — a summary
 * of a red finding and two amber ones is still red, and a summary that could
 * talk itself down would be a way to hide the one thing worth seeing.
 */
function inheritedKind(sourceCandidates: AnomalyInsight[]): AnomalyKind {
  return sourceCandidates.reduce<AnomalyKind>(
    (strongest, c) => strongestKind(strongest, c.kind),
    "info",
  );
}

/**
 * The second key of the alert gate.
 *
 * `canEscalateToAlert` is a pure function of metrics the rules already
 * computed, and it takes the whole batch because some co-signatures are
 * mutual — a large transfer and a first-time recipient only mean something
 * about each other.
 */
function proposedKind(
  llmInsight: LlmInsight,
  sourceCandidates: AnomalyInsight[],
  siblings: AnomalyInsight[],
): AnomalyKind {
  const inherited = inheritedKind(sourceCandidates);
  if (llmInsight.kind !== "alert") return inherited;

  const cosigned = sourceCandidates.some((c) => canEscalateToAlert(c, siblings));
  return cosigned ? "alert" : inherited;
}

function buildFinalInsight(
  llmInsight: LlmInsight,
  byId: Map<string, AnomalyInsight>,
): AnomalyInsight | null {
  const sourceCandidates = llmInsight.source_ids
    .map((id) => byId.get(id))
    .filter((c): c is AnomalyInsight => c !== undefined);

  if (sourceCandidates.length === 0) return null;

  const primary = sourceCandidates[0];

  return {
    rule_id:
      sourceCandidates.length === 1 ? primary.rule_id : "COMBINED_INSIGHT",

    // The two fields the model owns.
    title: llmInsight.title,
    description: llmInsight.description,

    /*
     * Inherited from the engine unless the model asked for `alert` and one of
     * the findings behind it carries the evidence to support that. Only ever
     * upward: any other proposal is discarded rather than applied, so the model
     * cannot talk a finding down to `info`.
     */
    kind: proposedKind(llmInsight, sourceCandidates, [...byId.values()]),

    // Everything below stays owned by the algorithmic layer.
    severity: getHighestSeverity(sourceCandidates),
    transaction_ids: [
      ...new Set(sourceCandidates.flatMap((c) => c.transaction_ids)),
    ],

    // Never let the model choose the icon.
    icon: primary.icon,
    emoji: primary.emoji,

    supporting_metrics: {
      ...mergeMetrics(sourceCandidates),
      source_rule_ids: sourceCandidates.map((c) => c.rule_id),
    },
  };
}

/* =========================================================================
   WHAT IS WORTH ASKING
   ========================================================================= */

/**
 * Findings on one transaction before its ledger row stops being readable.
 *
 * Three badges is what the row renders before it starts hiding the rest behind
 * "+N more", so it is also the point where a person stops being able to read
 * the row and starts needing it summarised.
 */
const CROWDED_ROW = 3;

/**
 * The findings worth spending a request on.
 *
 * A year of real statements produces ~79 findings, and 79 of the 87 rows
 * carrying any wear one or two. Those rows do not need a model: the engine's
 * own sentence already names the merchant, the amount and the date, and a
 * paraphrase of it is not worth a round trip, 30 seconds, or sending the row
 * upstream.
 *
 * What no template can write is what eight findings on one transaction add up
 * to. That is the whole remit, and on the shipped statements it is a handful of
 * rows — one request instead of eight.
 */
function selectCrowdedFindings(candidates: AnomalyInsight[]): Set<AnomalyInsight> {
  const perTransaction = new Map<number, number>();
  for (const insight of candidates) {
    for (const id of insight.transaction_ids) {
      perTransaction.set(id, (perTransaction.get(id) ?? 0) + 1);
    }
  }

  return new Set(
    candidates.filter((insight) =>
      insight.transaction_ids.some(
        (id) => (perTransaction.get(id) ?? 0) >= CROWDED_ROW,
      ),
    ),
  );
}

/**
 * The findings the model is actually asked about.
 *
 * Crowding is a cost rule: it asks the model only where a person cannot read
 * the row unaided. `alert` is not a cost question. It can only be proposed by
 * the model, so anything the crowding rule skips can never be escalated — and
 * the motivating case, a large transfer to a first-time recipient, is exactly
 * two findings on one row and would never qualify as crowded.
 *
 * So a finding whose own evidence already co-signs an escalation is sent
 * regardless of how quiet its row is. `canEscalateToAlert` is the same
 * predicate that has to co-sign the result, which keeps this from widening the
 * request set beyond findings that could actually come back red.
 */
function selectForNarration(candidates: AnomalyInsight[]): Set<AnomalyInsight> {
  const selected = selectCrowdedFindings(candidates);
  for (const insight of candidates) {
    if (canEscalateToAlert(insight, candidates)) selected.add(insight);
  }
  return selected;
}

/* =========================================================================
   BATCHING
   ========================================================================= */

/**
 * The bucket a finding belongs to, as a person would group them: this
 * merchant, this month.
 *
 * Deliberately the same shape the engine's own consolidation uses, so the two
 * layers do not disagree about what counts as one event. Findings the context
 * lookup cannot place fall back to their rule, which at worst reproduces the
 * old behaviour for that one finding.
 */
function clusterKeyOf(
  insight: AnomalyInsight,
  contextOf?: AnalyzeOptions["contextOf"],
): string {
  const metrics = insight.supporting_metrics;
  const context = contextOf?.(insight.transaction_ids[0]);

  const merchant =
    typeof metrics.merchant === "string"
      ? normalizeMerchant(metrics.merchant)
      : context
        ? normalizeMerchant(context.merchant)
        : null;

  const category =
    typeof metrics.category === "string"
      ? metrics.category
      : (context?.category ?? null);

  const month =
    typeof metrics.month === "string" ? metrics.month : (context?.month ?? "");

  return `${month}|${merchant ?? category ?? insight.rule_id}`;
}

/**
 * What actually crosses the wire for one finding.
 *
 * `description` is kept — it is the sentence the model exists to rewrite, and
 * for the rules that carry no merchant in their metrics it is the only place
 * the amount appears. `transaction_ids`, `icon` and `emoji` are dropped: the
 * model has no use for them and they are restored afterwards regardless.
 *
 * The transaction's own `description` is deliberately never sent — on a real
 * statement that field is a payment reference.
 */
function project(
  candidate: Candidate,
  contextOf?: AnalyzeOptions["contextOf"],
): Record<string, unknown> {
  const { id, insight } = candidate;
  const context = contextOf?.(insight.transaction_ids[0]);

  const metrics: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(insight.supporting_metrics)) {
    if (Object.keys(metrics).length >= MAX_METRIC_KEYS) break;
    if (Array.isArray(value)) continue;
    metrics[key] = value;
  }

  return {
    id,
    rule_id: insight.rule_id,
    severity: insight.severity,
    title: insight.title,
    description: insight.description,
    ...(context ? { merchant: context.merchant, category: context.category, month: context.month } : {}),
    metrics,
  };
}

/**
 * Findings grouped into request-sized batches.
 *
 * Clusters are kept whole where they fit and ordered lexicographically, so a
 * re-scan of unchanged statements batches identically and the model sees the
 * same context it saw last time.
 */
function buildBatches(
  candidates: Candidate[],
  contextOf?: AnalyzeOptions["contextOf"],
): Candidate[][] {
  const clusters = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = clusterKeyOf(candidate.insight, contextOf);
    const bucket = clusters.get(key);
    if (bucket) bucket.push(candidate);
    else clusters.set(key, [candidate]);
  }

  const batches: Candidate[][] = [];
  let current: Candidate[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length > 0) batches.push(current);
    current = [];
    currentChars = 0;
  };

  for (const key of [...clusters.keys()].sort()) {
    for (const candidate of clusters.get(key)!) {
      const chars = JSON.stringify(project(candidate, contextOf)).length;
      if (
        current.length > 0 &&
        (current.length >= MAX_BATCH_CANDIDATES ||
          currentChars + chars > MAX_BATCH_CHARS)
      ) {
        flush();
      }
      current.push(candidate);
      currentChars += chars;
    }
  }
  flush();

  return batches;
}

/* =========================================================================
   PROMPTS
   ========================================================================= */

const SYSTEM_PROMPT = `You are the narrative layer of a personal finance application.

You receive several anomaly findings that ALL concern the same few transactions,
detected by deterministic algorithms.

They are being sent to you because there are too many of them to read one by one.

Your job is ONLY to say what they add up to, in plain language.

You are NOT an anomaly detector, and you do not classify anything.

IMPORTANT RULES:

1. Treat every provided anomaly as FACT.
2. Never create a new anomaly.
3. Never remove evidence from an anomaly.
4. Never change numerical values.
5. Never calculate new statistics.
6. Never estimate missing values.
7. Never invent merchants, categories, dates, amounts, transactions, or trends.
8. Never infer user intent.
9. Never suggest fraud, and never use the words "fraud", "scam", "stolen" or "theft".
10. Never provide financial, investment, tax, legal, or budgeting advice.
11. Never tell the user what they should do.
12. Never provide generic financial advice.
13. Never exaggerate the importance of an anomaly.
14. Do not change severity.
15. Do not invent IDs.
16. Do not invent metrics.

GROUPING:

You may combine multiple anomaly findings ONLY when they clearly describe the same underlying financial event or behavior.

For example, these may reasonably be combined:

- CATEGORY_SPENDING_SPIKE for Dining
- FREQUENCY_SPIKE for Dining
- AMOUNT_SPIKE for several Dining transactions

into:

"Dining spending increased"

However, unrelated findings must remain separate.

For example:

- NEW_MERCHANT for Apple
- CATEGORY_SPENDING_SPIKE for Travel

must NOT be combined.

When combining findings:
- Include every source id.
- Do not invent additional ids.
- Base the resulting insight only on the supplied evidence.
- Do not create new numerical metrics.

COVERAGE:

Every finding you are given must appear in exactly one insight's source_ids.
Do not drop a finding because it seems minor.

CLASSIFICATION:

Omit "kind" unless the evidence shows a charge the account holder may not have
made themselves — a payment billed more than once, or a large transfer to a
recipient seen for the first time. In that one case set "kind": "alert".

A large purchase is not an alert. Unusual spending is not an alert. Spending
more in a category than usual is not an alert. If you are weighing it up, omit
the field: it is checked against the evidence afterwards and dropped when the
numbers do not support it.

WRITING STYLE:

Titles:
- 3-8 words.
- Concrete.
- Factual.
- No clickbait.
- No emojis.
- Avoid generic titles such as "Financial Update" or "Something Changed".

Descriptions:
- 1-2 sentences.
- State what happened.
- Include the most relevant supplied number when available.
- Explain why it is notable using ONLY the supplied evidence.
- Do not give advice.

GOOD:

"Dining spending increased 59% this month to CHF 842.50, compared with your historical median of CHF 531.20."

BAD:

"You may want to cut back on dining."

BAD:

"You seem to be spending more because of social activities."

BAD:

"This could indicate financial stress."

Return ONLY valid JSON matching the requested schema.`;

function buildUserPrompt(payload: string): string {
  return `The following findings were produced by our anomaly detection algorithms.

They are authoritative evidence.

Do not reinterpret their numerical values.

ANOMALY FINDINGS:

${payload}

Create human-readable narratives for these findings.

Your task is to:

1. Identify findings that clearly describe the same underlying event.
2. Combine those related findings into a single insight.
3. Keep unrelated findings separate.
4. Write a concise factual title.
5. Write a concise factual description.

Do NOT:
- perform additional anomaly detection
- calculate new statistics
- modify numerical values
- invent evidence
- invent ids
- invent metrics
- give financial advice

Return ONLY this JSON structure:

{
  "insights": [
    {
      "source_ids": ["c0"],
      "title": "Short factual title",
      "description": "One or two factual sentences."
    }
  ]
}

"kind" is optional and almost always omitted. Include it only as described
above:

{
  "insights": [
    {
      "source_ids": ["c0", "c1"],
      "title": "Short factual title",
      "description": "One or two factual sentences.",
      "kind": "alert"
    }
  ]
}

Every source_id MUST be one of the ids listed above, and every id above must appear exactly once.`;
}

/* =========================================================================
   ONE REQUEST
   ========================================================================= */

/**
 * Narratives for one batch, or `null` if anything at all went wrong.
 *
 * Never throws: every failure mode here is a reason to keep the deterministic
 * findings, not a reason to fail the scan.
 */
type BatchResult = {
  narratives: AnomalyInsight[];
  /** Ids of the findings those narratives were built from. */
  consumed: Set<string>;
};

async function requestBatch(
  batch: Candidate[],
  key: string,
  model: string,
  contextOf: AnalyzeOptions["contextOf"],
  deadline: AbortSignal,
): Promise<BatchResult | null> {
  const payload = JSON.stringify(batch.map((c) => project(c, contextOf)));

  try {
    const response = await fetch(APERTUS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(payload) },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
        // Low temperature is intentional. We want deterministic factual
        // rewriting rather than creativity.
        temperature: 0.1,
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        deadline,
      ]),
    });

    if (!response.ok) {
      console.error(`LLM API failed with status ${response.status}.`);
      return null;
    }

    let content: string;
    try {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      content = data.choices?.[0]?.message?.content ?? "";
    } catch (error) {
      console.error("LLM API returned an unreadable envelope.", error);
      return null;
    }

    if (!content) {
      console.error("LLM response did not contain message content.");
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      // Most often a response truncated at `max_tokens` mid-object.
      console.error("LLM did not return valid JSON content.", error);
      return null;
    }

    const validated = llmResponseSchema.safeParse(parsed);
    if (!validated.success) {
      console.error("LLM JSON did not match the expected schema.", validated.error);
      return null;
    }

    /*
     * The model may only cite findings that were actually in this batch.
     * Anything else is a hallucinated handle, and a narrative built on one
     * would attach real transactions to invented evidence.
     */
    const byId = new Map(batch.map((c) => [c.id, c.insight]));
    const usable = validated.data.insights.filter((insight) =>
      insight.source_ids.every((id) => byId.has(id)),
    );

    if (usable.length === 0) {
      console.warn("LLM returned no insights referencing this batch's findings.");
      return null;
    }

    const consumed = new Set<string>();
    const narratives: AnomalyInsight[] = [];

    for (const insight of usable) {
      const built = buildFinalInsight(insight, byId);
      if (!built) continue;
      narratives.push(built);
      for (const id of insight.source_ids) consumed.add(id);
    }

    return { narratives, consumed };
  } catch (error) {
    console.error("LLM integration error.", error);
    return null;
  }
}

/* =========================================================================
   ENTRY POINT
   ========================================================================= */

export async function analyzeTransactionInsights(
  candidates: AnomalyInsight[],
  options: AnalyzeOptions = {},
): Promise<AnomalyInsight[]> {
  if (candidates.length === 0) return [];

  const key = process.env.APERTUS_KEY;
  if (!key) {
    console.warn(
      "APERTUS_KEY is not set. Skipping LLM interpretation and falling back to deterministic insights.",
    );
    return candidates;
  }

  const model = process.env.MODEL ?? "apertus-ai/Apertus-v1.5-8B";
  const { contextOf, onProgress } = options;

  const crowded = selectForNarration(candidates);
  if (crowded.size === 0) return candidates;

  const withIds: Candidate[] = candidates
    .filter((insight) => crowded.has(insight))
    .map((insight, index) => ({ id: `c${index}`, insight }));

  // Everything the model is not being asked about keeps the engine's wording.
  const results: AnomalyInsight[] = candidates.filter(
    (insight) => !crowded.has(insight),
  );

  const batches = buildBatches(withIds, contextOf);
  const deadline = AbortSignal.timeout(TOTAL_DEADLINE_MS);

  for (const [index, batch] of batches.entries()) {
    const result = deadline.aborted
      ? null
      : await requestBatch(batch, key, model, contextOf, deadline);

    if (result === null) {
      // This batch keeps its deterministic findings. The others are unaffected.
      results.push(...batch.map((c) => c.insight));
    } else {
      /*
       * Narratives plus whatever they left behind.
       *
       * The union half is not optional. A model that answers nine of ten
       * findings — routine, since a response that overruns `max_tokens` is cut
       * off — would otherwise silently delete the tenth from the user's scan.
       */
      results.push(...result.narratives);
      results.push(
        ...batch.filter((c) => !result.consumed.has(c.id)).map((c) => c.insight),
      );
    }

    onProgress?.(index + 1, batches.length);
  }

  return results;
}

/** Exported for tests. */
export const __testing = {
  buildBatches,
  clusterKeyOf,
  inheritedKind,
  project,
  selectCrowdedFindings,
  selectForNarration,
};
