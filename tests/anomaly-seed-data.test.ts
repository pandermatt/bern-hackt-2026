import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  analyzeTransactionAnomalies,
  attentionFor,
  canEscalateToAlert,
  RULE_ATTENTION,
  RULE_EMOJIS,
  type TransactionInput,
} from "@/lib/anomaly-engine";
import { toRecords } from "@/scripts/lib/csv";
import { classify, naturalKey, toMinor } from "@/scripts/lib/statement";

/*
 * The engine measured against the statements it actually ships with, rather
 * than against fixtures written to match it.
 *
 * The unit tests next door each build a handful of rows to prove one rule can
 * fire. That says nothing about what a year of real spending looks like coming
 * out the other end, which is where the interesting failures were: routine
 * power bills flagged as spikes because they were being compared against a
 * phone bill, one afternoon of airline bookings exploding into fifteen separate
 * findings, and a quarter of everything computed then dropped on the way to the
 * database for want of a transaction to attach to.
 *
 * So this asserts on shape, in both directions — few enough findings to read,
 * enough of them to be worth reading — plus the specific cases that drove the
 * changes.
 */

const SEED_DIR = join(process.cwd(), "scripts/seed-data");

/** Mirrors `scripts/seed.ts`, so these rows are what the database would hold. */
function importSeedData(): TransactionInput[] {
  const seen = new Set<string>();
  const rows: TransactionInput[] = [];
  let id = 1;

  for (const file of readdirSync(SEED_DIR).filter((f) => f.endsWith(".csv")).sort()) {
    for (const row of toRecords(readFileSync(join(SEED_DIR, file), "utf8"))) {
      const key = naturalKey(row);
      // The credit-card payments appear in both exports, once per side.
      if (seen.has(key)) continue;
      seen.add(key);

      const income = row.type === "income";
      const rule = classify(
        income ? row.source_id : row.target_id,
        income ? row.source_label : row.target_label,
      );
      const magnitude = toMinor(row.base_amount || row.amount);

      rows.push({
        id: id++,
        bookedOn: row.transaction_date,
        kind: row.type as TransactionInput["kind"],
        amountMinor: income ? magnitude : -magnitude,
        currency: row.currency || "CHF",
        account: income ? row.target_label : row.source_label,
        merchant: row.type === "transfer" ? "Credit card payment" : rule.name,
        category:
          row.type === "transfer"
            ? "Transfer"
            : income && rule.category !== "Salary"
              ? "Refund"
              : rule.category,
        description: row.name,
      });
    }
  }
  return rows;
}

const rows = importSeedData();
const insights = analyzeTransactionAnomalies(rows);
const idsOf = (merchant: string, amountMinor?: number) =>
  rows
    .filter((r) => r.merchant === merchant && (amountMinor === undefined || r.amountMinor === amountMinor))
    .map((r) => r.id);
const rulesCovering = (id: number) =>
  insights.filter((i) => i.transaction_ids.includes(id)).map((i) => i.rule_id);

describe("anomaly engine over the shipped seed statements", () => {
  it("imports the expected ledger", () => {
    // 525 rows across both exports, 12 of them the same card payments listed twice.
    expect(rows).toHaveLength(513);
  });

  it("reports a readable number of findings", () => {
    // An upper bound alone would be satisfied by an engine that returns
    // nothing, which is exactly the hole the previous integration test left.
    expect(insights.length).toBeGreaterThanOrEqual(20);
    expect(insights.length).toBeLessThanOrEqual(90);

    const flagged = new Set(insights.flatMap((i) => i.transaction_ids));
    expect(flagged.size / rows.length).toBeLessThan(0.25);
  });

  it("never emits a finding with nothing to attach it to", () => {
    // Findings are stored one row per (finding, transaction) pair, so an empty
    // list is not a quiet finding — it is a deleted one.
    const orphans = insights.filter((i) => i.transaction_ids.length === 0);
    expect(orphans.map((i) => i.rule_id)).toEqual([]);
  });

  it("reserves 'high' for a minority of findings", () => {
    const high = insights.filter((i) => i.severity === "high").length;
    expect(high).toBeLessThan(insights.length / 2);
  });

  it("names the four identical airline charges as one repeat charge", () => {
    // The plainest anomaly in the year: CHF 1'766.50 taken four times over on
    // 18 September. Previously it surfaced only as four separate amount spikes.
    const repeats = insights.filter(
      (i) => i.rule_id === "REPEAT_CHARGE" && i.description.includes("1’766.50"),
    );

    expect(repeats).toHaveLength(1);
    expect(repeats[0].transaction_ids).toHaveLength(4);
    expect(repeats[0].severity).toBe("high");
    expect(repeats[0].supporting_metrics.charge_count).toBe(4);
    expect(repeats[0].description).toContain("18 Sep 2025");
  });

  it("keeps the two amounts billed that day apart", () => {
    // CHF 1'766.50 four times and CHF 98.00 four times are two facts. Merging
    // them by (day, merchant) would leave one description describing both.
    const sameDay = insights.filter(
      (i) => i.rule_id === "REPEAT_CHARGE" && i.description.includes("18 Sep 2025"),
    );
    expect(sameDay).toHaveLength(2);
  });

  it("stops flagging routine bills against an unrelated category baseline", () => {
    // Three power bills of 192.00 / 210.00 / 220.00 were each called a spike,
    // because "Utilities & Telecom" is dominated by a CHF 19.90 phone bill.
    for (const id of idsOf("BKW")) {
      expect(rulesCovering(id)).not.toContain("AMOUNT_SPIKE");
    }
    // Same shape: an annual travel pass measured against single tickets.
    for (const id of idsOf("Libero-Tarifverbund")) {
      expect(rulesCovering(id)).not.toContain("AMOUNT_SPIKE");
    }
  });

  it("still catches the year's largest one-off purchases", () => {
    // The safety net for the rule above: these merchants are too sparse for a
    // merchant baseline, so the whole-ledger percentile rules have to carry them.
    for (const [merchant, minor] of [
      ["Veloshop", -600000],
      ["Apple Online Store", -274900],
    ] as const) {
      for (const id of idsOf(merchant, minor)) {
        expect(rulesCovering(id).length).toBeGreaterThan(0);
      }
    }
  });

  it("leaves the fixed monthly bills alone", () => {
    // Rent, health insurance and the phone bill are identical every month.
    // Flagging any of them would be the engine failing at its one job.
    for (const merchant of ["Rent", "Krankenkasse", "Mobile Provider", "Netflix"]) {
      for (const id of idsOf(merchant)) {
        expect(rulesCovering(id)).not.toContain("AMOUNT_SPIKE");
        expect(rulesCovering(id)).not.toContain("REPEAT_CHARGE");
      }
    }
  });

  it("does not stack four ways of saying the same charge was large", () => {
    // AMOUNT_SPIKE, UNUSUALLY_LARGE_TRANSACTION, UNUSUAL_FINANCIAL_IMPACT and
    // REPEAT_CHARGE all describe one transaction's amount; at most one should
    // survive per row.
    const amountRules = new Set([
      "REPEAT_CHARGE",
      "UNUSUALLY_LARGE_TRANSACTION",
      "AMOUNT_SPIKE",
      "UNUSUAL_FINANCIAL_IMPACT",
    ]);
    for (const row of rows) {
      const overlapping = rulesCovering(row.id).filter((r) => amountRules.has(r));
      expect(overlapping.length).toBeLessThanOrEqual(1);
    }
  });

  it("explains every rule it can emit, in every language", () => {
    // The badge panel and the rule page look their explanation up by rule id.
    // A rule added without one renders bare, and a translation added to one
    // locale but not the other is invisible until someone switches language.
    const ruleIds = Object.keys(RULE_EMOJIS).sort();
    for (const locale of ["en", "de"] as const) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"),
      );
      expect(Object.keys(messages.AnomalyRules ?? {}).sort(), locale).toEqual(ruleIds);
      for (const id of ruleIds) {
        expect(messages.AnomalyRules[id].length, `${locale}/${id}`).toBeGreaterThan(20);
      }
    }
  });

  it("classifies every rule it can emit", () => {
    // The typed key on RULE_ATTENTION already makes an unclassified rule a
    // build error; this says the same thing with a readable failure, and this
    // file is where "does the whole thing still hang together" lives.
    expect(Object.keys(RULE_ATTENTION).sort()).toEqual(Object.keys(RULE_EMOJIS).sort());

    for (const insight of insights) {
      expect(["action", "context"]).toContain(attentionFor(insight.rule_id));
    }
  });

  it("gives every finding human-readable copy", () => {
    for (const insight of insights) {
      expect(insight.title.length).toBeGreaterThan(0);
      expect(insight.title).not.toBe(insight.rule_id);
      expect(insight.description.length).toBeGreaterThan(0);
      expect(insight.emoji.length).toBeGreaterThan(0);
    }
  });

  it("classifies every finding, and never as an alert", () => {
    /*
     * `alert` says "this may not have been you". Nothing deterministic is
     * entitled to say that — it is proposed by the narrative layer and has to be
     * co-signed. A rule that started emitting it on its own would paint real
     * purchases red, so this is the assertion that would catch it.
     */
    for (const insight of insights) {
      expect(["info", "warning"]).toContain(insight.kind);
    }
  });

  it("keeps kind in step with severity", () => {
    for (const insight of insights) {
      expect(insight.kind).toBe(insight.severity === "low" ? "info" : "warning");
    }
  });

  it("refuses to escalate the airline's four charges", () => {
    /*
     * The most fraud-shaped row in the year, and a perfectly legitimate holiday
     * booking. It is on the alert allowlist by rule, so what keeps it out of red
     * is arithmetic: the airline repeats on three of its four active days, and
     * the co-signature wants a merchant that repeats on at most one.
     *
     * If this starts passing, the demo account shows a red "possible fraud"
     * wash on a real purchase.
     */
    const repeats = insights.filter(
      (i) => i.rule_id === "REPEAT_CHARGE" && i.description.includes("1’766.50"),
    );

    expect(repeats).toHaveLength(1);
    expect(repeats[0].supporting_metrics.merchant_repeat_days).toBe(3);
    expect(canEscalateToAlert(repeats[0], insights)).toBe(false);
  });

  it("finds nothing in the year's statements that could be escalated", () => {
    // These are one person's real-shaped statements. Every finding in them has
    // an innocent explanation, and the gate should agree.
    const escalatable = insights
      .filter((i) => canEscalateToAlert(i, insights))
      .map((i) => i.rule_id);

    expect(escalatable).toEqual([]);
  });
});
