import { describe, expect, it } from "vitest";

import type { BudgetRow, SavingsPot } from "@/lib/insights";
import { dragonFor, isOverBudget, rankNudges, type NudgeInput } from "@/lib/nudges";

function row(overrides: Partial<BudgetRow> = {}): BudgetRow {
  return {
    category: "Housing",
    slot: 1,
    limitMinor: 100000,
    suggestedMinor: 100000,
    usedMinor: 50000,
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
    targetOn: null,
    monthlyMinor: null,
    slot: 1,
    ...overrides,
  };
}

function input(overrides: Partial<NudgeInput> = {}): NudgeInput {
  return {
    budget: [],
    anomalies: [],
    savings: { month: "2025-03", monthEnded: true, freeMinor: 0 },
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

  it("puts the worst overspend first", () => {
    const nudges = rankNudges(
      input({
        budget: [
          row({ category: "Food", limitMinor: 20000, usedMinor: 25000 }),
          row({ category: "Housing", limitMinor: 100000, usedMinor: 160000 }),
          row({ category: "Travel", limitMinor: 50000, usedMinor: 10000 }),
        ],
      }),
    );
    expect(nudges.map((n) => n.id)).toEqual([
      "over-budget:Housing",
      "over-budget:Food",
    ]);
    expect(nudges[0]).toMatchObject({ overMinor: 60000 });
  });

  it("ranks warnings above the tip and caps the list", () => {
    const nudges = rankNudges(
      input({
        budget: [
          row({ category: "Food", limitMinor: 20000, usedMinor: 25000 }),
          row({ category: "Housing", limitMinor: 100000, usedMinor: 160000 }),
        ],
        anomalies: [finding("REPEAT_CHARGE")],
        savings: { month: "2025-03", monthEnded: true, freeMinor: 143631 },
      }),
    );
    // Four candidates, three slots — and the tip is the one that loses, because
    // an opportunity keeps until tomorrow and an overspend does not.
    expect(nudges).toHaveLength(3);
    expect(nudges.every((n) => n.tone === "warning")).toBe(true);
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

  it("is simply happy when there is nothing to report", () => {
    expect(dragonFor([], [pot({ savedMinor: 1000 })])).toBe("happy");
    // A zero-target pot is not a reached goal.
    expect(dragonFor([], [pot({ targetMinor: 0, savedMinor: 0 })])).toBe("happy");
  });
});
