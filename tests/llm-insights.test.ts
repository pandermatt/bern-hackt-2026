import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeTransactionInsights } from "@/lib/llm/analyze-insights";
import type { AnomalyInsight } from "@/lib/anomaly-engine";

function candidate(over: Partial<AnomalyInsight> & { rule_id: string }): AnomalyInsight {
  return {
    title: over.rule_id,
    description: `${over.rule_id} happened.`,
    severity: "medium",
    kind: "warning",
    transaction_ids: [1],
    supporting_metrics: {},
    icon: "lucide:arrow-up",
    emoji: "🔺",
    ...over,
  };
}

type LlmReply = {
  insights: Array<{
    source_ids: string[];
    title: string;
    description: string;
    kind?: string;
  }>;
};

/** Stands in for the Apertus endpoint, one queued reply per request. */
function mockLlm(...replies: LlmReply[]) {
  const fetchMock = vi.fn(async () => {
    const reply = replies.shift() ?? { insights: [] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(reply) } }],
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/*
 * The narrative layer only spends a request on a row a person cannot read
 * unaided — three findings on one transaction. Tests below are about the
 * mapping rather than that selection, so their findings share one busy
 * transaction to clear the bar, and assert on the ones they care about.
 */
const BUSY = 900;

const mockCandidates: AnomalyInsight[] = [
  candidate({
    rule_id: "AMOUNT_SPIKE",
    title: "Unusual Expense Amount Spike",
    description: "Transaction amount exceeds the merchant baseline median.",
    transaction_ids: [100],
    supporting_metrics: { amount: 500 },
  }),
];

describe("analyzeTransactionInsights", () => {
  const originalKey = process.env.APERTUS_KEY;

  beforeEach(() => {
    process.env.APERTUS_KEY = "test_key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.APERTUS_KEY;
    else process.env.APERTUS_KEY = originalKey;
  });

  it("returns empty array when given empty array", async () => {
    const result = await analyzeTransactionInsights([]);
    expect(result).toEqual([]);
  });

  it("gracefully falls back when API key is missing", async () => {
    delete process.env.APERTUS_KEY;
    const result = await analyzeTransactionInsights(mockCandidates);
    expect(result).toEqual(mockCandidates);
  });

  it("gracefully falls back when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const result = await analyzeTransactionInsights(mockCandidates);
    expect(result).toEqual(mockCandidates);
  });

  it("gracefully falls back when the response is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        // A response truncated at max_tokens looks exactly like this.
        json: async () => ({ choices: [{ message: { content: '{"insights":[' } }] }),
      })),
    );

    const result = await analyzeTransactionInsights(mockCandidates);
    expect(result).toEqual(mockCandidates);
  });

  /*
   * The mapping used to key on rule_id, which is not unique. One reference to
   * AMOUNT_SPIKE pulled in every amount spike in the ledger and pooled their
   * transactions into a single finding.
   */
  it("keeps two findings from the same rule apart", async () => {
    const candidates = [
      candidate({ rule_id: "AMOUNT_SPIKE", transaction_ids: [100, BUSY] }),
      candidate({ rule_id: "AMOUNT_SPIKE", transaction_ids: [200, BUSY] }),
      candidate({ rule_id: "NEW_MERCHANT", transaction_ids: [BUSY], severity: "low" }),
    ];

    mockLlm({
      insights: [
        { source_ids: ["c0"], title: "First spike", description: "One." },
        { source_ids: ["c1"], title: "Second spike", description: "Two." },
        { source_ids: ["c2"], title: "The busy row", description: "Three." },
      ],
    });

    const result = await analyzeTransactionInsights(candidates);

    expect(result).toHaveLength(3);
    expect(result.slice(0, 2).map((r) => r.transaction_ids)).toEqual([
      [100, BUSY],
      [200, BUSY],
    ]);
    expect(result.slice(0, 2).map((r) => r.title)).toEqual([
      "First spike",
      "Second spike",
    ]);
  });

  /*
   * The return used to be built only from what the model referenced, so any
   * finding it did not mention was deleted before it could be persisted.
   */
  it("keeps findings the model did not mention", async () => {
    const candidates = [
      candidate({ rule_id: "AMOUNT_SPIKE", transaction_ids: [100, BUSY] }),
      candidate({
        rule_id: "NEW_MERCHANT",
        transaction_ids: [200, BUSY],
        severity: "low",
      }),
      candidate({ rule_id: "FREQUENCY_SPIKE", transaction_ids: [BUSY] }),
    ];

    mockLlm({
      insights: [{ source_ids: ["c0"], title: "Only one", description: "One." }],
    });

    const result = await analyzeTransactionInsights(candidates);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.title).sort()).toEqual([
      "FREQUENCY_SPIKE",
      "NEW_MERCHANT",
      "Only one",
    ]);
  });

  it("ignores insights citing ids that were never sent", async () => {
    mockLlm({
      insights: [
        { source_ids: ["c99"], title: "Invented", description: "Hallucinated." },
      ],
    });

    const result = await analyzeTransactionInsights(mockCandidates);
    expect(result).toEqual(mockCandidates);
  });

  it("splits large candidate sets across several requests", async () => {
    const candidates = Array.from({ length: 25 }, (_, i) =>
      candidate({ rule_id: "AMOUNT_SPIKE", transaction_ids: [i, BUSY] }),
    );

    const fetchMock = mockLlm();
    await analyzeTransactionInsights(candidates);

    // 25 findings at a 10-per-request cap.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never lets the model lower a finding's kind", async () => {
    const candidates = [
      candidate({ rule_id: "AMOUNT_SPIKE", severity: "high", transaction_ids: [1] }),
    ];

    mockLlm({
      insights: [
        { source_ids: ["c0"], title: "Calm down", description: "Fine.", kind: "info" },
      ],
    });

    const [result] = await analyzeTransactionInsights(candidates);
    expect(result.kind).toBe("warning");
  });

  describe("the alert gate", () => {
    it("refuses alert on a rule that is not eligible", async () => {
      const candidates = [
        candidate({
          rule_id: "UNUSUALLY_LARGE_TRANSACTION",
          severity: "high",
          transaction_ids: [1],
        }),
      ];

      mockLlm({
        insights: [
          { source_ids: ["c0"], title: "Big spend", description: "Large.", kind: "alert" },
        ],
      });

      const [result] = await analyzeTransactionInsights(candidates);
      expect(result.kind).toBe("warning");
    });

    /* The shape of the seed statements' four legitimate airline charges. */
    it("refuses alert on a repeat charge at a habitually repeating merchant", async () => {
      const candidates = [
        candidate({
          rule_id: "REPEAT_CHARGE",
          severity: "high",
          transaction_ids: [1, 2, 3, 4],
          supporting_metrics: { charge_count: 4, merchant_repeat_days: 3 },
        }),
      ];

      mockLlm({
        insights: [
          { source_ids: ["c0"], title: "Charged four times", description: "Four.", kind: "alert" },
        ],
      });

      const [result] = await analyzeTransactionInsights(candidates);
      expect(result.kind).toBe("warning");
    });

    it("grants alert on a repeat charge that co-signs", async () => {
      const candidates = [
        candidate({
          rule_id: "REPEAT_CHARGE",
          severity: "high",
          transaction_ids: [1, 2, 3],
          supporting_metrics: { charge_count: 3, merchant_repeat_days: 1 },
        }),
      ];

      mockLlm({
        insights: [
          { source_ids: ["c0"], title: "Charged three times", description: "Three.", kind: "alert" },
        ],
      });

      const [result] = await analyzeTransactionInsights(candidates);
      expect(result.kind).toBe("alert");
    });

    it("grants alert when a large transfer meets a first-time recipient", async () => {
      const candidates = [
        candidate({ rule_id: "LARGE_TRANSFER", severity: "high", transaction_ids: [7] }),
        candidate({ rule_id: "NEW_COUNTERPARTY", severity: "low", transaction_ids: [7] }),
      ];

      mockLlm({
        insights: [
          {
            source_ids: ["c0", "c1"],
            title: "Large transfer to a new recipient",
            description: "Both.",
            kind: "alert",
          },
        ],
      });

      const [result] = await analyzeTransactionInsights(candidates);
      expect(result.kind).toBe("alert");
    });

    it("refuses alert for a large transfer to a familiar recipient", async () => {
      const candidates = [
        candidate({ rule_id: "LARGE_TRANSFER", severity: "high", transaction_ids: [7] }),
      ];

      mockLlm({
        insights: [
          { source_ids: ["c0"], title: "Large transfer", description: "Big.", kind: "alert" },
        ],
      });

      const [result] = await analyzeTransactionInsights(candidates);
      expect(result.kind).toBe("warning");
    });
  });
});
