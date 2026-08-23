import { describe, expect, it } from "vitest";

import {
  anomalyVerdict,
  isGroupResolved,
  budgetVerdict,
  dragonForAnomalies,
  dragonForBudget,
  DRAGON_SRC,
  type AnomalyVerdict,
  type BudgetVerdict,
} from "@/lib/nudges";
import type { BudgetRow } from "@/lib/insights";

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

describe("budgetVerdict", () => {
  it("says there is nothing to be inside of when no limit is set", () => {
    // Not the same as "nothing is wrong" — there is no budget yet, which is
    // the one case where the dragon has something to offer.
    expect(budgetVerdict([row({ limitMinor: null, usedMinor: 900000 })])).toBe(
      "unplanned",
    );
  });

  it("reports going over ahead of everything else", () => {
    const rows = [row({ usedMinor: 120000 }), row({ category: "Food", usedMinor: 1000 })];
    expect(budgetVerdict(rows)).toBe("over");
  });

  it("separates nearly-over from comfortably inside", () => {
    // 94% has broken nothing, but calling it "all clear" and then breaking it
    // three days later is how a mascot stops being believed.
    expect(budgetVerdict([row({ usedMinor: 94000 })])).toBe("tight");
    expect(budgetVerdict([row({ usedMinor: 50000 })])).toBe("clear");
  });

  it("counts exactly at the limit as inside, not over", () => {
    // `isOverBudget` is strictly greater-than; spending your whole budget is
    // spending your whole budget, not overspending it.
    expect(budgetVerdict([row({ usedMinor: 100000 })])).toBe("tight");
  });

  it("ignores unbudgeted categories when judging the budgeted ones", () => {
    const rows = [row({ usedMinor: 10000 }), row({ category: "Fun", limitMinor: null, usedMinor: 999999 })];
    expect(budgetVerdict(rows)).toBe("clear");
  });
});

describe("anomalyVerdict", () => {
  const base = {
    actionCount: 0,
    contextCount: 0,
    resolvedGroupCount: 0,
    hasCompletedScan: true,
    running: false,
    outdated: false,
  };

  it("never claims all-clear from a scan that no longer fits the statements", () => {
    // The single worst thing this page can say, and the thing a mascot makes
    // most convincing — so it outranks a clean result.
    expect(anomalyVerdict({ ...base, outdated: true })).toBe("outdated");
    expect(anomalyVerdict({ ...base, outdated: true, actionCount: 3 })).toBe("outdated");
  });

  it("does not claim anything before it has looked", () => {
    expect(anomalyVerdict({ ...base, hasCompletedScan: false })).toBe("unscanned");
  });

  it("puts a running scan ahead of a stale answer", () => {
    expect(anomalyVerdict({ ...base, running: true, outdated: true })).toBe("running");
  });

  it("celebrates only work someone actually did", () => {
    expect(anomalyVerdict({ ...base, resolvedGroupCount: 4 })).toBe("resolved");
    // Nothing found is not an achievement, it is just a quiet account.
    expect(anomalyVerdict(base)).toBe("clear");
    // Still context left to read means it is not finished — and not "clear"
    // either, which would claim the scan found nothing.
    expect(anomalyVerdict({ ...base, resolvedGroupCount: 4, contextCount: 1 })).toBe(
      "context",
    );
  });

  it("asks for attention when something needs it", () => {
    expect(anomalyVerdict({ ...base, actionCount: 2 })).toBe("action");
  });
});

describe("isGroupResolved", () => {
  it("is done only when every flagged transaction is ticked off", () => {
    expect(isGroupResolved({ transactionCount: 4, resolvedCount: 4 })).toBe(true);
    expect(isGroupResolved({ transactionCount: 4, resolvedCount: 3 })).toBe(false);
  });

  it("does not call an empty group an achievement", () => {
    // `0 === 0` would otherwise report nothing-at-all as finished work.
    expect(isGroupResolved({ transactionCount: 0, resolvedCount: 0 })).toBe(false);
  });
});

describe("resolved findings stop asking for attention", () => {
  const base = {
    actionCount: 0,
    contextCount: 0,
    resolvedGroupCount: 0,
    hasCompletedScan: true,
    running: false,
    outdated: false,
  };

  it("does not ask for a look at work already done", () => {
    // The reported bug: seven rules listed, every one ticked off, and the
    // dragon still saying "7 things worth a look". The page passes counts of
    // *outstanding* groups, so all-resolved arrives here as zero.
    expect(anomalyVerdict({ ...base, actionCount: 0, resolvedGroupCount: 7 })).toBe(
      "resolved",
    );
  });

  it("still asks about the ones that are not done", () => {
    expect(anomalyVerdict({ ...base, actionCount: 2, resolvedGroupCount: 5 })).toBe(
      "action",
    );
  });

  it("does not claim an empty scan while notes are still unread", () => {
    // "Nothing stood out" over a page with three notes on it is the same class
    // of lie as reporting a stale scan as clean.
    expect(anomalyVerdict({ ...base, contextCount: 3 })).toBe("context");
    expect(anomalyVerdict(base)).toBe("clear");
  });

  it("celebrates only once the context is read too", () => {
    expect(
      anomalyVerdict({ ...base, contextCount: 2, resolvedGroupCount: 5 }),
    ).toBe("context");
    expect(anomalyVerdict({ ...base, resolvedGroupCount: 5 })).toBe("resolved");
  });
});

describe("which dragon shows up", () => {
  const base = {
    actionCount: 0,
    contextCount: 0,
    resolvedGroupCount: 0,
    hasCompletedScan: true,
    running: false,
    outdated: false,
  };
  const budget: BudgetVerdict[] = ["unplanned", "over", "tight", "clear"];
  const anomaly: AnomalyVerdict[] = [
    "unscanned",
    "running",
    "outdated",
    "action",
    "resolved",
    "context",
    "clear",
  ];

  it("only ever picks a mood there is a drawing for", () => {
    for (const v of budget) expect(DRAGON_SRC[dragonForBudget(v)]).toBeTruthy();
    for (const v of anomaly) expect(DRAGON_SRC[dragonForAnomalies(v)]).toBeTruthy();
  });

  it("has nothing to add when the scan is stale", () => {
    // The page renders no dragon at all for `outdated` — the banner beneath it
    // already says so, with a warning icon and the button that fixes it. The
    // verdict still exists, because it is what tells the page to stay quiet.
    expect(anomalyVerdict({ ...base, outdated: true })).toBe("outdated");
  });

  it("does not smile about a problem", () => {
    expect(dragonForBudget("over")).toBe("thinking");
    expect(dragonForBudget("tight")).toBe("thinking");
    expect(dragonForAnomalies("action")).toBe("thinking");
    expect(dragonForAnomalies("outdated")).toBe("thinking");
  });

  it("celebrates a clean budget and a cleared inbox", () => {
    expect(dragonForBudget("clear")).toBe("celebrate");
    expect(dragonForAnomalies("resolved")).toBe("celebrate");
  });

  it("offers a coin where there is something to set up", () => {
    expect(dragonForBudget("unplanned")).toBe("coin");
    expect(dragonForAnomalies("unscanned")).toBe("coin");
  });
});
