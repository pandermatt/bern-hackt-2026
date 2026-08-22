import { describe, expect, it } from "vitest";

import type { Transaction } from "@/db/schema";
import {
  accountTotals,
  applyFilters,
  byCategory,
  facetsOf,
  formatDay,
  formatMoney,
  monthParts,
  monthlySeries,
  ledgerChunk,
  monthTotals,
  slotsOf,
  stackByCategory,
  paginate,
  summarize,
  categorySpendPeriods,
  topMerchants,
  CATEGORY_SLOTS,
  FOLDED_MERCHANTS,
  MERCHANT_SEGMENTS,
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

describe("accountTotals", () => {
  it("nets each account out separately", () => {
    expect(
      accountTotals([
        row({ account: "Privatkonto", kind: "income", amountMinor: 700000 }),
        row({ account: "Privatkonto", amountMinor: -98200 }),
        row({ account: "Sparkonto", amountMinor: -1530 }),
      ]),
    ).toEqual({ Privatkonto: 601800, Sparkonto: -1530 });
  });

  it("counts transfers, unlike summarize and monthTotals", () => {
    // A transfer is not income or spending, but it is money leaving this
    // account — drop it and both sides of every card payment disappear from
    // the balances they actually moved between.
    expect(
      accountTotals([
        row({ account: "Privatkonto", kind: "transfer", amountMinor: -50000 }),
        row({ account: "Kreditkarte", kind: "transfer", amountMinor: 50000 }),
      ]),
    ).toEqual({ Privatkonto: -50000, Kreditkarte: 50000 });
  });

  it("returns nothing for no rows", () => {
    expect(accountTotals([])).toEqual({});
  });
});

describe("monthTotals", () => {
  it("buckets money in and out by YYYY-MM", () => {
    expect(
      monthTotals([
        row({ kind: "income", amountMinor: 700000, bookedOn: "2025-12-23" }),
        row({ amountMinor: -98200, bookedOn: "2025-12-29" }),
        row({ amountMinor: -1530, bookedOn: "2025-11-04" }),
      ]),
    ).toEqual({
      "2025-12": { income: 700000, expense: 98200 },
      "2025-11": { income: 0, expense: 1530 },
    });
  });

  it("excludes transfers, the same as summarize and monthlySeries", () => {
    // The heading can therefore report less than the visible rows appear to
    // sum to when ?includeTransfers is on. That is deliberate.
    expect(
      monthTotals([
        row({ kind: "transfer", amountMinor: -50000, bookedOn: "2025-01-05" }),
        row({ amountMinor: -1000, bookedOn: "2025-01-06" }),
      ]),
    ).toEqual({ "2025-01": { income: 0, expense: 1000 } });
  });

  it("keeps a month that is only income", () => {
    expect(
      monthTotals([row({ kind: "income", amountMinor: 700000, bookedOn: "2025-06-25" })]),
    ).toEqual({ "2025-06": { income: 700000, expense: 0 } });
  });

  it("does not invent months with no rows", () => {
    // Unlike monthlySeries, which fills the gaps so the chart has no holes —
    // a heading only exists above rows.
    const totals = monthTotals([
      row({ bookedOn: "2025-01-05" }),
      row({ bookedOn: "2025-04-05" }),
    ]);

    expect(Object.keys(totals).sort()).toEqual(["2025-01", "2025-04"]);
  });

  it("returns nothing for no rows", () => {
    expect(monthTotals([])).toEqual({});
  });
});

describe("monthParts", () => {
  it("spells the month out in full and keeps the year apart", () => {
    expect(monthParts("2025-12")).toEqual({ name: "December", year: "2025" });
    expect(monthParts("2025-09")).toEqual({ name: "September", year: "2025" });
  });

  it("agrees with MONTH_LABELS on which month it is", () => {
    // The two arrays are separate literals; this is what keeps them in step.
    expect(monthParts("2024-01").name).toBe("January");
    expect(formatDay("2024-01-09")).toBe("9 Jan 2024");
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

  it("folds everything past the last slot into one neutral band", () => {
    // One more category than the ramp has slots, descending, so exactly one
    // falls off. Derived from CATEGORY_SLOTS rather than hardcoded — the ramp
    // has been resized once already and this test should survive the next one.
    const count = CATEGORY_SLOTS + 1;
    const rows = Array.from({ length: count }, (_, index) =>
      spend(`Cat${index}`, "2025-01-05", (count - index) * 1_000),
    );
    // 1 + 2 + … + count, in thousands.
    const grandTotal = ((count * (count + 1)) / 2) * 1_000;

    const stack = stackByCategory(rows);

    expect(stack.bands).toHaveLength(CATEGORY_SLOTS + 1);
    const last = stack.bands[stack.bands.length - 1];
    expect(last.key).toBe("Other");
    // Slot 0 is the neutral: the odd one out never gets a generated hue.
    expect(last.slot).toBe(0);
    expect(last.total).toBe(1_000);
    // Nothing is lost in the fold.
    expect(stack.total).toBe(grandTotal);
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

describe("applyFilters — the anomaly filter", () => {
  it("ignores the id set when no anomaly is asked for", () => {
    const rows = [row(), row()];
    const kept = applyFilters(rows, NO_FILTERS, new Set([rows[0].id]));
    expect(kept).toHaveLength(2);
  });

  it("narrows to the transactions the finding implicates", () => {
    const rows = [row(), row(), row()];
    const kept = applyFilters(
      rows,
      { ...NO_FILTERS, anomaly: "REPEAT_CHARGE" },
      new Set([rows[0].id, rows[2].id]),
    );
    expect(kept.map((r) => r.id)).toEqual([rows[0].id, rows[2].id]);
  });

  it("returns nothing when an anomaly is asked for and no set is supplied", () => {
    // The contract the two ledger callers depend on. Failing open here would
    // hand one of them an unfiltered list while the other filtered, and the
    // chunk offsets they share would stop meaning the same thing.
    const rows = [row(), row()];
    expect(applyFilters(rows, { ...NO_FILTERS, anomaly: "REPEAT_CHARGE" })).toEqual([]);
  });

  it("returns nothing for a rule that matched no transaction", () => {
    const rows = [row(), row()];
    expect(
      applyFilters(rows, { ...NO_FILTERS, anomaly: "NO_SUCH_RULE" }, new Set()),
    ).toEqual([]);
  });

  it("composes with the other filters rather than overriding them", () => {
    const rows = [
      row({ bookedOn: "2025-01-05", category: "Travel" }),
      row({ bookedOn: "2025-06-05", category: "Travel" }),
    ];
    const kept = applyFilters(
      rows,
      { ...NO_FILTERS, anomaly: "REPEAT_CHARGE", from: "2025-05-01" },
      new Set(rows.map((r) => r.id)),
    );
    expect(kept.map((r) => r.id)).toEqual([rows[1].id]);
  });

  it("still hides a flagged transfer unless transfers were asked for", () => {
    // Some rules attach only to transfers, so /anomalies has to carry
    // includeTransfers on its links or they land on an empty ledger.
    const transfer = row({ kind: "transfer" });
    const ids = new Set([transfer.id]);

    expect(
      applyFilters([transfer], { ...NO_FILTERS, anomaly: "LARGE_TRANSFER" }, ids),
    ).toEqual([]);
    expect(
      applyFilters(
        [transfer],
        { ...NO_FILTERS, anomaly: "LARGE_TRANSFER", includeTransfers: true },
        ids,
      ),
    ).toHaveLength(1);
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
    expect(
      applyFilters(rows, { ...NO_FILTERS, categories: ["Travel"] }),
    ).toHaveLength(1);
    expect(applyFilters(rows, { ...NO_FILTERS, merchant: "SWISS" })).toHaveLength(1);
    expect(applyFilters(rows, { ...NO_FILTERS, kind: "income" })).toHaveLength(1);
  });

  it("keeps a row that matches any selected category", () => {
    const rows = [
      row({ category: "Travel" }),
      row({ category: "Housing" }),
      row({ category: "Food & Drink" }),
    ];

    expect(
      applyFilters(rows, { ...NO_FILTERS, categories: ["Travel", "Housing"] }),
    ).toHaveLength(2);
  });

  it("treats an empty categories array like no filter at all", () => {
    // A checkbox group that starts empty and a filter that was never touched
    // must behave the same way — otherwise clearing every box hides
    // everything instead of showing everything.
    const rows = [row({ category: "Travel" }), row({ category: "Housing" })];

    expect(applyFilters(rows, { ...NO_FILTERS, categories: [] })).toHaveLength(2);
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

describe("paginate", () => {
  const rows = Array.from({ length: 45 }, (_, index) => row({ id: index + 1 }));

  it("slices a page and reports how many there are in total", () => {
    const first = paginate(rows, 1, 20);
    expect(first.rows).toHaveLength(20);
    expect(first.rows[0].id).toBe(1);
    expect(first.page).toBe(1);
    expect(first.pageCount).toBe(3);
    expect(first.totalCount).toBe(45);

    const last = paginate(rows, 3, 20);
    expect(last.rows).toHaveLength(5);
    expect(last.rows[0].id).toBe(41);
  });

  it("clamps a page past the end to the last real page", () => {
    // A filter change can shrink the result set out from under a page number
    // remembered in the URL; that should land on real rows, not an empty page.
    expect(paginate(rows, 999, 20).page).toBe(3);
  });

  it("clamps a page below 1 up to the first page", () => {
    expect(paginate(rows, 0, 20).page).toBe(1);
    expect(paginate(rows, -5, 20).page).toBe(1);
  });

  it("treats an empty set as one empty page rather than zero pages", () => {
    const empty = paginate([], 1, 20);
    expect(empty.page).toBe(1);
    expect(empty.pageCount).toBe(1);
    expect(empty.rows).toEqual([]);
  });
});

describe("ledgerChunk", () => {
  const across = (count: number, month: string) =>
    Array.from({ length: count }, (_, i) =>
      row({ bookedOn: `${month}-${String((i % 28) + 1).padStart(2, "0")}` }),
    );

  it("never hands back more than the limit, however big the month", () => {
    // The whole point. An earlier version extended to the month's end, which at
    // 25k transactions meant a 2000-row first chunk and a dashboard that never
    // finished loading.
    const chunk = ledgerChunk(across(2000, "2025-09"), 0, 50);
    expect(chunk.rows).toHaveLength(50);
    expect(chunk.nextOffset).toBe(50);
  });

  it("flags a cut that lands inside a month, at both ends", () => {
    const rows = across(120, "2025-09");
    const second = ledgerChunk(rows, 50, 50);

    expect(second.continuesFrom).toBe(true);
    expect(second.continuesInto).toBe(true);
  });

  it("does not flag a cut that lands on a month boundary", () => {
    const rows = [...across(50, "2025-09"), ...across(50, "2025-08")];
    const first = ledgerChunk(rows, 0, 50);
    const second = ledgerChunk(rows, 50, 50);

    expect(first.continuesInto).toBe(false);
    expect(second.continuesFrom).toBe(false);
  });

  it("never continues from the very start, or into the very end", () => {
    const rows = across(120, "2025-09");
    expect(ledgerChunk(rows, 0, 50).continuesFrom).toBe(false);
    expect(ledgerChunk(rows, 100, 50).continuesInto).toBe(false);
    expect(ledgerChunk(rows, 100, 50).nextOffset).toBeNull();
  });

  it("walks the whole list exactly once, with no row lost or repeated", () => {
    const rows = [...across(37, "2025-09"), ...across(64, "2025-08")];
    const seen: number[] = [];
    let offset: number | null = 0;

    while (offset !== null) {
      const chunk: ReturnType<typeof ledgerChunk> = ledgerChunk(rows, offset, 25);
      seen.push(...chunk.rows.map((r) => r.id));
      offset = chunk.nextOffset;
    }

    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it("returns nothing past the end, or for a negative offset", () => {
    const rows = across(10, "2025-09");
    expect(ledgerChunk(rows, 999, 50).rows).toEqual([]);
    expect(ledgerChunk(rows, 999, 50).nextOffset).toBeNull();
    expect(ledgerChunk(rows, -5, 50).rows).toEqual([]);
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

  it("groups the same way regardless of the runtime's CLDR version", () => {
    // CLDR 48 (Node 24, ICU 78) groups de-CH with an ASCII apostrophe where
    // CLDR 47 (Node 22, ICU 77) used U+2019, so an unpinned formatter renders
    // differently on a dev machine than it does in CI. `formatMoney` pins the
    // separator; this is the assertion that notices if that pin comes off.
    expect(formatMoney(100000)).toBe("CHF\u00A01\u2019000.00");
    expect(formatMoney(100000)).not.toContain("'");
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

describe("categorySpendPeriods", () => {
  it("reads the latest expense month and ranks its categories", () => {
    const result = categorySpendPeriods([
      row({ bookedOn: "2025-01-10", category: "Food & Drink", amountMinor: -5000 }),
      row({ bookedOn: "2025-02-05", category: "Housing", amountMinor: -180000 }),
      row({ bookedOn: "2025-02-12", category: "Food & Drink", amountMinor: -4000 }),
      row({ bookedOn: "2025-02-20", category: "Transport", amountMinor: -9000 }),
      // Income in a later month must not drag "this month" forward.
      row({ bookedOn: "2025-03-25", kind: "income", category: "Salary", amountMinor: 746400 }),
    ]);

    expect(result?.month.month).toBe("2025-02");
    expect(result?.month.monthCount).toBe(1);
    expect(result?.month.categories.map((c) => c.key)).toEqual([
      "Housing",
      "Transport",
      "Food & Drink",
    ]);
    expect(result?.month.categories[0].total).toBe(180000);
  });

  it("sums the year-to-date period from January, leaving last year out", () => {
    const result = categorySpendPeriods([
      // Last year's spending must not leak into this year's YTD.
      row({ bookedOn: "2024-11-20", amountMinor: -99000 }),
      row({ bookedOn: "2025-01-10", amountMinor: -5000 }),
      row({ bookedOn: "2025-02-12", amountMinor: -4000 }),
    ]);

    expect(result?.ytd.month).toBe("2025-02");
    expect(result?.ytd.monthCount).toBe(2);
    expect(result?.ytd.categories).toHaveLength(1);
    expect(result?.ytd.categories[0].total).toBe(9000);
    // The running-month period stays the single latest month.
    expect(result?.month.categories[0].total).toBe(4000);
  });

  it("returns null when there are no expenses at all", () => {
    expect(categorySpendPeriods([])).toBeNull();
    expect(
      categorySpendPeriods([
        row({ kind: "income", category: "Salary", amountMinor: 100 }),
      ]),
    ).toBeNull();
  });

  it("takes the median over the preceding months, counting empty ones as zero", () => {
    // History: Jan 10, Feb 0 (no Food & Drink row), Mar 30 → median 10.
    const result = categorySpendPeriods([
      row({ bookedOn: "2025-01-05", amountMinor: -1000 }),
      row({ bookedOn: "2025-02-14", category: "Transport", amountMinor: -500 }),
      row({ bookedOn: "2025-03-09", amountMinor: -3000 }),
      row({ bookedOn: "2025-04-01", amountMinor: -2000 }),
    ]);

    const food = result?.month.categories.find((c) => c.key === "Food & Drink");
    expect(food?.median).toBe(1000);
  });

  it("hands both periods the same per-month median", () => {
    // The YTD chart scales the median by monthCount itself; the aggregate must
    // not bake a different statistic into the other period.
    const result = categorySpendPeriods([
      row({ bookedOn: "2025-01-05", amountMinor: -1000 }),
      row({ bookedOn: "2025-02-09", amountMinor: -3000 }),
    ]);

    expect(result?.month.categories[0].median).toBe(1000);
    expect(result?.ytd.categories[0].median).toBe(1000);
  });

  it("has no median when this month is the only month", () => {
    const result = categorySpendPeriods([row({ amountMinor: -1000 })]);
    expect(result?.month.categories[0].median).toBeNull();
  });

  it("splits the period by merchant, biggest first, summing to the total", () => {
    const result = categorySpendPeriods([
      row({ merchant: "Coop", amountMinor: -2000 }),
      row({ merchant: "Migros", amountMinor: -5000 }),
      row({ merchant: "Migros", amountMinor: -1000 }),
    ]);

    const [category] = result!.month.categories;
    expect(category.merchants).toEqual([
      { merchant: "Migros", amount: 6000 },
      { merchant: "Coop", amount: 2000 },
    ]);
    expect(category.merchants.reduce((sum, m) => sum + m.amount, 0)).toBe(
      category.total,
    );
  });

  it("splits YTD by merchant over the whole period, not just the last month", () => {
    const result = categorySpendPeriods([
      row({ bookedOn: "2025-01-08", merchant: "Coop", amountMinor: -2000 }),
      row({ bookedOn: "2025-02-15", merchant: "Migros", amountMinor: -5000 }),
    ]);

    expect(result?.ytd.categories[0].merchants).toEqual([
      { merchant: "Migros", amount: 5000 },
      { merchant: "Coop", amount: 2000 },
    ]);
    expect(result?.month.categories[0].merchants).toEqual([
      { merchant: "Migros", amount: 5000 },
    ]);
  });

  it("folds the merchant tail once the split runs out of segments", () => {
    const rows = Array.from({ length: MERCHANT_SEGMENTS + 3 }, (_, index) =>
      row({ merchant: `Shop ${index}`, amountMinor: -(1000 + index) }),
    );

    const [category] = categorySpendPeriods(rows)!.month.categories;
    expect(category.merchants).toHaveLength(MERCHANT_SEGMENTS);
    expect(category.merchants.at(-1)?.merchant).toBe(FOLDED_MERCHANTS);
    expect(category.merchants.reduce((sum, m) => sum + m.amount, 0)).toBe(
      category.total,
    );
  });

  it("carries every category, ranked — the chart slices its own top five", () => {
    const rows = ["A", "B", "C", "D", "E", "F", "G"].map((category, index) =>
      row({ category, amountMinor: -(1000 + index) }),
    );

    const result = categorySpendPeriods(rows)!;
    expect(result.month.categories).toHaveLength(7);
    expect(result.month.categories.map((c) => c.key)).toEqual([
      "G", "F", "E", "D", "C", "B", "A",
    ]);
  });
});
