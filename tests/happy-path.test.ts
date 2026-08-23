import { describe, expect, it } from "vitest";

import type { AnomalyGroup, AnomalyOverview } from "@/app/actions/anomalies";
import type { SavingsOverview } from "@/app/actions/savings";
import type { Dashboard } from "@/app/actions/transactions";
import type { Transaction } from "@/db/schema";
import { SUGGESTION_KEYS } from "@/lib/assistant";
import {
  anomaliesSummary,
  categorySummary,
  keepsFigures,
  matchHappyPath,
  recentCount,
  recentSpendingSummary,
  renderSummary,
  savingsPotentialSummary,
  subscriptionsSummary,
  type HappyContext,
} from "@/lib/happy-path";
import en from "@/messages/en.json";
import de from "@/messages/de.json";

/**
 * A stand-in for `getTranslations("Chat.happy")`: it interpolates the real
 * shipped English strings, so a builder that names a key nobody wrote — or
 * passes a placeholder the string does not have — fails here rather than
 * rendering "{amount}" at a customer.
 */
function context(overrides: Partial<HappyContext> = {}): HappyContext {
  const messages = en.Chat.happy as Record<string, unknown>;
  return {
    phrase: (key, values) => {
      const template = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);
      if (typeof template !== "string") throw new Error(`no Chat.happy.${key}`);
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
        if (!values || !(name in values)) throw new Error(`${key}: no {${name}}`);
        return String(values[name]);
      });
    },
    label: (key) => key,
    monthName: (month) => month,
    year: "2025",
    ...overrides,
  };
}

/**
 * Every string in `Chat.happy` is interpolated by a builder above, so a
 * translation that quietly drops `{amount}` renders a sentence with a hole in
 * it — and next-intl throws on a placeholder it was handed no value for, which
 * would take out the turn rather than the wording. The English file is checked
 * by every test below (the stub interpolates it for real); this is the German
 * one.
 */
describe("Chat.happy translations", () => {
  const placeholders = (template: string) =>
    new Set([...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]));

  const leaves = (node: unknown, prefix = ""): [string, string][] =>
    typeof node === "string"
      ? [[prefix, node]]
      : Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
          leaves(child, prefix ? `${prefix}.${key}` : key),
        );

  it("carries the same keys and the same placeholders in both languages", () => {
    const english = new Map(leaves(en.Chat.happy));
    const german = new Map(leaves(de.Chat.happy));
    expect([...german.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, template] of english) {
      expect(placeholders(german.get(key)!), key).toEqual(placeholders(template));
    }
  });
});

describe("matchHappyPath", () => {
  it("recognizes the English starter chips that are happy paths", () => {
    expect(matchHappyPath("Where could I save money?")).toBe("savings_potential");
    expect(matchHappyPath("Is something shady going on in my account?")).toBe("anomalies");
    expect(matchHappyPath("What subscriptions am I paying for?")).toBe("subscriptions");
    expect(matchHappyPath("Summarize my last 10 spendings")).toBe("recent_spending");
  });

  it("recognizes the German ones — German is the default locale", () => {
    expect(matchHappyPath("Wo könnte ich Geld sparen?")).toBe("savings_potential");
    expect(matchHappyPath("Gibt es verdächtige Aktivitäten auf meinem Konto?")).toBe("anomalies");
    expect(matchHappyPath("Welche Abos bezahle ich?")).toBe("subscriptions");
    expect(matchHappyPath("Fasse meine letzten 10 Ausgaben zusammen")).toBe("recent_spending");
  });

  /** Every shipped chip either takes a happy path or is the allocation one,
   * which ends in an Apply card and belongs on the tool loop. */
  it("covers every starter chip except the allocation proposal", () => {
    for (const locale of [en, de]) {
      for (const key of SUGGESTION_KEYS) {
        const chip = (locale.Chat as unknown as Record<string, string>)[key];
        expect(chip, key).toBeTruthy();
        if (key === "suggestion4") {
          expect(matchHappyPath(chip), chip).toBeUndefined();
        } else {
          expect(matchHappyPath(chip), chip).toBeTruthy();
        }
      }
    }
  });

  /**
   * The guard that keeps a fixed recipe from answering about the wrong window.
   * A recipe has one scope; a question that names another goes to the loop,
   * which resolves periods for a living.
   */
  it("declines a question that names a time window, in either language", () => {
    expect(matchHappyPath("What did I spend by category in March?")).toBeUndefined();
    expect(matchHappyPath("Show my spending breakdown for 2025")).toBeUndefined();
    expect(matchHappyPath("Wie viel habe ich letzten Monat ausgegeben?")).toBeUndefined();
    expect(matchHappyPath("Meine Ausgaben im Dezember")).toBeUndefined();
  });

  /** Row-level questions belong to the SQL escape hatch however they are
   * worded, so the predicate is `routeTool`'s rather than a second copy. */
  it("declines a row-level question the recipes cannot answer", () => {
    expect(matchHappyPath("How many payments did I make?")).toBeUndefined();
    expect(matchHappyPath("What was my single largest expense?")).toBeUndefined();
  });

  it("leaves everything else to the tool loop", () => {
    expect(matchHappyPath("Hello")).toBeUndefined();
    expect(matchHappyPath("Who is my top merchant?")).toBeUndefined();
    expect(matchHappyPath("How much did I earn?")).toBeUndefined();
  });
});

describe("recentCount", () => {
  it("reads the count the question names, in either language", () => {
    expect(recentCount("Summarize my last 5 spendings")).toBe(5);
    expect(recentCount("Fasse meine letzten 20 Ausgaben zusammen")).toBe(20);
  });

  it("defaults to ten and clamps the extremes", () => {
    expect(recentCount("Summarize my recent spending")).toBe(10);
    expect(recentCount("my last 1 payments")).toBe(3);
    expect(recentCount("my last 500 payments")).toBe(25);
  });
});

/**
 * `formatMoney` separates the code from the number with a non-breaking space,
 * because that is what de-CH's ICU data does. Written as an escape so the
 * difference from a plain space is visible in a diff rather than a mystery
 * failure — the same reason `GROUP_SEPARATOR` is spelled out.
 */
const chf = (amount: string) => `CHF\u00a0${amount}`;

/** Only the fields the summaries read; the cast supplies the rest. */
function tx(
  bookedOn: string,
  amountMinor: number,
  merchant: string,
  kind: Transaction["kind"] = "expense",
): Transaction {
  return {
    bookedOn,
    kind,
    amountMinor,
    merchant,
    category: "Food & Drink",
  } as Transaction;
}

describe("recentSpendingSummary", () => {
  const rows = [
    tx("2025-03-10", 500000, "Employer AG", "income"),
    tx("2025-03-09", -12000, "Coop"),
    tx("2025-03-08", -4550, "SBB"),
    tx("2025-03-01", -2000, "Migros"),
  ];

  it("drops the income, cuts to the limit, and totals what is left", () => {
    const summary = recentSpendingSummary(rows, 2, context());
    expect(summary.lines).toHaveLength(2);
    expect(summary.lines.join(" ")).not.toContain("Employer AG");
    // 120.00 + 45.50, in the app's own formatting.
    expect(summary.headline).toContain(chf("165.50"));
  });

  /** `listTransactions` hands back newest-first, so the window runs from the
   * last row to the first — reversing them is the easy bug here. */
  it("reads the window from the oldest listed row to the newest", () => {
    const summary = recentSpendingSummary(rows, 3, context());
    expect(summary.headline).toContain("1 Mar 2025");
    expect(summary.headline).toContain("9 Mar 2025");
  });

  it("names the largest of the listed payments, not the newest", () => {
    expect(recentSpendingSummary(rows, 3, context()).note).toContain("Coop");
  });

  it("says so rather than rendering an empty list", () => {
    const summary = recentSpendingSummary(
      [tx("2025-03-10", 500000, "Employer AG", "income")],
      10,
      context(),
    );
    expect(summary.lines).toHaveLength(0);
    expect(summary.headline).toBe(en.Chat.happy.recentEmpty);
  });
});

function group(overrides: Partial<AnomalyGroup> = {}): AnomalyGroup {
  return {
    ruleId: "AMOUNT_SPIKE",
    title: "Unusually large charge",
    icon: "lucide:trending-up",
    severity: "medium",
    description: "Four times the usual amount at this merchant.",
    transactionCount: 3,
    resolvedCount: 0,
    latestOn: "2025-03-09",
    ...overrides,
  };
}

function overview(overrides: Partial<AnomalyOverview> = {}): AnomalyOverview {
  return {
    action: [],
    context: [],
    hasCompletedScan: true,
    running: false,
    outdated: false,
    resolvedGroupCount: 0,
    ...overrides,
  };
}

/**
 * "found nothing" and "never looked" are opposite answers and only one of them
 * is reassuring — the same distinction `anomaliesToolResult` spells out for
 * the model, made here without asking it.
 */
describe("anomaliesSummary", () => {
  it("tells a clean scan apart from an absent one", () => {
    expect(anomaliesSummary(overview(), context()).headline).toBe(
      en.Chat.happy.anomaliesClean,
    );
    expect(
      anomaliesSummary(overview({ hasCompletedScan: false }), context()).headline,
    ).toBe(en.Chat.happy.anomaliesNever);
    expect(anomaliesSummary(overview({ running: true }), context()).headline).toBe(
      en.Chat.happy.anomaliesRunning,
    );
    expect(anomaliesSummary(overview({ outdated: true }), context()).headline).toBe(
      en.Chat.happy.anomaliesOutdated,
    );
  });

  it("counts the flagged transactions, not the kinds of finding", () => {
    const summary = anomaliesSummary(
      overview({
        action: [group({ transactionCount: 3 }), group({ transactionCount: 4 })],
        context: [group({ transactionCount: 2 })],
      }),
      context(),
    );
    expect(summary.headline).toContain("3 kinds");
    expect(summary.headline).toContain("9 transactions");
    expect(summary.lines).toHaveLength(3);
  });

  /** An outdated scan reports its staleness even when it holds findings —
   * "nothing looks off" for an account nobody has looked at in its current
   * shape is the one wrong answer. */
  it("puts staleness ahead of the findings it still holds", () => {
    const summary = anomaliesSummary(
      overview({ outdated: true, action: [group()] }),
      context(),
    );
    expect(summary.lines).toHaveLength(0);
  });
});

describe("subscriptionsSummary", () => {
  it("prices the year and says what is deliberately missing", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      tx(`2025-${String(i + 1).padStart(2, "0")}-05`, -1890, "Netflix"),
    );
    const summary = subscriptionsSummary(rows, context());
    // 18.90 × 12 cycles.
    expect(summary.headline).toContain(chf("226.80"));
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]).toContain("monthly");
    expect(summary.note).toBe(en.Chat.happy.subsNote);
  });

  it("says so when nothing recurs", () => {
    expect(subscriptionsSummary([tx("2025-03-09", -1200, "Coop")], context()).headline).toBe(
      en.Chat.happy.subsEmpty,
    );
  });
});

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    facets: { accounts: [], categories: [], merchants: [], first: "2025-01-01", last: "2025-03-31" },
    totals: { expense: 300000, expenseCount: 42 },
    categories: [
      { key: "Housing", amount: 200000, count: 3, share: 66.7 },
      { key: "Food & Drink", amount: 80000, count: 30, share: 26.7 },
      { key: "Transport", amount: 20000, count: 9, share: 6.6 },
    ],
    ...overrides,
  } as unknown as Dashboard;
}

function savings(overrides: Partial<SavingsOverview> = {}): SavingsOverview {
  return {
    month: "2025-03",
    monthEnded: true,
    freeMinor: 150000,
    ...overrides,
  } as unknown as SavingsOverview;
}

describe("savingsPotentialSummary", () => {
  it("leads with the unassigned francs and ranks only the flexible categories", () => {
    const summary = savingsPotentialSummary(dashboard(), savings(), context());
    expect(summary.headline).toContain(chf("1’500.00"));
    // Housing is fixed: it is in the lump, never in the advice.
    expect(summary.headline).toContain(chf("2’000.00"));
    expect(summary.lines.join(" ")).not.toContain("Housing");
    expect(summary.lines).toHaveLength(2);
  });

  /** A month that overspent is a real answer, not a cheerful zero. */
  it("reports an overspent month as overspent", () => {
    const summary = savingsPotentialSummary(
      dashboard(),
      savings({ freeMinor: -42000 }),
      context(),
    );
    expect(summary.headline).toContain(chf("420.00"));
    expect(summary.headline).toContain("more than you earned");
  });

  it("does not claim a surplus for a month that is still running", () => {
    const summary = savingsPotentialSummary(
      dashboard(),
      savings({ monthEnded: false }),
      context(),
    );
    expect(summary.headline).toContain(en.Chat.happy.potentialNoMonth);
  });
});

describe("categorySummary", () => {
  it("names the year it is reporting on", () => {
    const summary = categorySummary(dashboard(), context({ year: "2025" }));
    expect(summary.headline).toContain("2025");
    expect(summary.headline).toContain(chf("3’000.00"));
    expect(summary.lines).toHaveLength(3);
  });
});

describe("renderSummary", () => {
  it("bullets the lines and keeps the headline and note bare", () => {
    expect(
      renderSummary({ headline: "Head.", lines: ["a", "b"], note: "Note." }),
    ).toBe("Head.\n• a\n• b\nNote.");
  });
});

/**
 * The one thing a paraphrase can still get wrong is arithmetic it was never
 * asked to do. A reply that states a figure the summary did not is dropped
 * whole — there is no repair pass, because the correct answer is already in
 * hand.
 */
describe("keepsFigures", () => {
  const summary = "You spent CHF 3’000.00 across CHF 2’000.00 of housing.";

  it("accepts a reply quoting the summary's own amounts", () => {
    expect(keepsFigures("Housing took CHF 2’000.00 of your CHF 3’000.00.", summary)).toBe(true);
  });

  it("accepts either apostrophe — the model copies whichever it leans towards", () => {
    expect(keepsFigures("You spent CHF 3'000.00.", summary)).toBe(true);
  });

  it("rejects a total the summary never stated", () => {
    expect(keepsFigures("That leaves CHF 1’000.00 for everything else.", summary)).toBe(false);
  });

  it("rejects a rounded copy of a real amount", () => {
    expect(keepsFigures("You spent CHF 3’000.", summary)).toBe(false);
  });

  /** The summary's own spacing is a non-breaking one; the model types a
   * plain space. Same figure, and it has to read as one. */
  it("accepts a plain space where the summary has a non-breaking one", () => {
    expect(keepsFigures("You spent CHF 3’000.00.", "Total: CHF\u00a03’000.00.")).toBe(true);
  });

  it("is untroubled by a reply carrying no amounts at all", () => {
    expect(keepsFigures("Nothing looks unusual.", summary)).toBe(true);
  });
});
