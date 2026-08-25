import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  anomalyVerdict,
  isGroupResolved,
  budgetVerdict,
  dragonForAnomalies,
  dragonForBudget,
  dragonForLedger,
  dragonForSavings,
  ledgerVerdict,
  savingsVerdict,
  DRAGON_MOODS,
  DRAGON_SRC,
  type AnomalyVerdict,
  type BudgetVerdict,
  type LedgerVerdict,
  type SavingsVerdict,
} from "@/lib/nudges";
import type { BudgetRow, SavingsPot } from "@/lib/insights";

/* Read rather than imported, the idiom `tests/auth-copy.test.ts` established:
   what these assertions are about is the file on disk. */
const catalog = (locale: string, namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8"))[namespace];

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
    name: "Ferien",
    targetMinor: 100000,
    savedMinor: 40000,
    monthMinor: 0,
    monthWithdrawnMinor: 0,
    targetOn: null,
    icon: null,
    slot: 1,
    ...overrides,
  } as SavingsPot;
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
  const savings: SavingsVerdict[] = [
    "no-goals",
    "overdrawn",
    "free",
    "funded",
    "saving",
  ];
  const ledger: LedgerVerdict[] = [
    "empty",
    "no-matches",
    "negative",
    "positive",
    "even",
  ];

  /* The faces that must never turn up over bad news, and the ones that must
     never turn up over good. Named sets rather than one literal per verdict:
     the point of the assertion is the *reading*, and pinning "over" to exactly
     one drawing turns a change of art direction into a failing test with
     nothing wrong behind it. */
  const CHEERFUL = ["happy", "laughing", "celebrate", "jackpot", "victory", "rich"];
  const GLUM = ["sad", "broke", "angry", "knocked-out"];

  it("only ever picks a mood there is a drawing for", () => {
    for (const v of budget) expect(DRAGON_SRC[dragonForBudget(v)]).toBeTruthy();
    for (const v of anomaly) expect(DRAGON_SRC[dragonForAnomalies(v)]).toBeTruthy();
    for (const v of savings) expect(DRAGON_SRC[dragonForSavings(v)]).toBeTruthy();
    for (const v of ledger) expect(DRAGON_SRC[dragonForLedger(v)]).toBeTruthy();
  });

  it("gives every verdict on a page a face of its own", () => {
    // The whole point of widening the set past four: two verdicts wearing one
    // drawing throws away the distinction the verdict exists to draw.
    for (const verdicts of [
      budget.map(dragonForBudget),
      anomaly.map(dragonForAnomalies),
      savings.map(dragonForSavings),
      ledger.map(dragonForLedger),
    ]) {
      expect(new Set(verdicts).size).toBe(verdicts.length);
    }
  });

  it("does not wear one drawing on two pages in the same state", () => {
    // `/budget` with no limits, `/savings` with no goals and `/dashboard` with
    // nothing imported are three pages a reader crosses in a row, all saying
    // "there is nothing here yet". Meeting the identical mascot each time is
    // what the wider set exists to avoid.
    const blank = [
      dragonForBudget("unplanned"),
      dragonForSavings("no-goals"),
      dragonForLedger("empty"),
      dragonForAnomalies("unscanned"),
    ];
    expect(new Set(blank).size).toBe(blank.length);
  });

  it("has nothing to add when the scan is stale", () => {
    // The page renders no dragon at all for `outdated` — the banner beneath it
    // already says so, with a warning icon and the button that fixes it. The
    // verdict still exists, because it is what tells the page to stay quiet.
    expect(anomalyVerdict({ ...base, outdated: true })).toBe("outdated");
  });

  it("does not smile about a problem", () => {
    expect(CHEERFUL).not.toContain(dragonForBudget("over"));
    expect(CHEERFUL).not.toContain(dragonForBudget("tight"));
    expect(CHEERFUL).not.toContain(dragonForAnomalies("action"));
    expect(CHEERFUL).not.toContain(dragonForAnomalies("outdated"));
    expect(CHEERFUL).not.toContain(dragonForSavings("overdrawn"));
    expect(CHEERFUL).not.toContain(dragonForLedger("negative"));
  });

  it("does not pull a face about good news", () => {
    expect(GLUM).not.toContain(dragonForBudget("clear"));
    expect(GLUM).not.toContain(dragonForAnomalies("resolved"));
    expect(GLUM).not.toContain(dragonForSavings("funded"));
    expect(GLUM).not.toContain(dragonForLedger("positive"));
  });

  it("celebrates a clean budget and a cleared inbox", () => {
    expect(CHEERFUL).toContain(dragonForBudget("clear"));
    expect(CHEERFUL).toContain(dragonForAnomalies("resolved"));
  });

  it("offers something to do where there is something to set up", () => {
    // Not the coin any more — that reads as money, and there is none in
    // question on an unbudgeted month or an unscanned account. What both need
    // is the picture that reads as an offer.
    expect(dragonForBudget("unplanned")).toBe("idea");
    expect(dragonForAnomalies("unscanned")).toBe("zoom");
    expect(dragonForSavings("no-goals")).toBe("support");
  });
});

describe("savingsVerdict", () => {
  const base = { pots: [pot()], freeMinor: 0, pooledMinor: 500000 };

  it("says nothing can be put away before there is anything to put", () => {
    // An overdrawn pool outranks every other reading: no allocation is
    // possible out of it, so congratulating anyone on a well-funded pot above
    // it would be the same class of lie as `outdated` on `/anomalies`.
    expect(savingsVerdict({ ...base, pooledMinor: 0 })).toBe("overdrawn");
    expect(savingsVerdict({ ...base, pooledMinor: -1, pots: [] })).toBe("overdrawn");
  });

  it("asks for a goal when there are none", () => {
    expect(savingsVerdict({ ...base, pots: [] })).toBe("no-goals");
  });

  it("puts free money ahead of a shelf of finished goals", () => {
    // The one state with a next step. A page that said "all funded" over
    // CHF 400 sitting unassigned would be hiding the only thing to do here.
    expect(
      savingsVerdict({
        pots: [pot({ savedMinor: 100000 })],
        freeMinor: 40000,
        pooledMinor: 500000,
      }),
    ).toBe("free");
  });

  it("ignores small change", () => {
    // `FREE_MONEY_MIN_MINOR` — a ceremony over fifty rappen is noise, the same
    // floor the entry page's nudge uses.
    expect(savingsVerdict({ ...base, freeMinor: 9999 })).toBe("saving");
  });

  it("calls it funded only when every targeted pot has made it", () => {
    expect(savingsVerdict({ ...base, pots: [pot({ savedMinor: 100000 })] })).toBe(
      "funded",
    );
    expect(
      savingsVerdict({
        ...base,
        pots: [pot({ savedMinor: 100000 }), pot({ id: 2, savedMinor: 1 })],
      }),
    ).toBe("saving");
  });

  it("does not let an untargeted pot hold the page back", () => {
    // A jar nobody set a lid on can never be full, and must not stop the page
    // saying the rest are.
    expect(
      savingsVerdict({
        ...base,
        pots: [pot({ savedMinor: 100000 }), pot({ id: 2, targetMinor: 0 })],
      }),
    ).toBe("funded");
    // …but on its own it is not an achievement either.
    expect(savingsVerdict({ ...base, pots: [pot({ targetMinor: 0 })] })).toBe(
      "saving",
    );
  });
});

describe("ledgerVerdict", () => {
  const base = { count: 12, hasStatements: true, netMinor: 5000 };

  it("tells an empty account apart from an empty filter", () => {
    // Two different things to say and two different things to do about them —
    // the same distinction `Dashboard.noMatches` and `nothingImported` draw.
    expect(ledgerVerdict({ ...base, hasStatements: false, count: 0 })).toBe("empty");
    expect(ledgerVerdict({ ...base, count: 0 })).toBe("no-matches");
  });

  it("reads the direction of the money in view", () => {
    expect(ledgerVerdict({ ...base, netMinor: -1 })).toBe("negative");
    expect(ledgerVerdict({ ...base, netMinor: 1 })).toBe("positive");
    expect(ledgerVerdict({ ...base, netMinor: 0 })).toBe("even");
  });

  it("does not read a direction off rows it does not have", () => {
    // A filtered-to-nothing view nets zero, which is not "you broke even".
    expect(ledgerVerdict({ ...base, count: 0, netMinor: 0 })).toBe("no-matches");
  });
});

/*
 * The drift alarm for thirty-five poses. Three things have to agree — the
 * vocabulary in `lib/nudges.ts`, the files in `public/dragons`, and the alt
 * line in each catalog — and nothing else in the suite would notice any of
 * them going out of step. A missing file renders as a broken image; a missing
 * alt line renders as its own raw key, and only for readers in that language.
 */
describe("the mood vocabulary", () => {
  it("names a file that is actually there, for every mood", () => {
    for (const mood of DRAGON_MOODS) {
      const src = DRAGON_SRC[mood];
      expect(src, mood).toMatch(/^\/dragons\/\d{2}-[a-z-]+\.webp$/);
      expect(existsSync(resolve(`public${src}`)), src).toBe(true);
    }
  });

  it("has an alt line in both locales for every mood", () => {
    for (const locale of ["de", "en"]) {
      const dragon = catalog(locale, "Dragon");
      for (const mood of DRAGON_MOODS) {
        expect(dragon[mood], `${locale}.Dragon.${mood}`).toBeTruthy();
      }
      // And nothing left over: a key nothing renders is a string somebody is
      // still translating for a drawing that went away.
      expect(Object.keys(dragon).sort()).toEqual([...DRAGON_MOODS].sort());
    }
  });

  it("keeps the PNG twin the share card needs", () => {
    // `app/[locale]/opengraph-image.tsx` reads this one off disk, because
    // Satori cannot decode WebP. Deleting it breaks the card and nothing else,
    // which is exactly the kind of break nobody notices.
    expect(existsSync(resolve("public/dragons/22-coin.png"))).toBe(true);
  });
});
