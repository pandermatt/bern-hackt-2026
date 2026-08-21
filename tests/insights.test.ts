import { describe, expect, it } from "vitest";

import type { Transaction } from "@/db/schema";
import {
  applyFilters,
  byCategory,
  facetsOf,
  formatDay,
  formatMoney,
  monthlySeries,
  slotsOf,
  stackByCategory,
  summarize,
  topMerchants,
  CATEGORY_SLOTS,
  type Filters,
} from "@/lib/insights";

let nextId = 1;

function row(overrides: Partial<Transaction> = {}): Transaction {
  const id = nextId++;
  return {
    id,
    userId: 1,
    externalId: `key-${id}`,
    bookedOn: "2025-03-14",
    kind: "expense",
    amountMinor: -1000,
    currency: "CHF",
    originalAmountMinor: 1000,
    account: "Privatkonto",
    merchant: "Kantine AG",
    category: "Food & Drink",
    description: "Mittagessen",
    createdAt: new Date(0),
    ...overrides,
  };
}

const NO_FILTERS: Filters = { includeTransfers: false };

describe("summarize", () => {
  it("splits salary from refunds instead of reporting one income figure", () => {
    const totals = summarize([
      row({ kind: "income", amountMinor: 746400, category: "Salary" }),
      row({ kind: "income", amountMinor: 7339, category: "Refund" }),
      row({ amountMinor: -5000 }),
    ]);

    expect(totals.salary).toBe(746400);
    expect(totals.refunds).toBe(7339);
    expect(totals.income).toBe(753739);
    expect(totals.expense).toBe(5000);
    expect(totals.net).toBe(748739);
  });

  it("counts outgoing rows separately from every row in view", () => {
    const totals = summarize([
      row({ kind: "income", amountMinor: 100, category: "Salary" }),
      row(),
      row(),
    ]);

    expect(totals.count).toBe(3);
    expect(totals.expenseCount).toBe(2);
  });

  it("leaves transfers out of every total", () => {
    // A card payment moves money between the owner's own accounts. Counting it
    // as spending would double every purchase already on that card.
    const totals = summarize([
      row(),
      row({ kind: "transfer", amountMinor: -135530, category: "Transfer" }),
    ]);

    expect(totals.expense).toBe(1000);
    expect(totals.net).toBe(-1000);
  });
});

describe("monthlySeries", () => {
  it("fills in months with no rows and stays ascending", () => {
    const series = monthlySeries([
      row({ bookedOn: "2025-01-05" }),
      row({ bookedOn: "2025-04-05" }),
    ]);

    expect(series.map((point) => point.month)).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
    ]);
    expect(series[1].income).toBe(0);
    expect(series[1].expense).toBe(0);
  });

  it("walks across a year boundary", () => {
    const series = monthlySeries([
      row({ bookedOn: "2024-11-30" }),
      row({ bookedOn: "2025-02-01" }),
    ]);

    expect(series.map((point) => point.month)).toEqual([
      "2024-11",
      "2024-12",
      "2025-01",
      "2025-02",
    ]);
    expect(series.map((point) => point.label)).toEqual([
      "Nov",
      "Dec",
      "Jan",
      "Feb",
    ]);
  });

  it("excludes transfers", () => {
    const series = monthlySeries([
      row({ kind: "transfer", amountMinor: -50000, bookedOn: "2025-01-05" }),
      row({ bookedOn: "2025-01-06" }),
    ]);

    expect(series).toHaveLength(1);
    expect(series[0].expense).toBe(1000);
  });

  it("returns nothing when there is nothing to plot", () => {
    expect(monthlySeries([])).toEqual([]);
  });
});

describe("stackByCategory", () => {
  /** One expense row per (category, month), so the arithmetic is obvious. */
  const spend = (category: string, bookedOn: string, minor: number) =>
    row({ category, bookedOn, amountMinor: -minor, kind: "expense" });

  it("aligns every band with the gap-filled month axis", () => {
    const stack = stackByCategory([
      spend("Housing", "2025-01-05", 100_000),
      spend("Housing", "2025-03-05", 100_000),
      spend("Transport", "2025-03-05", 5_000),
    ]);

    expect(stack.months).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(stack.labels).toEqual(["Jan", "Feb", "Mar"]);
    // A band covers the whole axis, zero-filled — a short array would silently
    // shift a category's spending into the wrong month.
    for (const band of stack.bands) {
      expect(band.values).toHaveLength(stack.months.length);
    }
    expect(stack.bands.map((band) => band.key)).toEqual(["Housing", "Transport"]);
    expect(stack.bands[0].values).toEqual([100_000, 0, 100_000]);
    expect(stack.bands[1].values).toEqual([0, 0, 5_000]);
    expect(stack.total).toBe(205_000);
  });

  it("assigns slots by rank, 1-based, matching the --chart-N tokens", () => {
    const stack = stackByCategory([
      spend("Transport", "2025-01-05", 1_000),
      spend("Housing", "2025-01-05", 9_000),
      spend("Travel", "2025-01-05", 5_000),
    ]);

    expect(stack.bands.map((band) => [band.key, band.slot])).toEqual([
      ["Housing", 1],
      ["Travel", 2],
      ["Transport", 3],
    ]);
  });

  it("folds everything past the eighth category into one neutral band", () => {
    // Nine named categories, descending, so exactly one falls off the ramp.
    const rows = Array.from({ length: 9 }, (_, index) =>
      spend(`Cat${index}`, "2025-01-05", (9 - index) * 1_000),
    );

    const stack = stackByCategory(rows);

    expect(stack.bands).toHaveLength(CATEGORY_SLOTS + 1);
    const last = stack.bands[stack.bands.length - 1];
    expect(last.key).toBe("Other");
    // Slot 0 is the neutral: the ninth category never gets a generated hue.
    expect(last.slot).toBe(0);
    expect(last.total).toBe(1_000);
    // Nothing is lost in the fold.
    expect(stack.total).toBe(45_000);
  });

  it("never lets the literal Other category win a colour of its own", () => {
    const stack = stackByCategory([
      spend("Other", "2025-01-05", 90_000),
      spend("Housing", "2025-01-05", 1_000),
    ]);

    // "Other" outspends Housing five to one and still takes the neutral: it is
    // the tail bucket by definition, and two bands both labelled "Other" would
    // be unreadable.
    expect(stack.bands.map((band) => [band.key, band.slot])).toEqual([
      ["Housing", 1],
      ["Other", 0],
    ]);
  });

  it("ignores income and transfers", () => {
    const stack = stackByCategory([
      row({ kind: "income", category: "Salary", amountMinor: 500_000 }),
      row({ kind: "transfer", category: "Transfer", amountMinor: -50_000 }),
      spend("Housing", "2025-03-14", 1_000),
    ]);

    expect(stack.bands.map((band) => band.key)).toEqual(["Housing"]);
    expect(stack.total).toBe(1_000);
  });

  it("returns nothing when there is nothing to plot", () => {
    expect(stackByCategory([])).toEqual({
      months: [],
      labels: [],
      bands: [],
      total: 0,
    });
  });
});

describe("slotsOf", () => {
  it("maps a category to its slot so a filter cannot repaint it", () => {
    const stack = stackByCategory([
      row({ category: "Housing", amountMinor: -9_000 }),
      row({ category: "Transport", amountMinor: -1_000 }),
    ]);

    const slots = slotsOf(stack);

    expect(slots.get("Housing")).toBe(1);
    expect(slots.get("Transport")).toBe(2);
    // Unknown keys are the caller's problem to default; the map does not guess.
    expect(slots.get("Pets")).toBeUndefined();
  });
});

describe("byCategory", () => {
  it("ranks expenses only, descending, with shares summing to 100", () => {
    const slices = byCategory([
      row({ category: "Housing", amountMinor: -182000 }),
      row({ category: "Food & Drink", amountMinor: -1325 }),
      // Income must not appear in a spending breakdown.
      row({ kind: "income", amountMinor: 746400, category: "Salary" }),
    ]);

    expect(slices.map((slice) => slice.key)).toEqual(["Housing", "Food & Drink"]);
    expect(slices[0].amount).toBe(182000);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(100, 6);
  });
});

describe("topMerchants", () => {
  it("merges rows that share a canonical merchant name", () => {
    // The importer folds "Swiss Intl. Airlines" and "SWISS International
    // Airlines" onto one name; without that these rank as two merchants.
    const slices = topMerchants([
      row({ merchant: "SWISS", amountMinor: -176650 }),
      row({ merchant: "SWISS", amountMinor: -10240 }),
      row({ merchant: "Rent", amountMinor: -182000 }),
    ]);

    expect(slices.map((slice) => [slice.key, slice.count])).toEqual([
      ["SWISS", 2],
      ["Rent", 1],
    ]);
    expect(slices[0].amount).toBe(186890);
  });

  it("honours the limit", () => {
    const rows = ["a", "b", "c", "d"].map((merchant) => row({ merchant }));
    expect(topMerchants(rows, 2)).toHaveLength(2);
  });
});

describe("applyFilters", () => {
  it("treats both ends of the date range as inclusive", () => {
    const rows = [
      row({ bookedOn: "2025-03-01" }),
      row({ bookedOn: "2025-03-15" }),
      row({ bookedOn: "2025-03-31" }),
    ];

    const kept = applyFilters(rows, {
      ...NO_FILTERS,
      from: "2025-03-01",
      to: "2025-03-31",
    });
    expect(kept).toHaveLength(3);

    expect(
      applyFilters(rows, { ...NO_FILTERS, from: "2025-03-02", to: "2025-03-30" }),
    ).toHaveLength(1);
  });

  it("searches description and merchant, case-insensitively", () => {
    const rows = [
      row({ merchant: "Netflix", description: "Abo" }),
      row({ merchant: "Kantine AG", description: "Mittagessen Kantine" }),
      row({ merchant: "Rent", description: "Rent" }),
    ];

    expect(applyFilters(rows, { ...NO_FILTERS, q: "netflix" })).toHaveLength(1);
    expect(applyFilters(rows, { ...NO_FILTERS, q: "KANTINE" })).toHaveLength(1);
    expect(applyFilters(rows, { ...NO_FILTERS, q: "nothing here" })).toHaveLength(0);
  });

  it("hides transfers unless they are asked for", () => {
    const rows = [row(), row({ kind: "transfer", category: "Transfer" })];

    expect(applyFilters(rows, NO_FILTERS)).toHaveLength(1);
    expect(
      applyFilters(rows, { ...NO_FILTERS, includeTransfers: true }),
    ).toHaveLength(2);
  });

  it("narrows by account, category, merchant and direction", () => {
    const rows = [
      row({ account: "KK-Konto", category: "Travel", merchant: "SWISS" }),
      row({ kind: "income", amountMinor: 100, category: "Salary" }),
    ];

    expect(applyFilters(rows, { ...NO_FILTERS, account: "KK-Konto" })).toHaveLength(1);
    expect(applyFilters(rows, { ...NO_FILTERS, category: "Travel" })).toHaveLength(1);
    expect(applyFilters(rows, { ...NO_FILTERS, merchant: "SWISS" })).toHaveLength(1);
    expect(applyFilters(rows, { ...NO_FILTERS, kind: "income" })).toHaveLength(1);
  });
});

describe("facetsOf", () => {
  it("reports sorted distinct values and the full date span", () => {
    const facets = facetsOf([
      row({ account: "Privatkonto", bookedOn: "2025-12-29", merchant: "Rent" }),
      row({ account: "KK-Konto", bookedOn: "2025-01-01", merchant: "SWISS" }),
    ]);

    expect(facets.accounts).toEqual(["KK-Konto", "Privatkonto"]);
    expect(facets.merchants).toEqual(["Rent", "SWISS"]);
    expect(facets.first).toBe("2025-01-01");
    expect(facets.last).toBe("2025-12-29");
  });
});

describe("formatting", () => {
  it("formats Swiss francs unsigned, with the Swiss group separator", () => {
    // Written with escapes because de-CH separates the code with a
    // non-breaking space (U+00A0) and groups with a right single quote
    // (U+2019) — both invisible in a diff if typed literally.
    // The sign is a UI decision: a caller renders a minus glyph and a colour.
    expect(formatMoney(-182000)).toBe("CHF\u00A01\u2019820.00");
    expect(formatMoney(182000)).toBe("CHF\u00A01\u2019820.00");
  });

  it("never renders negative zero", () => {
    // Math.round hands back -0 for any amount that rounds to nothing, and
    // without signDisplay:"never" that formats as "CHF-0.00".
    expect(formatMoney(-0)).toBe("CHF\u00A00.00");
  });

  it("formats a foreign currency in its own symbol", () => {
    expect(formatMoney(4697, "EUR")).toContain("46.97");
  });

  it("formats a day without going through Date", () => {
    // Parsed as a Date, "2025-01-01" is midnight UTC and renders as 31 December
    // for anyone west of London.
    expect(formatDay("2025-01-01")).toBe("1 Jan 2025");
    expect(formatDay("2025-09-05")).toBe("5 Sep 2025");
  });
});
