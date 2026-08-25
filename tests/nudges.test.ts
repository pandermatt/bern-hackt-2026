import { describe, expect, it } from "vitest";

import type { BudgetRow, SavingsPot } from "@/lib/insights";
import {
  dragonFor,
  isOverBudget,
  rankNudges,
  warnsOverBudget,
  UNFILED_MERCHANTS_FLOOR,
  type NudgeInput,
} from "@/lib/nudges";

function row(overrides: Partial<BudgetRow> = {}): BudgetRow {
  return {
    category: "Housing",
    slot: 1,
    limitMinor: 100000,
    suggestedMinor: 100000,
    usedMinor: 50000,
    warnOverspend: true,
    ...overrides,
  };
}

function pot(overrides: Partial<SavingsPot> = {}): SavingsPot {
  return {
    id: 1,
    name: "Holiday",
    targetMinor: 500000,
    savedMinor: 0,
    monthMinor: 0,
    monthWithdrawnMinor: 0,
    targetOn: null,
    icon: null,
    slot: 1,
    ...overrides,
  };
}

function input(overrides: Partial<NudgeInput> = {}): NudgeInput {
  return {
    budget: [],
    anomalies: [],
    savings: { month: "2025-03", monthEnded: true, freeMinor: 0 },
    unfiledMerchants: 0,
    staleScan: false,
    ...overrides,
  };
}

const finding = (ruleId: string) => ({
  ruleId,
  title: "Duplicate charge",
  description: "Two identical amounts on the same day.",
  icon: "lucide:copy",
  transactionCount: 2,
});

describe("isOverBudget", () => {
  it("is true only past a limit that was actually set", () => {
    expect(isOverBudget(row({ limitMinor: 100000, usedMinor: 100001 }))).toBe(true);
    expect(isOverBudget(row({ limitMinor: 100000, usedMinor: 100000 }))).toBe(false);
  });

  it("never fires on a category with no limit", () => {
    // `null` is "no limit", which is not a limit of zero. Without the guard
    // every unbudgeted category reports itself as over the moment it is used.
    expect(isOverBudget(row({ limitMinor: null, usedMinor: 999999 }))).toBe(false);
  });
});

describe("warnsOverBudget", () => {
  it("is an overspend the reader still wants to hear about", () => {
    expect(warnsOverBudget(row({ limitMinor: 100, usedMinor: 101 }))).toBe(true);
  });

  it("says nothing about a category whose warning was switched off", () => {
    // Still over — `/budget` prints the row in red and the radar still puts the
    // spoke outside its ring. What is off is the telling.
    const muted = row({ limitMinor: 100, usedMinor: 101, warnOverspend: false });
    expect(isOverBudget(muted)).toBe(true);
    expect(warnsOverBudget(muted)).toBe(false);
  });

  it("has nothing to warn about when the limit is kept", () => {
    expect(warnsOverBudget(row({ limitMinor: 100, usedMinor: 100 }))).toBe(false);
  });
});

describe("rankNudges", () => {
  it("says nothing when there is nothing to say", () => {
    expect(rankNudges(input())).toEqual([]);
  });

  it("offers a month's leftover money once the month has ended", () => {
    const [nudge] = rankNudges(
      input({ savings: { month: "2025-03", monthEnded: true, freeMinor: 143631 } }),
    );
    expect(nudge).toMatchObject({ kind: "free-money", tone: "tip", amountMinor: 143631 });
  });

  it("offers nothing while the month is still running", () => {
    // The `monthSurplus` contract: a running month's surplus only shrinks, so
    // offering it as money to put away invites allocating rent.
    expect(
      rankNudges(
        input({ savings: { month: "2025-03", monthEnded: false, freeMinor: 143631 } }),
      ),
    ).toEqual([]);
  });

  it("offers nothing when the month's surplus is already assigned", () => {
    expect(
      rankNudges(input({ savings: { month: "2025-03", monthEnded: true, freeMinor: 0 } })),
    ).toEqual([]);
  });

  it("stays quiet when the unassigned pool is under CHF 100", () => {
    // A ceremony over CHF 99.99 is not worth one of the three slots; the
    // Savings page still shows and allocates it.
    expect(
      rankNudges(
        input({
          savings: { month: "2025-03", monthEnded: true, freeMinor: 9_999 },
        }),
      ),
    ).toEqual([]);

    // The gate is on the pool, not the single month: CHF 100 sitting
    // unassigned earns the prompt even if the month that just ended only
    // contributed a few francs of it.
    const [nudge] = rankNudges(
      input({
        savings: { month: "2025-03", monthEnded: true, freeMinor: 10_000 },
      }),
    );
    expect(nudge).toMatchObject({ kind: "free-money", amountMinor: 10_000 });
  });

  it("reports the worst overspend, and says how many others there are", () => {
    const nudges = rankNudges(
      input({
        budget: [
          row({ category: "Food", limitMinor: 20000, usedMinor: 25000 }),
          row({ category: "Housing", limitMinor: 100000, usedMinor: 160000 }),
          row({ category: "Travel", limitMinor: 50000, usedMinor: 10000 }),
        ],
      }),
    );

    // One card, not one per category: three of the same sentence about three
    // different categories reads as one problem repeated, and it used to fill
    // the whole deck.
    expect(nudges.map((n) => n.id)).toEqual(["over-budget:Housing"]);
    expect(nudges[0]).toMatchObject({ overMinor: 60000, others: 1 });
  });

  it("leaves a silenced category out of the deck and out of the count", () => {
    const nudges = rankNudges(
      input({
        budget: [
          // The worst overspend, and the reader has already decided about it.
          row({
            category: "Housing",
            limitMinor: 100000,
            usedMinor: 160000,
            warnOverspend: false,
          }),
          row({ category: "Food", limitMinor: 20000, usedMinor: 25000 }),
        ],
      }),
    );

    // The card is about Food, and it does not claim Housing as an "other".
    expect(nudges).toMatchObject([{ category: "Food", others: 0 }]);
  });

  it("keeps at most one card of each kind", () => {
    const nudges = rankNudges(
      input({
        budget: [
          row({ category: "Food", limitMinor: 20000, usedMinor: 25000 }),
          row({ category: "Housing", limitMinor: 100000, usedMinor: 160000 }),
        ],
        anomalies: [finding("REPEAT_CHARGE"), finding("AMOUNT_SPIKE")],
        staleScan: true,
      }),
    );

    expect(nudges.map((n) => n.kind)).toEqual([
      "over-budget",
      "anomaly",
      "stale-scan",
    ]);
  });

  it("ranks warnings above the tip, and caps the list at three", () => {
    const nudges = rankNudges(
      input({
        budget: [row({ category: "Housing", limitMinor: 100000, usedMinor: 160000 })],
        anomalies: [finding("REPEAT_CHARGE")],
        staleScan: true,
        savings: { month: "2025-03", monthEnded: true, freeMinor: 143631 },
        unfiledMerchants: 14,
      }),
    );
    // Five kinds, three slots — and the tips are what lose, because an
    // opportunity keeps until tomorrow and an overspend does not.
    expect(nudges).toHaveLength(3);
    expect(nudges.map((n) => n.tone)).toEqual(["warning", "warning", "chore"]);
  });

  it("asks for a re-scan when the last one has gone stale", () => {
    const [nudge] = rankNudges(input({ staleScan: true }));
    expect(nudge).toMatchObject({ kind: "stale-scan", tone: "chore" });
  });

  it("puts the stale scan under the warnings and over the tips", () => {
    const nudges = rankNudges(
      input({
        budget: [row({ category: "Housing", limitMinor: 100000, usedMinor: 160000 })],
        staleScan: true,
        savings: { month: "2025-03", monthEnded: true, freeMinor: 143631 },
      }),
    );
    expect(nudges.map((n) => n.tone)).toEqual(["warning", "chore", "tip"]);
  });

  it("says nothing about a handful of unfiled merchants", () => {
    // Ten is quicker to file by hand than to read a card about, and the deck
    // has three slots.
    expect(rankNudges(input({ unfiledMerchants: UNFILED_MERCHANTS_FLOOR }))).toEqual(
      [],
    );
  });

  it("offers to file them once there are more than ten", () => {
    const [nudge] = rankNudges(input({ unfiledMerchants: 14 }));
    expect(nudge).toMatchObject({
      kind: "unfiled-merchants",
      tone: "tip",
      count: 14,
    });
  });

  it("puts the money before the filing", () => {
    const nudges = rankNudges(
      input({
        savings: { month: "2025-03", monthEnded: true, freeMinor: 143631 },
        unfiledMerchants: 14,
      }),
    );
    expect(nudges.map((n) => n.kind)).toEqual(["free-money", "unfiled-merchants"]);
  });

  it("keeps both tips behind anything that is actually wrong", () => {
    const nudges = rankNudges(
      input({
        budget: [row({ category: "Housing", limitMinor: 100000, usedMinor: 160000 })],
        savings: { month: "2025-03", monthEnded: true, freeMinor: 143631 },
        unfiledMerchants: 14,
      }),
    );
    expect(nudges[0].tone).toBe("warning");
  });

  it("carries the anomaly's already-translated words through untouched", () => {
    const [nudge] = rankNudges(input({ anomalies: [finding("REPEAT_CHARGE")] }));
    expect(nudge).toMatchObject({
      kind: "anomaly",
      title: "Duplicate charge",
      icon: "lucide:copy",
      count: 2,
    });
  });
});

describe("dragonFor", () => {
  it("thinks when anything needs attention", () => {
    const nudges = rankNudges(
      input({ budget: [row({ limitMinor: 100000, usedMinor: 160000 })] }),
    );
    expect(dragonFor(nudges)).toBe("thinking");
  });

  it("holds a coin when there is money to put away", () => {
    const nudges = rankNudges(
      input({ savings: { month: "2025-03", monthEnded: true, freeMinor: 143631 } }),
    );
    expect(dragonFor(nudges)).toBe("coin");
  });

  it("celebrates a finished goal when nothing else is pending", () => {
    expect(dragonFor([], [pot({ savedMinor: 500000 })])).toBe("celebrate");
    // Over-funded still counts as reached.
    expect(dragonFor([], [pot({ savedMinor: 600000 })])).toBe("celebrate");
  });

  it("does not celebrate over a warning", () => {
    const nudges = rankNudges(
      input({ budget: [row({ limitMinor: 100000, usedMinor: 160000 })] }),
    );
    expect(dragonFor(nudges, [pot({ savedMinor: 500000 })])).toBe("thinking");
  });

  it("goes looking when the scan is behind", () => {
    expect(dragonFor(rankNudges(input({ staleScan: true })))).toBe("zoom");
  });

  it("has an idea when there are merchants to file", () => {
    expect(dragonFor(rankNudges(input({ unfiledMerchants: 14 })))).toBe("idea");
  });

  it("is simply happy when there is nothing to report", () => {
    expect(dragonFor([], [pot({ savedMinor: 1000 })])).toBe("happy");
    // A zero-target pot is not a reached goal.
    expect(dragonFor([], [pot({ targetMinor: 0, savedMinor: 0 })])).toBe("happy");
  });
});
