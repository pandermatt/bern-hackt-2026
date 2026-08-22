import { describe, expect, it, vi } from "vitest";
import { analyzeTransactionInsights } from "@/lib/llm/analyze-insights";
import type { AnomalyInsight } from "@/lib/anomaly-engine";

const mockCandidates: AnomalyInsight[] = [
  {
    rule_id: "AMOUNT_SPIKE",
    title: "Unusual Expense Amount Spike",
    description: "Transaction amount exceeds the merchant baseline median.",
    severity: "medium",
    transaction_ids: [100],
    icon: "lucide:arrow-up",
    emoji: "🔺",
    supporting_metrics: { amount: 500 }
  }
];

describe("analyzeTransactionInsights", () => {
  it("returns empty array when given empty array", async () => {
    const result = await analyzeTransactionInsights([]);
    expect(result).toEqual([]);
  });

  it("gracefully falls back when API key is missing", async () => {
    const originalKey = process.env.APERTUS_KEY;
    delete process.env.APERTUS_KEY;
    
    const result = await analyzeTransactionInsights(mockCandidates);
    expect(result).toEqual(mockCandidates);
    
    process.env.APERTUS_KEY = originalKey; // Restore
  });

  it("gracefully falls back when LLM fails or returns invalid data", async () => {
    process.env.APERTUS_KEY = "dummy_key";
    
    // Test with the actual fetch which will fail since dummy_key is invalid
    const result = await analyzeTransactionInsights(mockCandidates);
    expect(result).toEqual(mockCandidates);
  });
});
