import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { toRecords } from "@/scripts/lib/csv";
import { classify, naturalKey, toMinor } from "@/scripts/lib/statement";

/*
 * The regression guard on the shipped statements. These assertions are what
 * catch "someone edited the merchant table and quietly broke Travel" and
 * "someone dropped in a new export and the dedupe stopped working".
 */

const SEED_DIR = resolve("scripts/seed-data");

const rawRows = readdirSync(SEED_DIR)
  .filter((file) => file.endsWith(".csv"))
  .sort()
  .flatMap((file) => toRecords(readFileSync(join(SEED_DIR, file), "utf8")));

const seen = new Set<string>();
const deduped = rawRows.filter((row) => {
  const key = naturalKey(row);
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

describe("the shipped statements", () => {
  it("collapses the credit-card payments that appear in both exports", () => {
    // Each of the 12 payments is written once from the paying account's export
    // and once from the receiving account's. Without the dedupe they count
    // twice and every transfer total doubles.
    expect(rawRows).toHaveLength(525);
    expect(deduped).toHaveLength(513);
  });

  it("has no duplicates inside a single export", () => {
    for (const file of readdirSync(SEED_DIR).filter((f) => f.endsWith(".csv"))) {
      const rows = toRecords(readFileSync(join(SEED_DIR, file), "utf8"));
      const keys = new Set(rows.map(naturalKey));
      expect(keys.size).toBe(rows.length);
    }
  });

  it("splits into the expected kinds", () => {
    const counts = deduped.reduce<Record<string, number>>((acc, row) => {
      acc[row.type] = (acc[row.type] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({ expense: 453, income: 48, transfer: 12 });
  });

  it("totals what the dashboard reports", () => {
    const sum = (kind: string) =>
      deduped
        .filter((row) => row.type === kind)
        .reduce((total, row) => total + toMinor(row.base_amount), 0);

    expect(sum("expense")).toBe(9296940);
    expect(sum("income")).toBe(10162213);
    expect(sum("transfer")).toBe(4185064);
  });

  it("separates salary from merchant refunds", () => {
    const salary = deduped.filter(
      (row) => row.type === "income" && row.source_id === "EmployerAG",
    );

    expect(salary).toHaveLength(13);
    expect(salary.reduce((t, row) => t + toMinor(row.base_amount), 0)).toBe(
      9703200,
    );
    // The other 35 inflows are shop credits, not earnings.
    expect(deduped.filter((row) => row.type === "income")).toHaveLength(48);
  });
});

describe("the merchant table", () => {
  it("categorises every merchant in the shipped data", () => {
    const unmapped = new Set<string>();

    for (const row of deduped) {
      if (row.type === "transfer") continue;
      const income = row.type === "income";
      const slug = income ? row.source_id : row.target_id;
      const label = income ? row.source_label : row.target_label;
      if (classify(slug, label).category === "Other") {
        unmapped.add(`${slug} (${label})`);
      }
    }

    expect([...unmapped]).toEqual([]);
  });

  it("folds the alternate spellings onto one canonical name", () => {
    // These pairs are the same merchant written two ways in the exports.
    // Grouping on the raw label splits them across the top-merchant list.
    expect(classify("OrellFuessli", "Orell Fuessli").name).toBe(
      classify("Orell_Füssli", "Orell Füssli").name,
    );
    expect(classify("Swiss_Intl._Airlines", "Swiss Intl. Airlines").name).toBe(
      classify("SWISS_International_Airlines", "SWISS International Airlines").name,
    );
    expect(classify("Digitec_Galaxus", "Digitec Galaxus").name).toBe(
      classify("Galaxus_AG", "Galaxus AG").name,
    );
    expect(classify("Amazon", "Amazon").name).toBe(
      classify("Amazon.com", "Amazon.com").name,
    );
    expect(classify("SBB", "Schweizerische Bundesbahnen").name).toBe(
      classify("SBB_CFF_FSS_Ticket_Shop", "SBB CFF FSS Ticket Shop").name,
    );
  });

  it("falls back on a keyword before giving up on an unseen merchant", () => {
    expect(classify("Unseen_Slug", "Ristorante Bellavista").category).toBe(
      "Food & Drink",
    );
    expect(classify("Unseen_Slug", "Totally Novel GmbH").category).toBe("Other");
  });
});

describe("toMinor", () => {
  it("rounds the float noise in the EUR lines once, at the boundary", () => {
    expect(toMinor("46.96976052505031")).toBe(4697);
    expect(toMinor("1820.0")).toBe(182000);
    expect(toMinor("13.25")).toBe(1325);
  });
});
