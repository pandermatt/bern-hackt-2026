import { describe, expect, it } from "vitest";

import type { SavingsOverview } from "@/app/actions/savings";
import type { Dashboard } from "@/app/actions/transactions";
import type { Transaction } from "@/db/schema";
import {
  allocationsFrom,
  asToolName,
  numbersIn,
  parseToolArguments,
  periodArgument,
  showsPlumbing,
  sqlArgument,
  stripReasoning,
  toolNamesIn,
  unverifiedAmounts,
  anomaliesToolResult,
  buildAllocationProposal,
  defaultAllocationSplit,
  defaultPeriod,
  detectSubscriptions,
  extractFollowUps,
  resolvePeriod,
  routeTool,
  savingsGoalsToolResult,
  savingsPotentialToolResult,
  validateSelect,
} from "@/lib/assistant";

/**
 * The static half of the SQL escape hatch's defence. The dynamic half — the
 * throwaway in-memory database holding only the caller's rows — lives behind
 * `server-only` and is exercised end-to-end instead.
 */
describe("validateSelect", () => {
  it("accepts a plain aggregate SELECT", () => {
    expect(
      validateSelect(
        "SELECT merchant, SUM(-amount_chf) AS spent FROM transactions WHERE kind='expense' GROUP BY merchant ORDER BY spent DESC LIMIT 5",
      ),
    ).toBeUndefined();
  });

  it("accepts a subquery and a trailing semicolon", () => {
    expect(
      validateSelect(
        "SELECT booked_on FROM transactions WHERE amount_chf < (SELECT AVG(amount_chf) FROM transactions);",
      ),
    ).toBeUndefined();
  });

  it("forbids WITH / CTEs outright (recursion + cartesian aliasing vector)", () => {
    expect(
      validateSelect("WITH m AS (SELECT 1 FROM transactions) SELECT * FROM m"),
    ).toBeDefined();
    expect(
      validateSelect(
        "WITH x AS (SELECT 1 FROM transactions) SELECT count(*) FROM x a, x b, x c, x d",
      ),
    ).toBeDefined();
  });

  it("bans row-generator and blow-up scalar functions", () => {
    for (const sql of [
      "SELECT printf('%99999999d', 1) FROM transactions",
      "SELECT format('%d', amount_minor) FROM transactions",
      "SELECT hex(zeroblob(1000000)) FROM transactions",
      "SELECT 1 FROM transactions, json_each('[1,2,3]')",
      "SELECT * FROM transactions, generate_series(1, 100000)",
      "SELECT char(65) FROM transactions",
    ]) {
      expect(validateSelect(sql), sql).toBeDefined();
    }
  });

  it("rejects every write and DDL keyword", () => {
    for (const sql of [
      "DELETE FROM transactions",
      "INSERT INTO transactions VALUES (1)",
      "UPDATE transactions SET amount_minor = 0",
      "DROP TABLE transactions",
      "CREATE TABLE x (a)",
      "SELECT * FROM transactions; DROP TABLE transactions",
      "PRAGMA table_info(transactions)",
      "ATTACH DATABASE '/data/app.db' AS main2",
    ]) {
      expect(validateSelect(sql), sql).toBeDefined();
    }
  });

  it("does not trip on column names containing banned stems", () => {
    expect(
      validateSelect(
        "SELECT booked_on AS created, description AS released FROM transactions LIMIT 1",
      ),
    ).toBeUndefined();
  });

  it("rejects the denial-of-service shapes", () => {
    expect(
      validateSelect(
        "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c",
      ),
    ).toBeDefined();
    // A recursive CTE without the RECURSIVE keyword — SQLite runs it anyway.
    expect(
      validateSelect(
        "WITH c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM transactions",
      ),
    ).toBeDefined();
    expect(validateSelect("SELECT randomblob(1000000000)")).toBeDefined();
    expect(
      validateSelect(
        "SELECT * FROM transactions a, transactions b, transactions c",
      ),
    ).toBeDefined();
  });

  it("requires the transactions table and a SELECT head", () => {
    expect(validateSelect("SELECT 1")).toBeDefined();
    expect(validateSelect("EXPLAIN SELECT * FROM transactions")).toBeDefined();
    expect(validateSelect("")).toBeDefined();
  });
});

describe("routeTool", () => {
  it("sends genuinely row-level questions to run_sql", () => {
    expect(routeTool("What was my single largest expense and on which day?")).toBe("run_sql");
    expect(routeTool("How many transactions did I make in March?")).toBe("run_sql");
  });

  it("keeps aggregate superlatives on the charting tools", () => {
    expect(routeTool("What's my biggest spending category?")).toBe("get_spending_by_category");
    expect(routeTool("Who is my largest merchant?")).toBe("get_top_merchants");
  });

  it("routes the four starter proposals to the advice tools", () => {
    expect(routeTool("Where could I save money?")).toBe("get_savings_potential");
    expect(routeTool("Is something shady going on in my account?")).toBe("get_recent_anomalies");
    expect(routeTool("What subscriptions am I paying for?")).toBe("get_subscriptions");
    expect(
      routeTool("How should I split last month's surplus across my saving goals?"),
    ).toBe("get_savings_goals");
  });

  it("routes the German starter proposals too", () => {
    expect(routeTool("Wo könnte ich Geld sparen?")).toBe("get_savings_potential");
    expect(routeTool("Gibt es verdächtige Aktivitäten auf meinem Konto?")).toBe("get_recent_anomalies");
    expect(routeTool("Welche Abos bezahle ich?")).toBe("get_subscriptions");
    expect(
      routeTool("Wie soll ich den Überschuss vom letzten Monat auf meine Sparziele verteilen?"),
    ).toBe("get_savings_goals");
  });

  it("keeps 'how much did I save' on the overview, away from savings potential", () => {
    expect(routeTool("How much did I save this year?")).toBe("get_overview");
  });
});

/** Only the fields `detectSubscriptions` reads; the cast supplies the rest. */
function charge(
  bookedOn: string,
  amountMinor: number,
  merchant: string,
  category = "Subscriptions",
): Transaction {
  return { bookedOn, kind: "expense", amountMinor, merchant, category } as Transaction;
}

describe("detectSubscriptions", () => {
  it("finds a monthly and a yearly subscription and prices the year", () => {
    const rows = [
      // Netflix: the 5th of every month, always the same amount.
      ...Array.from({ length: 12 }, (_, i) =>
        charge(`2025-${String(i + 1).padStart(2, "0")}-05`, -1890, "Netflix"),
      ),
      // A service billed once a year, twice seen.
      charge("2024-03-10", -9900, "Microsoft"),
      charge("2025-03-12", -9900, "Microsoft"),
      // Rent recurs perfectly, but a fixed cost is not a subscription.
      ...Array.from({ length: 12 }, (_, i) =>
        charge(`2025-${String(i + 1).padStart(2, "0")}-01`, -185000, "Rent", "Housing"),
      ),
    ];
    const subs = detectSubscriptions(rows);
    // Ranked by what a year of each costs: 12 × Netflix beats the annual bill.
    expect(subs.map((s) => s.merchant)).toEqual(["Netflix", "Microsoft"]);
    const netflix = subs.find((s) => s.merchant === "Netflix");
    expect(netflix?.cadence).toBe("monthly");
    expect(netflix?.typicalMinor).toBe(1890);
    expect(netflix?.yearlyMinor).toBe(1890 * 12);
    expect(netflix?.lastOn).toBe("2025-12-05");
    expect(subs.find((s) => s.merchant === "Microsoft")?.cadence).toBe("yearly");
  });

  it("rejects an irregular habit and an unstable amount", () => {
    const rows = [
      // Groceries: roughly every three days — no cadence window fits.
      ...Array.from({ length: 10 }, (_, i) =>
        charge(`2025-04-${String(3 * i + 1).padStart(2, "0")}`, -4200, "Migros", "Food & Drink"),
      ),
      // Monthly rhythm but wildly varying amounts.
      charge("2025-01-15", -1200, "Manor", "Clothing"),
      charge("2025-02-15", -9700, "Manor", "Clothing"),
      charge("2025-03-15", -350, "Manor", "Clothing"),
      charge("2025-04-15", -22000, "Manor", "Clothing"),
      // Income is never a subscription, whatever its rhythm.
      ...Array.from({ length: 6 }, (_, i) => ({
        ...charge(`2025-0${i + 1}-25`, 550000, "Employer AG", "Salary"),
        kind: "income" as const,
      })),
    ] as Transaction[];
    expect(detectSubscriptions(rows)).toEqual([]);
  });
});

describe("savingsPotentialToolResult", () => {
  const slice = (key: string, amount: number, share: number) => ({
    key,
    amount,
    count: 1,
    share,
  });
  const dashboard = {
    facets: { accounts: [], first: "2025-01-01", last: "2025-12-31" },
    totals: { expense: 1_000_000, net: 250_000 },
    categories: [
      slice("Housing", 500_000, 50),
      slice("Travel", 300_000, 30),
      slice("Clothing", 150_000, 15),
      slice("Taxes & Fees", 50_000, 5),
    ],
    merchants: [],
    monthly: [],
  } as unknown as Dashboard;
  const overview: SavingsOverview = {
    months: ["2025-06", "2025-07"],
    month: "2025-07",
    monthEnded: true,
    surplusMinor: 120_000,
    pooledMinor: 120000,
    allocatedMinor: 20_000,
    withdrawnMinor: 0,
    freeMinor: 100_000,
    pots: [],
  };

  it("leads with the Unallocated pot's own figure and splits fixed from flexible", () => {
    const payload = savingsPotentialToolResult(dashboard, overview) as {
      unassigned_month: string;
      unassigned_chf: string;
      net_saved_chf: string;
      fixed_categories: string[];
      fixed_costs_chf: string;
      flexible_spending_chf: string;
      flexible_categories: { name: string }[];
    };
    // The same freeMinor the Savings page shows — not a derivation of its own.
    expect(payload.unassigned_month).toBe("2025-07");
    expect(payload.unassigned_chf).toBe("1'000.00");
    expect(payload.net_saved_chf).toBe("2'500.00");
    expect(payload.fixed_categories).toEqual(["Housing", "Taxes & Fees"]);
    expect(payload.fixed_costs_chf).toBe("5'500.00");
    expect(payload.flexible_spending_chf).toBe("4'500.00");
    expect(payload.flexible_categories.map((c) => c.name)).toEqual([
      "Travel",
      "Clothing",
    ]);
  });

  it("keeps a negative month honest instead of flooring it", () => {
    const overdrawn = savingsPotentialToolResult(dashboard, {
      ...overview,
      surplusMinor: -40_000,
      allocatedMinor: 0,
      withdrawnMinor: 0,
      freeMinor: -40_000,
    }) as { unassigned_chf: string };
    expect(overdrawn.unassigned_chf).toBe("-400.00");
  });

  it("omits the unassigned block when there are no statement months", () => {
    const payload = savingsPotentialToolResult(dashboard, null) as Record<
      string,
      unknown
    >;
    expect(payload.unassigned_chf).toBeUndefined();
    expect(payload.fixed_costs_chf).toBe("5'500.00");
  });
});

describe("savingsGoalsToolResult", () => {
  const pot = (name: string, targetMinor: number, savedMinor: number) => ({
    id: 1,
    name,
    targetMinor,
    savedMinor,
    monthMinor: 0,
    monthWithdrawnMinor: 0,
    targetOn: null,
    icon: null,
    slot: 0,
  });

  it("hands the model the free surplus and each goal's gap", () => {
    const overview: SavingsOverview = {
      months: ["2025-06", "2025-07"],
      month: "2025-07",
      monthEnded: true,
      surplusMinor: 120_000,
      pooledMinor: 120000,
      allocatedMinor: 20_000,
      withdrawnMinor: 0,
      freeMinor: 100_000,
      pots: [pot("Ferien", 500_000, 350_000)],
    };
    const payload = savingsGoalsToolResult(overview) as {
      free_to_allocate_chf: string;
      goals: { still_missing_chf: string }[];
      note: string;
    };
    expect(payload.free_to_allocate_chf).toBe("1'000.00");
    expect(payload.goals[0].still_missing_chf).toBe("1'500.00");
    expect(payload.note).toContain("cannot move money");
  });

  it("says so while the month still runs, and when there are no goals", () => {
    const running = savingsGoalsToolResult({
      months: ["2025-07", "2025-08"],
      month: "2025-08",
      monthEnded: false,
      surplusMinor: null,
      pooledMinor: 0,
      allocatedMinor: 0,
      withdrawnMinor: 0,
      freeMinor: 0,
      pots: [pot("Auto", 100_000, 0)],
    }) as { surplus_chf: null; note: string };
    expect(running.surplus_chf).toBeNull();
    expect(running.note).toContain("still running");

    const goalless = savingsGoalsToolResult({
      months: ["2025-06", "2025-07"],
      month: "2025-07",
      monthEnded: true,
      surplusMinor: 50_000,
      pooledMinor: 50000,
      allocatedMinor: 0,
      withdrawnMinor: 0,
      freeMinor: 50_000,
      pots: [],
    }) as { note: string };
    expect(goalless.note).toContain("no saving goals");
  });
});

describe("buildAllocationProposal", () => {
  const overview = (patch: Partial<SavingsOverview> = {}): SavingsOverview => ({
    months: ["2025-06", "2025-07"],
    month: "2025-07",
    monthEnded: true,
    surplusMinor: 120_000,
    pooledMinor: 120000,
    allocatedMinor: 20_000,
    withdrawnMinor: 0,
    freeMinor: 100_000,
    pots: [
      { id: 1, name: "Ferien", targetMinor: 500_000, savedMinor: 100_000, monthMinor: 0, monthWithdrawnMinor: 0, targetOn: null, icon: null, slot: 0 },
      { id: 2, name: "Auto", targetMinor: 300_000, savedMinor: 50_000, monthMinor: 20_000, monthWithdrawnMinor: 0, targetOn: null, icon: null, slot: 1 },
    ],
    ...patch,
  });

  it("builds the card rows as adds, matched case-insensitively", () => {
    const { proposal, result } = buildAllocationProposal(
      [
        { goal: "ferien", amountMinor: 60_000 },
        { goal: "Auto", amountMinor: 30_000 },
      ],
      overview(),
    );
    expect(proposal?.items).toEqual([
      { goalId: 1, name: "Ferien", addMinor: 60_000 },
      { goalId: 2, name: "Auto", addMinor: 30_000 },
    ]);
    expect(proposal?.addTotalMinor).toBe(90_000);
    expect((result as { shown_to_customer: boolean }).shown_to_customer).toBe(true);
  });

  it("merges duplicate goals and scales an over-budget split down to fit", () => {
    const { proposal, result } = buildAllocationProposal(
      [
        { goal: "Ferien", amountMinor: 40_000 },
        { goal: "Ferien", amountMinor: 40_000 },
        { goal: "Auto", amountMinor: 80_000 },
      ],
      overview(),
    );
    // 160'000 proposed against 100'000 free → halved, to whole francs.
    expect(proposal?.items.map((i) => i.addMinor)).toEqual([50_000, 50_000]);
    expect(proposal?.addTotalMinor).toBe(100_000);
    expect((result as { note_scaled?: string }).note_scaled).toBeTruthy();
  });

  it("reports unknown goals and errors when nothing matches", () => {
    const some = buildAllocationProposal(
      [
        { goal: "Ferien", amountMinor: 10_000 },
        { goal: "Yacht", amountMinor: 10_000 },
      ],
      overview(),
    );
    expect((some.result as { ignored_unknown_goals: string[] }).ignored_unknown_goals).toEqual(["Yacht"]);

    const none = buildAllocationProposal(
      [{ goal: "Yacht", amountMinor: 10_000 }],
      overview(),
    );
    expect(none.proposal).toBeUndefined();
    expect((none.result as { error: string }).error).toContain("Ferien");
  });

  it("refuses a running month, an empty free amount, and missing goals", () => {
    const running = buildAllocationProposal(
      [{ goal: "Ferien", amountMinor: 10_000 }],
      overview({ monthEnded: false, surplusMinor: null, freeMinor: 0 }),
    );
    expect(running.proposal).toBeUndefined();
    expect((running.result as { error: string }).error).toContain("still running");

    const spent = buildAllocationProposal(
      [{ goal: "Ferien", amountMinor: 10_000 }],
      overview({ freeMinor: 0 }),
    );
    expect((spent.result as { error: string }).error).toContain("already fully");

    const goalless = buildAllocationProposal(
      [{ goal: "Ferien", amountMinor: 10_000 }],
      overview({ pots: [] }),
    );
    expect((goalless.result as { error: string }).error).toContain("no saving goals");
  });
});

describe("anomaliesToolResult", () => {
  const group = {
    ruleId: "AMOUNT_SPIKE",
    title: "Unusually large charge",
    icon: "zap",
    severity: "high" as const,
    description: "A charge far above this merchant's usual range.",
    transactionCount: 2,
    latestOn: "2025-08-01",
    resolvedCount: 0,
  };

  it("distinguishes 'nothing found' from 'never scanned'", () => {
    const clean = anomaliesToolResult({
      action: [],
      context: [group],
      hasCompletedScan: true,
      running: false,
      outdated: false,
      resolvedGroupCount: 0,
    }) as { status: string; note: string };
    expect(clean.status).toBe("ok");
    expect(clean.note).toContain("reassure");

    const unscanned = anomaliesToolResult({
      action: [],
      context: [],
      hasCompletedScan: false,
      running: false,
      outdated: false,
      resolvedGroupCount: 0,
    }) as { status: string };
    expect(unscanned.status).toBe("never_scanned");
  });

  it("surfaces findings that need a look, compacted for the model", () => {
    const payload = anomaliesToolResult({
      action: [group],
      context: [],
      hasCompletedScan: true,
      running: false,
      outdated: false,
      resolvedGroupCount: 0,
    }) as { needs_a_look: { finding: string; severity: string }[] };
    expect(payload.needs_a_look).toEqual([
      {
        finding: "Unusually large charge",
        severity: "high",
        transactions: 2,
        latest_on: "2025-08-01",
        summary: "A charge far above this merchant's usual range.",
      },
    ]);
  });
});

describe("defaultPeriod", () => {
  it("defaults an unscoped question to year-to-date", () => {
    expect(defaultPeriod("Where does my money go?")).toBe("ytd");
    expect(defaultPeriod("Who are my top merchants?")).toBe("ytd");
  });

  it("yields the full history only for an explicit all-time ask", () => {
    expect(defaultPeriod("Show my spending over all time")).toBeUndefined();
    expect(defaultPeriod("What are my biggest merchants ever?")).toBeUndefined();
    expect(defaultPeriod("my lifetime savings")).toBeUndefined();
  });
});

describe("extractFollowUps", () => {
  it("splits the inline array form the locale prompt invites", () => {
    const { text, followUps } = extractFollowUps(
      'You spent CHF 500.\nFOLLOWUP: ["How much did I save?", "Which month was priciest?"]',
    );
    expect(text).toBe("You spent CHF 500.");
    expect(followUps).toEqual([
      "How much did I save?",
      "Which month was priciest?",
    ]);
  });

  it("drops duplicate proposals", () => {
    const { followUps } = extractFollowUps(
      "Done.\nFOLLOWUP: How much did I save?\nFOLLOWUP: How much did I save?\nFOLLOWUP: What about June?",
    );
    expect(followUps).toEqual(["How much did I save?", "What about June?"]);
  });

  it("leaves lowercase prose 'follow-up:' in the visible reply", () => {
    const { text, followUps } = extractFollowUps(
      "One follow-up: you could cancel Netflix to save CHF 215.40 per year.",
    );
    expect(text).toContain("cancel Netflix");
    expect(followUps).toEqual([]);
  });
});

describe("resolvePeriod off-enum tokens", () => {
  const last = "2025-08-15";
  it("maps the spellings an 8B model actually emits", () => {
    expect(resolvePeriod("this_year", last)?.from).toBe("2025-01-01");
    expect(resolvePeriod("this_month", last)).toEqual({
      from: "2025-08-01",
      to: last,
      label: "2025-08",
    });
    expect(resolvePeriod("last_year", last)).toEqual({
      from: "2024-01-01",
      to: "2024-12-31",
      label: "2024",
    });
    expect(resolvePeriod("previous_month", last)?.label).toBe("2025-07");
  });

  it("still yields undefined for junk, so the caller's fallback chain runs", () => {
    expect(resolvePeriod("recent", last)).toBeUndefined();
  });
});

describe("defaultAllocationSplit", () => {
  const overview = (patch: Partial<SavingsOverview> = {}): SavingsOverview => ({
    months: ["2025-06", "2025-07"],
    month: "2025-07",
    monthEnded: true,
    surplusMinor: 100_000,
    pooledMinor: 100000,
    allocatedMinor: 0,
    withdrawnMinor: 0,
    freeMinor: 100_000,
    pots: [
      { id: 1, name: "Ferien", targetMinor: 400_000, savedMinor: 100_000, monthMinor: 0, monthWithdrawnMinor: 0, targetOn: null, icon: null, slot: 0 },
      { id: 2, name: "Auto", targetMinor: 200_000, savedMinor: 100_000, monthMinor: 0, monthWithdrawnMinor: 0, targetOn: null, icon: null, slot: 1 },
    ],
    ...patch,
  });

  it("splits the free amount proportional to each goal's remaining gap", () => {
    // Gaps: Ferien 3000, Auto 1000 → 75% / 25% of the CHF 1000 free.
    expect(defaultAllocationSplit(overview())).toEqual([
      { goal: "Ferien", amountMinor: 75_000 },
      { goal: "Auto", amountMinor: 25_000 },
    ]);
  });

  it("falls back to equal parts when every goal is already full", () => {
    const full = overview({
      pots: [
        { id: 1, name: "A", targetMinor: 100, savedMinor: 100, monthMinor: 0, monthWithdrawnMinor: 0, targetOn: null, icon: null, slot: 0 },
        { id: 2, name: "B", targetMinor: 100, savedMinor: 200, monthMinor: 0, monthWithdrawnMinor: 0, targetOn: null, icon: null, slot: 1 },
      ],
    });
    expect(defaultAllocationSplit(full)).toEqual([
      { goal: "A", amountMinor: 50_000 },
      { goal: "B", amountMinor: 50_000 },
    ]);
  });

  it("proposes nothing for a running month, an empty free amount, or no goals", () => {
    expect(defaultAllocationSplit(overview({ monthEnded: false }))).toEqual([]);
    expect(defaultAllocationSplit(overview({ freeMinor: 0 }))).toEqual([]);
    expect(defaultAllocationSplit(overview({ pots: [] }))).toEqual([]);
    expect(defaultAllocationSplit(null)).toEqual([]);
  });

  it("survives the shared validator into a card", () => {
    const view = overview();
    const { proposal } = buildAllocationProposal(defaultAllocationSplit(view), view);
    expect(proposal?.addTotalMinor).toBe(100_000);
    expect(proposal?.items.map((i) => i.name)).toEqual(["Ferien", "Auto"]);
  });
});

/**
 * What replaced the prose parsers. The endpoint hands back `arguments` as a
 * JSON string it never validated, so these are the guards between it and the
 * tools — nothing here may throw, and nothing may repair a value into
 * something the model did not say.
 */
describe("tool call arguments", () => {
  it("parses an ordinary argument object", () => {
    expect(parseToolArguments('{"period": "2025-03"}')).toEqual({ period: "2025-03" });
    expect(periodArgument({ period: " YTD " })).toBe("ytd");
    expect(sqlArgument({ sql: "SELECT 1 FROM transactions" })).toBe(
      "SELECT 1 FROM transactions",
    );
  });

  it("treats unusable arguments as absent rather than throwing", () => {
    // Truncation at max_tokens, an empty call and a non-object are all routine.
    // Note what is NOT here: the prose sweep that used to salvage goal/amount
    // pairs out of a truncated array. A native call either arrives complete or
    // the round is re-asked, so there is no half-call left to rescue.
    expect(parseToolArguments('{"period": ')).toEqual({});
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
    expect(parseToolArguments("[1, 2]")).toEqual({});
    expect(periodArgument({})).toBeUndefined();
    expect(periodArgument({ period: "  " })).toBeUndefined();
    expect(sqlArgument({ sql: 42 })).toBeUndefined();
  });

  it("recognises only tools it actually serves", () => {
    expect(asToolName("run_sql")).toBe("run_sql");
    // A neighbouring model emitted exactly this typo in testing.
    expect(asToolName("run__sql")).toBeUndefined();
    expect(asToolName(undefined)).toBeUndefined();
    expect(
      toolNamesIn([
        { id: "a", type: "function", function: { name: "get_overview", arguments: "{}" } },
        { id: "b", type: "function", function: { name: "nope", arguments: "{}" } },
      ]),
    ).toEqual(["get_overview"]);
  });
});

describe("allocationsFrom", () => {
  it("reads a clean call, numeric and Swiss-formatted string amounts alike", () => {
    expect(
      allocationsFrom({
        allocations: [
          { goal: "Ferien", amount_chf: 600 },
          { goal: "Auto", amount_chf: "CHF 1'200,50" },
        ],
      }),
    ).toEqual([
      { goal: "Ferien", amountMinor: 60_000 },
      { goal: "Auto", amountMinor: 120_050 },
    ]);
  });

  it("tolerates the wrapper key and field names the model reaches for", () => {
    expect(allocationsFrom({ split: [{ name: "Ferien", amount: 600 }] })).toEqual([
      { goal: "Ferien", amountMinor: 60_000 },
    ]);
  });

  it("drops entries it cannot read, and returns nothing for nothing", () => {
    expect(
      allocationsFrom({ allocations: [{ goal: "Ferien" }, { amount_chf: 50 }, 7] }),
    ).toEqual([]);
    expect(allocationsFrom({})).toEqual([]);
  });

  // The comma is ambiguous on a Swiss statement and the reading has to be the
  // same one `francsToMinor` always made.
  it("keeps the comma semantics", () => {
    const parse = (amount: string) =>
      allocationsFrom({ allocations: [{ goal: "F", amount_chf: amount }] })[0]?.amountMinor;
    expect(parse("89,90")).toBe(8_990);
    expect(parse("1'234,5")).toBe(123_450);
    expect(parse("1,250")).toBe(125_000);
    expect(parse("1,250.50")).toBe(125_050);
  });
});

/**
 * An answer that names a tool, or that is a call the model typed out instead
 * of making, is not an answer — it is the model showing its plumbing. Used
 * only to reject a reply, never to route one. FOLLOWUP lines are removed
 * before this ever sees the text, so a follow-up naming a tool is not the
 * false positive it would otherwise be.
 */
describe("showsPlumbing", () => {
  it("passes a real answer", () => {
    expect(showsPlumbing("You spend the most on Wednesdays.")).toBe(false);
    expect(showsPlumbing("Ihr Geld fliesst in die Miete (21'840.00 CHF).")).toBe(false);
  });

  it("rejects a tool named in prose, or a call written out as JSON", () => {
    expect(showsPlumbing("Call get_savings_goals with the month.")).toBe(true);
    expect(
      showsPlumbing('Here you go:\n{"allocations": [{"goal": "Ferien"}]}'),
    ).toBe(true);
  });

  it("rejects a tool the model invented, not just the ones that exist", () => {
    // Observed live: the reader was told to call a function nobody wrote.
    expect(
      showsPlumbing("Ich kann das nicht beantworten. Bitte rufe get_weekday_spending an."),
    ).toBe(true);
    expect(showsPlumbing("Sort by amount_chf to see it.")).toBe(true);
  });
});

/**
 * The assistant's one hard promise is that every franc on screen came off the
 * customer's statements. The model quotes one it was never given on a
 * minority of turns — naming March's spending as CHF 5'210.40 when the tool
 * had returned CHF 6'960.90.
 */
describe("unverifiedAmounts", () => {
  const seen = numbersIn(
    JSON.stringify({ rows: [{ month: "March", spent: "6'960.90" }, { spent: "12'423.03" }] }),
  );

  it("passes amounts the tools returned", () => {
    expect(unverifiedAmounts("March was CHF 6'960.90, July CHF 12'423.03.", seen)).toEqual([]);
  });

  it("catches an amount no tool returned", () => {
    expect(unverifiedAmounts("March was the highest at CHF 5'210.40.", seen)).toEqual([
      "5'210.40",
    ]);
  });

  it("does not police percentages, years, or counts", () => {
    expect(
      unverifiedAmounts("In 2025 you made 48 payments, about 23.5% of them online.", seen),
    ).toEqual([]);
  });
});

/** The model's scratchpad is never the answer. */
describe("stripReasoning", () => {
  it("removes think blocks, keeping the answer after them", () => {
    expect(
      stripReasoning("<think>Der Benutzer fragt auf Deutsch…</think>\n\nDein Geld geht…"),
    ).toBe("Dein Geld geht…");
  });

  it("drops an unclosed think block whole — a truncated answer is not an answer", () => {
    expect(stripReasoning("Fine so far. <think>and then it was cut off")).toBe("Fine so far.");
  });

  it("removes Apertus control tokens and anything after a tool block", () => {
    expect(stripReasoning('Answer.<|tools_prefix|>[{"get_overview": {}}]')).toBe("Answer.");
    expect(stripReasoning("<|assistant|>Answer.<|end|>")).toBe("Answer.");
  });
});
