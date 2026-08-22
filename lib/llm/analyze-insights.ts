import { z } from "zod";
import type { AnomalyInsight } from "@/lib/anomaly-engine";

const APERTUS_URL =
  process.env.APERTUS_URL ??
  "https://llm.stoney-cloud.com/v1/chat/completions";

const llmInsightSchema = z.object({
  insights: z.array(
    z.object({
      source_rule_ids: z.array(z.string()).min(1),
      title: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
});

type LlmInsight = z.infer<typeof llmInsightSchema>;

function getHighestSeverity(
  candidates: AnomalyInsight[],
): "low" | "medium" | "high" {
  if (candidates.some((c) => c.severity === "high")) return "high";
  if (candidates.some((c) => c.severity === "medium")) return "medium";
  return "low";
}

function getHighestConfidence(
  candidates: AnomalyInsight[],
): "low" | "medium" | "high" {
  const confidences = candidates.map(
    (c) =>
      c.supporting_metrics?.confidence as
        | "low"
        | "medium"
        | "high"
        | undefined,
  );

  if (confidences.includes("high")) return "high";
  if (confidences.includes("medium")) return "medium";
  return "low";
}

function mergeMetrics(
  candidates: AnomalyInsight[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const candidate of candidates) {
    if (candidate.supporting_metrics) {
      Object.assign(merged, candidate.supporting_metrics);
    }
  }

  return merged;
}

function buildFinalInsight(
  llmInsight: LlmInsight,
  candidates: AnomalyInsight[],
): AnomalyInsight | null {
  const sourceCandidates = candidates.filter((candidate) =>
    llmInsight.source_rule_ids.includes(candidate.rule_id),
  );

  if (sourceCandidates.length === 0) {
    return null;
  }

  const primary = sourceCandidates[0];

  const transactionIds = [
    ...new Set(
      sourceCandidates.flatMap((candidate) => candidate.transaction_ids),
    ),
  ];

  return {
    rule_id:
      sourceCandidates.length === 1
        ? primary.rule_id
        : "COMBINED_INSIGHT",

    title: llmInsight.title,
    description: llmInsight.description,

    // These values remain owned by the algorithmic layer.
    severity: getHighestSeverity(sourceCandidates),
    transaction_ids: transactionIds,

    // Never let the LLM choose the icon.
    icon: primary.icon,
    emoji: primary.emoji,

    supporting_metrics: {
      ...mergeMetrics(sourceCandidates),

      source_rule_ids: sourceCandidates.map(
        (candidate) => candidate.rule_id,
      ),

      confidence: getHighestConfidence(sourceCandidates),
    },
  };
}

export async function analyzeTransactionInsights(
  candidates: AnomalyInsight[],
): Promise<AnomalyInsight[]> {
  // No anomalies means there is nothing for the LLM to interpret.
  if (candidates.length === 0) {
    return [];
  }

  const key = process.env.APERTUS_KEY;

  // Graceful fallback if the LLM is not configured.
  if (!key) {
    console.warn(
      "APERTUS_KEY is not set. Skipping LLM interpretation and falling back to deterministic insights.",
    );

    return candidates;
  }

  const model =
    process.env.MODEL ?? "apertus-ai/Apertus-v1.5-8B";

  /*
   * IMPORTANT:
   *
   * The LLM is deliberately NOT an anomaly detector.
   *
   * The anomaly engine has already determined:
   * - what is unusual
   * - severity
   * - transaction IDs
   * - numerical metrics
   * - icons
   *
   * The LLM is only responsible for:
   * - grouping related findings
   * - writing a useful title
   * - writing a concise explanation
   */

  const systemPrompt = `You are the narrative layer of a personal finance application.

You receive anomaly findings that have ALREADY been detected by deterministic algorithms.

Your job is ONLY to turn those findings into clear, concise human-readable insights.

You are NOT an anomaly detector.

IMPORTANT RULES:

1. Treat every provided anomaly as FACT.
2. Never create a new anomaly.
3. Never remove evidence from an anomaly.
4. Never change numerical values.
5. Never calculate new statistics.
6. Never estimate missing values.
7. Never invent merchants, categories, dates, amounts, transactions, or trends.
8. Never infer user intent.
9. Never suggest fraud.
10. Never provide financial, investment, tax, legal, or budgeting advice.
11. Never tell the user what they should do.
12. Never provide generic financial advice.
13. Never exaggerate the importance of an anomaly.
14. Do not change severity.
15. Do not change confidence.
16. Do not invent rule IDs.
17. Do not invent transaction IDs.
18. Do not invent metrics.

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
- Include every source rule ID.
- Do not invent additional rule IDs.
- Base the resulting insight only on the supplied evidence.
- Do not create new numerical metrics.

WRITING STYLE:

Titles:
- 3–8 words.
- Concrete.
- Factual.
- No clickbait.
- No emojis.
- Avoid generic titles such as "Financial Update" or "Something Changed".

Descriptions:
- 1–2 sentences.
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

  const userPrompt = `The following findings were produced by our anomaly detection algorithms.

They are authoritative evidence.

Do not reinterpret their numerical values.

ANOMALY FINDINGS:

${JSON.stringify(candidates, null, 2)}

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
- invent rule IDs
- invent transaction IDs
- invent metrics
- give financial advice

Return ONLY this JSON structure:

{
  "insights": [
    {
      "source_rule_ids": ["EXISTING_RULE_ID"],
      "title": "Short factual title",
      "description": "One or two factual sentences."
    }
  ]
}

Every source_rule_id MUST correspond exactly to a rule_id present in the input.`;

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
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],

        response_format: {
          type: "json_object",
        },

        max_tokens: 1500,

        // Low temperature is intentional.
        // We want deterministic factual rewriting rather than creativity.
        temperature: 0.1,
      }),

      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.error(
        `LLM API failed with status ${response.status}. Falling back to deterministic insights.`,
      );

      return candidates;
    }

    const raw = await response.text();

    let data: {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    try {
      data = JSON.parse(raw);
    } catch (error) {
      console.error(
        "LLM API returned invalid JSON response. Falling back.",
        error,
      );

      return candidates;
    }

    const content = data.choices?.[0]?.message?.content ?? "";

    if (!content) {
      console.error(
        "LLM response did not contain message content. Falling back.",
      );

      return candidates;
    }

    let parsedContent: unknown;

    try {
      parsedContent = JSON.parse(content);
    } catch (error) {
      console.error(
        "LLM did not return valid JSON content. Falling back.",
        error,
      );

      return candidates;
    }

    const validated = llmInsightSchema.safeParse(parsedContent);

    if (!validated.success) {
      console.error(
        "LLM JSON did not match expected schema. Falling back.",
        validated.error,
      );

      return candidates;
    }

    /*
     * SECURITY / CORRECTNESS CHECK
     *
     * The LLM is only allowed to reference rules that actually exist
     * in the anomaly-engine output.
     */
    const candidateRuleIds = new Set(
      candidates.map((candidate) => candidate.rule_id),
    );

    const validLlmInsights = validated.data.insights.filter(
      (insight) =>
        insight.source_rule_ids.length > 0 &&
        insight.source_rule_ids.every((ruleId) =>
          candidateRuleIds.has(ruleId),
        ),
    );

    if (validLlmInsights.length === 0) {
      console.warn(
        "LLM returned no valid insights referencing existing anomaly rules. Falling back.",
      );

      return candidates;
    }

    /*
     * Convert the LLM's narrative back into the application's
     * AnomalyInsight format.
     *
     * IMPORTANT:
     *
     * The LLM does NOT control:
     * - severity
     * - transaction IDs
     * - metrics
     * - icons
     * - confidence
     *
     * Those are restored from the original algorithmic findings.
     */

    const finalInsights = validLlmInsights
      .map((llmInsight) =>
        buildFinalInsight(llmInsight, candidates),
      )
      .filter(
        (insight): insight is AnomalyInsight =>
          insight !== null,
      );

    if (finalInsights.length === 0) {
      console.warn(
        "Could not map LLM insights back to anomaly candidates. Falling back.",
      );

      return candidates;
    }

    return finalInsights;
  } catch (error) {
    /*
     * The LLM is an optional enhancement.
     *
     * A failure must NEVER prevent the deterministic anomaly
     * engine from producing useful results.
     */
    console.error(
      "LLM integration error. Falling back to deterministic insights.",
      error,
    );

    return candidates;
  }
}
