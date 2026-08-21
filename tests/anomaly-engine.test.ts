import { describe, expect, it } from "vitest";
import {
  analyzeTransactionAnomalies,
  calculateMAD,
  calculateMedian,
  calculatePercentile,
  detectRecurringPatterns,
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

  it("triggers DUPLICATE_TRANSACTION when identical charges happen simultaneously", () => {
    const txs: TransactionInput[] = [
      { id: 101, bookedOn: "2025-02-01T10:00:00Z", timestamp: 1738404000000, kind: "expense", amountMinor: -4500, currency: "CHF", account: "KK-Konto", merchant: "Starbucks", category: "Food & Drink", description: "Coffee" },
      { id: 102, bookedOn: "2025-02-01T10:02:00Z", timestamp: 1738404120000, kind: "expense", amountMinor: -4500, currency: "CHF", account: "KK-Konto", merchant: "Starbucks", category: "Food & Drink", description: "Coffee" },
    ];

    const results = analyzeTransactionAnomalies(txs);
    const dup = results.find((r) => r.rule_id === "DUPLICATE_TRANSACTION");

    expect(dup).toBeDefined();
    expect(dup?.transaction_ids).toEqual([101, 102]);
    expect(dup?.icon).toBe("lucide:copy");
    expect(dup?.severity).toBe("medium");
  });

  it("triggers RAPID_LOCATION_CHANGE when geographic distance exceeds speed threshold", () => {
    const txs: TransactionInput[] = [
      {
        id: 201,
        bookedOn: "2025-03-01T12:00:00Z",
        kind: "expense",
        amountMinor: -2000,
        currency: "CHF",
        account: "KK-Konto",
        merchant: "Zürich Cafe",
        category: "Food & Drink",
        description: "Coffee",
        location: { city: "Zurich", country: "CH", lat: 47.3769, lon: 8.5417 },
      },
      {
        id: 202,
        bookedOn: "2025-03-01T13:00:00Z",
        kind: "expense",
        amountMinor: -3500,
        currency: "EUR",
        account: "KK-Konto",
        merchant: "London Shop",
        category: "Shopping",
        description: "Retail",
        location: { city: "London", country: "GB", lat: 51.5074, lon: -0.1278 },
      },
    ];

    const results = analyzeTransactionAnomalies(txs, { travelSpeedThresholdKmH: 500 });
    const rapidTravel = results.find((r) => r.rule_id === "RAPID_LOCATION_CHANGE");

    expect(rapidTravel).toBeDefined();
    expect(rapidTravel?.severity).toBe("high");
    expect(rapidTravel?.icon).toBe("lucide:plane");
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

  it("triggers VELOCITY_SPIKE when many transactions occur in a short window", () => {
    const txs: TransactionInput[] = [];
    const baseTime = 1738404000000;
    for (let i = 0; i < 6; i++) {
      txs.push({
        id: 500 + i,
        bookedOn: new Date(baseTime + i * 60000).toISOString(),
        timestamp: baseTime + i * 60000,
        kind: "expense",
        amountMinor: -1000,
        currency: "CHF",
        account: "KK-Konto",
        merchant: `Shop ${i}`,
        category: "Shopping",
        description: `Tx ${i}`,
      });
    }

    const results = analyzeTransactionAnomalies(txs);
    const vel = results.find((r) => r.rule_id === "VELOCITY_SPIKE");

    expect(vel).toBeDefined();
    expect(vel?.icon).toBe("lucide:gauge");
    expect(vel?.transaction_ids.length).toBeGreaterThanOrEqual(5);
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
  });
});
