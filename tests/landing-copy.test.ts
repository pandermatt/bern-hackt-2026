import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";
import { CATEGORY_SLOTS, OTHER_CATEGORY } from "@/lib/insights";
import {
  DEMO_BUDGET,
  DEMO_CATEGORIES,
  DEMO_FINDINGS,
  DEMO_MONTHS,
  demoTotals,
} from "@/lib/landing-demo";

/*
 * The guard on the landing page, which has two failure modes nothing else in
 * the suite would notice.
 *
 * The first is `tests/nav-tabs.test.ts`'s: the preview builds message keys by
 * construction (`previewTab${View}`), so a key added in one locale and
 * forgotten in the other renders as its own raw name — and only for readers in
 * that language.
 *
 * The second is a preview that contradicts itself. The three headline figures
 * and the flow chart are drawn from one module precisely so they cannot
 * disagree; these assertions are what keeps that true after someone edits a
 * number.
 */

const namespaces = Object.fromEntries(
  routing.locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8")).Landing as
      | Record<string, string>
      | undefined,
  ]),
);

/** The views in `components/landing-preview.tsx`, and their key suffixes. */
const VIEW_KEYS = ["Flow", "Categories", "Budget", "Anomalies"];

/** What the mock preview used to say. Kept as a list so the dead copy cannot
 *  drift back in beside the real charts. */
const RETIRED = [
  "mockCategory1",
  "mockTransaction1",
  "mockAccount1",
  "mockToday",
  "mockYesterday",
  "previewInflowNote",
  "previewSpendingNote",
  "previewSavingsNote",
  "previewActivity",
  "previewVerified",
];

describe("the landing copy", () => {
  it("has a Landing namespace in every locale", () => {
    for (const locale of routing.locales) {
      expect(namespaces[locale], `messages/${locale}.json has no Landing namespace`)
        .toBeDefined();
    }
  });

  it("carries identical keys in every locale", () => {
    const [first, ...rest] = routing.locales;
    const reference = Object.keys(namespaces[first]!).sort();
    for (const locale of rest) {
      expect(Object.keys(namespaces[locale]!).sort(), `${locale} against ${first}`)
        .toEqual(reference);
    }
  });

  it("names every preview view in every locale", () => {
    for (const locale of routing.locales) {
      for (const view of VIEW_KEYS) {
        for (const key of [
          `previewTab${view}`,
          `preview${view}Label`,
          `preview${view}Hint`,
        ]) {
          expect(namespaces[locale]![key], `Landing.${key} missing from ${locale}`)
            .toBeTruthy();
        }
      }
    }
  });

  it("resolves the caption of every flagged demo finding", () => {
    const captions = DEMO_FINDINGS.flatMap((finding) =>
      finding.captionKey ? [finding.captionKey] : [],
    );
    expect(captions.length).toBeGreaterThan(0);

    for (const locale of routing.locales) {
      for (const key of captions) {
        expect(namespaces[locale]![key], `Landing.${key} missing from ${locale}`)
          .toBeTruthy();
      }
    }
  });

  it("has dropped the retired mock keys", () => {
    for (const locale of routing.locales) {
      for (const key of RETIRED) {
        expect(namespaces[locale]![key], `Landing.${key} still in ${locale}`)
          .toBeUndefined();
      }
    }
  });
});

describe("the landing preview's demo data", () => {
  it("runs the balance as the sum of the nets", () => {
    // Whatever the opening balance is, each step has to be the previous one
    // plus that month's net — the line and the bars are one story.
    for (let index = 1; index < DEMO_MONTHS.length; index += 1) {
      expect(DEMO_MONTHS[index].balance).toBe(
        DEMO_MONTHS[index - 1].balance + DEMO_MONTHS[index].net,
      );
    }
  });

  it("keeps income, expense and net in agreement", () => {
    for (const point of DEMO_MONTHS) {
      expect(point.income - point.expense).toBe(point.net);
    }
    const year = demoTotals();
    expect(year.income - year.expense).toBe(year.net);
  });

  it("gives the flow chart something on both sides of zero", () => {
    expect(DEMO_MONTHS.some((point) => point.net < 0)).toBe(true);
    expect(DEMO_MONTHS.some((point) => point.net > 0)).toBe(true);
  });

  it("assigns each category its own slot, with Other in the neutral one", () => {
    const slots = DEMO_CATEGORIES.map((entry) => entry.slot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThanOrEqual(CATEGORY_SLOTS);
    }
    const other = DEMO_CATEGORIES.find((entry) => entry.key === OTHER_CATEGORY);
    expect(other?.slot).toBe(0);
  });

  it("puts exactly one budget row over its limit", () => {
    const over = DEMO_BUDGET.filter((row) => row.usedMinor > row.limitMinor);
    expect(over).toHaveLength(1);
  });

  it("spreads the findings across the whole year", () => {
    const months = new Set(DEMO_FINDINGS.map((finding) => finding.month));
    expect(months.size).toBe(12);
    for (const month of months) {
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
    }
    // Both flagged colours have to be on the chart, or the legend lies.
    expect(DEMO_FINDINGS.some((finding) => finding.kind === "info")).toBe(true);
    expect(DEMO_FINDINGS.some((finding) => finding.kind === "alert")).toBe(true);
  });
});
