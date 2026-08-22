import { describe, expect, it } from "vitest";
import {
  analyzeTransactionAnomalies,
  calculateMAD,
  calculateMedian,
  calculatePercentile,
  consolidateInsights,
  fitLinearSlope,
  normalizeMerchant,
  type TransactionInput,
} from "@/lib/anomaly-engine";

describe("Anomaly Detection Statistical Helpers", () => {
  it("calculates median accurately", () => {
    expect(calculateMedian([10, 20, 30])).toBe(20);
    expect(calculateMedian([10, 20, 30, 40])).toBe(25);
    expect(calculateMedian([])).toBe(0);
  });

  it("calculates Median Absolute Deviation (MAD)", () => {
    // Values: [10, 12, 13, 14, 15] -> Median = 13
    // Deviations: [3, 1, 0, 1, 2] -> sorted [0, 1, 1, 2, 3] -> Median deviation = 1
    expect(calculateMAD([10, 12, 13, 14, 15])).toBe(1);
  });

  it("calculates percentiles", () => {
    const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(calculatePercentile(data, 50)).toBe(55);
    expect(calculatePercentile(data, 90)).toBe(91);
  });

  it("normalizes merchant names correctly", () => {
    expect(normalizeMerchant("Orell Füssli AG")).toBe("orell fussli");
    expect(normalizeMerchant("Coop Supermarkt")).toBe("");
    expect(normalizeMerchant("Starbucks Coffee SA")).toBe("starbucks coffee");
  });

  it("fits linear slope for trend detection", () => {
    expect(fitLinearSlope([100, 200, 300, 400])).toBe(100);
  });
});

describe("Anomaly Detection Rules Evaluation", () => {
  it("triggers AMOUNT_SPIKE when an expense exceeds 3x MAD", () => {
    const txs: TransactionInput[] = [
      { id: 1, bookedOn: "2025-01-01", kind: "expense", amountMinor: -5000, currency: "CHF", account: "KK-Konto", merchant: "Migros", category: "Food & Drink", description: "Groceries" },
      { id: 2, bookedOn: "2025-01-03", kind: "expense", amountMinor: -5200, currency: "CHF", account: "KK-Konto", merchant: "Migros", category: "Food & Drink", description: "Groceries" },
      { id: 3, bookedOn: "2025-01-05", kind: "expense", amountMinor: -4800, currency: "CHF", account: "KK-Konto", merchant: "Migros", category: "Food & Drink", description: "Groceries" },
      { id: 4, bookedOn: "2025-01-08", kind: "expense", amountMinor: -5100, currency: "CHF", account: "KK-Konto", merchant: "Migros", category: "Food & Drink", description: "Groceries" },
      { id: 5, bookedOn: "2025-01-10", kind: "expense", amountMinor: -4900, currency: "CHF", account: "KK-Konto", merchant: "Migros", category: "Food & Drink", description: "Groceries" },
      { id: 6, bookedOn: "2025-01-15", kind: "expense", amountMinor: -50000, currency: "CHF", account: "KK-Konto", merchant: "Migros", category: "Food & Drink", description: "Bulk groceries" },
    ];

    const results = analyzeTransactionAnomalies(txs);
    const amountSpike = results.find((r) => r.rule_id === "AMOUNT_SPIKE");

    expect(amountSpike).toBeDefined();
    expect(amountSpike?.transaction_ids).toContain(6);
    expect(amountSpike?.icon).toBe("lucide:arrow-up");
  });

  it("triggers REPEAT_CHARGE when one merchant bills the same amount twice in a day", () => {
    // Statements carry no time of day, so the replaced duplicate rule — which
    // wanted two charges within five minutes — could never fire on real rows.
    const txs: TransactionInput[] = [
      { id: 101, bookedOn: "2025-02-01", kind: "expense", amountMinor: -176650, currency: "CHF", account: "KK-Konto", merchant: "SWISS", category: "Travel", description: "Flight" },
      { id: 102, bookedOn: "2025-02-01", kind: "expense", amountMinor: -176650, currency: "CHF", account: "KK-Konto", merchant: "SWISS", category: "Travel", description: "Flight" },
    ];

    const repeat = analyzeTransactionAnomalies(txs).find((r) => r.rule_id === "REPEAT_CHARGE");

    expect(repeat).toBeDefined();
    expect(repeat?.transaction_ids).toEqual([101, 102]);
    expect(repeat?.icon).toBe("lucide:copy");
    expect(repeat?.severity).toBe("medium");
    expect(repeat?.supporting_metrics.charge_count).toBe(2);
    expect(repeat?.supporting_metrics.total_minor).toBe(353300);
  });

  it("escalates REPEAT_CHARGE to high once the same amount lands three times", () => {
    const txs: TransactionInput[] = [1, 2, 3].map((n) => ({
      id: 100 + n, bookedOn: "2025-02-01", kind: "expense" as const, amountMinor: -176650,
      currency: "CHF", account: "KK-Konto", merchant: "SWISS", category: "Travel", description: "Flight",
    }));

    const repeat = analyzeTransactionAnomalies(txs).find((r) => r.rule_id === "REPEAT_CHARGE");

    expect(repeat?.severity).toBe("high");
    expect(repeat?.transaction_ids).toHaveLength(3);
  });

  it("leaves small same-day repeats alone", () => {
    // Two identical CHF 4.50 coffees are a Tuesday, not a finding.
    const txs: TransactionInput[] = [
      { id: 111, bookedOn: "2025-02-01", kind: "expense", amountMinor: -450, currency: "CHF", account: "KK-Konto", merchant: "Starbucks", category: "Food & Drink", description: "Coffee" },
      { id: 112, bookedOn: "2025-02-01", kind: "expense", amountMinor: -450, currency: "CHF", account: "KK-Konto", merchant: "Starbucks", category: "Food & Drink", description: "Coffee" },
    ];

    expect(analyzeTransactionAnomalies(txs).some((r) => r.rule_id === "REPEAT_CHARGE")).toBe(false);
  });

  it("triggers RECURRING_PAYMENT_CHANGE when a subscription changes price", () => {
    const txs: TransactionInput[] = [
      { id: 301, bookedOn: "2025-01-01", kind: "expense", amountMinor: -1500, currency: "CHF", account: "KK-Konto", merchant: "Netflix", category: "Entertainment", description: "Sub" },
      { id: 302, bookedOn: "2025-02-01", kind: "expense", amountMinor: -1500, currency: "CHF", account: "KK-Konto", merchant: "Netflix", category: "Entertainment", description: "Sub" },
      { id: 303, bookedOn: "2025-03-01", kind: "expense", amountMinor: -2300, currency: "CHF", account: "KK-Konto", merchant: "Netflix", category: "Entertainment", description: "Sub" },
    ];

    const results = analyzeTransactionAnomalies(txs);
    const change = results.find((r) => r.rule_id === "RECURRING_PAYMENT_CHANGE");

    expect(change).toBeDefined();
    expect(change?.transaction_ids).toContain(303);
    expect(change?.icon).toBe("lucide:refresh-cw");
  });

  it("triggers RECURRING_PAYMENT_DISAPPEARANCE when a recurring payment is overdue", () => {
    const txs: TransactionInput[] = [
      { id: 401, bookedOn: "2025-01-01", kind: "expense", amountMinor: -2000, currency: "CHF", account: "KK-Konto", merchant: "Spotify", category: "Entertainment", description: "Sub" },
      { id: 402, bookedOn: "2025-02-01", kind: "expense", amountMinor: -2000, currency: "CHF", account: "KK-Konto", merchant: "Spotify", category: "Entertainment", description: "Sub" },
      { id: 403, bookedOn: "2025-03-01", kind: "expense", amountMinor: -2000, currency: "CHF", account: "KK-Konto", merchant: "Spotify", category: "Entertainment", description: "Sub" },
    ];

    const results = analyzeTransactionAnomalies(txs, { referenceDate: "2025-05-15" });
    const missing = results.find((r) => r.rule_id === "RECURRING_PAYMENT_DISAPPEARANCE");

    expect(missing).toBeDefined();
    expect(missing?.icon).toBe("lucide:calendar-x");
  });

  it("evaluates anomaly distribution on full synthetic dataset without over-flagging normal transactions", () => {
    // Generate realistic transactions
    const syntheticTxs: TransactionInput[] = [];
    const merchants = ["Migros", "Coop", "SBB", "Kantine AG", "Swisscom", "Netflix", "Local Bakery"];
    for (let month = 1; month <= 12; month++) {
      const mStr = String(month).padStart(2, "0");
      // Salary
      syntheticTxs.push({
        id: month * 100 + 1,
        bookedOn: `2025-${mStr}-25`,
        kind: "income",
        amountMinor: 720000,
        currency: "CHF",
        account: "Privatkonto",
        merchant: "Employer AG",
        category: "Salary",
        description: "Monthly Salary",
      });
      // Rent
      syntheticTxs.push({
        id: month * 100 + 2,
        bookedOn: `2025-${mStr}-01`,
        kind: "expense",
        amountMinor: -215000,
        currency: "CHF",
        account: "Privatkonto",
        merchant: "Immobilien AG",
        category: "Housing",
        description: "Miete",
      });
      // Regular purchases
      for (let day = 2; day <= 28; day += 2) {
        const dStr = String(day).padStart(2, "0");
        const merchant = merchants[day % merchants.length];
        syntheticTxs.push({
          id: month * 100 + day + 10,
          bookedOn: `2025-${mStr}-${dStr}`,
          kind: "expense",
          amountMinor: -Math.floor(2000 + (day * 137) % 5000),
          currency: "CHF",
          account: "KK-Konto",
          merchant,
          category: merchant === "SBB" ? "Transport" : "Food & Drink",
          description: "Routine purchase",
        });
      }
    }

    const results = analyzeTransactionAnomalies(syntheticTxs);
    const flaggedIds = new Set(results.flatMap((r) => r.transaction_ids));

    // Normal recurring rent/salary and routine groceries should not all be flagged
    expect(flaggedIds.size).toBeLessThan(syntheticTxs.length * 0.15);

    // The rent is identical all twelve months; flagging it would mean the
    // recurring-payment suppression has stopped working.
    const rentIds = syntheticTxs.filter((t) => t.merchant === "Immobilien AG").map((t) => t.id);
    for (const id of rentIds) {
      expect(flaggedIds.has(id)).toBe(false);
    }
  });
});

describe("consolidateInsights", () => {
  const tx = (id: number, bookedOn: string, merchant: string): TransactionInput => ({
    id, bookedOn, kind: "expense", amountMinor: -100000, currency: "CHF",
    account: "KK-Konto", merchant, category: "Travel", description: "x",
  });

  const insight = (
    rule_id: string,
    transaction_ids: number[],
    severity: "low" | "medium" | "high" = "medium",
  ) => ({
    rule_id, title: rule_id, description: rule_id, severity,
    transaction_ids, supporting_metrics: {}, icon: "lucide:arrow-up",
  });

  const rows = [tx(1, "2025-09-18", "SWISS"), tx(2, "2025-09-18", "SWISS"), tx(3, "2025-09-19", "SWISS")];

  it("merges a rule's findings that land on the same merchant and day", () => {
    const out = consolidateInsights(
      [insight("AMOUNT_SPIKE", [1]), insight("AMOUNT_SPIKE", [2])],
      rows,
    );

    expect(out).toHaveLength(1);
    expect(out[0].transaction_ids).toEqual([1, 2]);
    expect(out[0].supporting_metrics.merged_transaction_count).toBe(2);
  });

  it("keeps separate days apart", () => {
    const out = consolidateInsights(
      [insight("AMOUNT_SPIKE", [1]), insight("AMOUNT_SPIKE", [3])],
      rows,
    );
    expect(out).toHaveLength(2);
  });

  it("takes the strongest severity into the merged finding", () => {
    const out = consolidateInsights(
      [insight("AMOUNT_SPIKE", [1], "low"), insight("AMOUNT_SPIKE", [2], "high")],
      rows,
    );
    expect(out[0].severity).toBe("high");
  });

  it("drops a weaker amount rule once a stronger one covers the same rows", () => {
    const out = consolidateInsights(
      [insight("AMOUNT_SPIKE", [1]), insight("REPEAT_CHARGE", [1])],
      rows,
    );
    expect(out.map((i) => i.rule_id)).toEqual(["REPEAT_CHARGE"]);
  });

  it("keeps an amount rule that reaches a row nothing stronger did", () => {
    const out = consolidateInsights(
      [insight("AMOUNT_SPIKE", [3]), insight("REPEAT_CHARGE", [1])],
      rows,
    ).map((i) => i.rule_id);

    expect(out).toContain("AMOUNT_SPIKE");
    expect(out).toContain("REPEAT_CHARGE");
  });

  it("never suppresses a finding about a different unit of analysis", () => {
    // A category overspend on the same day is not a restatement of the charge.
    const out = consolidateInsights(
      [insight("REPEAT_CHARGE", [1]), insight("CATEGORY_SPENDING_SPIKE", [1])],
      rows,
    );
    expect(out).toHaveLength(2);
  });

  it("leaves already-event-shaped findings unmerged", () => {
    // Two amounts billed repeatedly on one day are two findings; merging them
    // would leave a single description that can only name one of the amounts.
    const out = consolidateInsights(
      [insight("REPEAT_CHARGE", [1]), insight("REPEAT_CHARGE", [2])],
      rows,
    );
    expect(out).toHaveLength(2);
  });
});
