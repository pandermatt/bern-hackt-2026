import { describe, expect, it } from "vitest";

import {
  defaultPeriod,
  extractJsonAfter,
  extractSql,
  looksLikeStall,
  routeTool,
  sanitizeEChartsOption,
  validateSelect,
  wantsNonPieChart,
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

describe("extractSql", () => {
  it("reads sql out of well-formed args", () => {
    expect(
      extractSql('[{"run_sql": {"sql": "SELECT * FROM transactions"}}]'),
    ).toBe("SELECT * FROM transactions");
  });

  it("survives mangled surrounding JSON via the string-field fallback", () => {
    expect(
      extractSql(
        'run_sql with "sql": "SELECT \\"a\\" FROM transactions WHERE kind=\'expense\'" and trailing garbage',
      ),
    ).toBe('SELECT "a" FROM transactions WHERE kind=\'expense\'');
  });

  it("returns undefined when there is nothing to find", () => {
    expect(extractSql("[{run_sql: }]")).toBeUndefined();
  });
});

describe("extractJsonAfter", () => {
  it("returns the first balanced object after the marker", () => {
    expect(
      extractJsonAfter('call display_echart {"a": {"b": [1, 2]}} tail', "display_echart"),
    ).toEqual({ a: { b: [1, 2] } });
  });

  it("is not fooled by braces inside strings", () => {
    expect(
      extractJsonAfter('display_echart {"label": "a } b", "n": 1}', "display_echart"),
    ).toEqual({ label: "a } b", n: 1 });
  });

  it("unwraps a marker-keyed wrapper when the model narrates before the call", () => {
    // The anchor lands on the prose mention, so the first object is the wrapper.
    expect(
      extractJsonAfter(
        'I will use display_echart. [{"display_echart": {"option": {"series": []}}}]',
        "display_echart",
      ),
    ).toEqual({ option: { series: [] } });
  });

  it("leaves a direct (non-wrapper) args object untouched", () => {
    expect(
      extractJsonAfter('[{"run_sql": {"sql": "SELECT 1"}}]', "run_sql"),
    ).toEqual({ sql: "SELECT 1" });
  });

  it("returns undefined for unbalanced or invalid JSON", () => {
    expect(extractJsonAfter('display_echart {"a": ', "display_echart")).toBeUndefined();
  });
});

describe("looksLikeStall", () => {
  it("treats planning phrases as stalls", () => {
    expect(looksLikeStall("Let me check that for you.")).toBe(true);
    expect(looksLikeStall("First, I will generate a SQL query for this.")).toBe(true);
    expect(looksLikeStall("I need to fetch the data.")).toBe(true);
  });

  it("does NOT treat a genuine caption mentioning the query as a stall", () => {
    expect(looksLikeStall("The query returned 42 transactions in March.")).toBe(false);
    expect(looksLikeStall("Your biggest expense was CHF 7'439.00 on 2025-08-14.")).toBe(false);
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

describe("wantsNonPieChart", () => {
  it("detects an explicit bar/line chart request", () => {
    expect(wantsNonPieChart("Show me a bar chart of spending per month")).toBe("bar");
    expect(wantsNonPieChart("plot it as a line")).toBe("line");
  });

  it("does not fire on incidental words or when a pie is asked for", () => {
    expect(wantsNonPieChart("What's my bottom line this year?")).toBeUndefined();
    expect(wantsNonPieChart("How much did I spend at the coffee bar?")).toBeUndefined();
    expect(wantsNonPieChart("Show my categories as a pie, not a bar chart")).toBeUndefined();
  });
});

describe("sanitizeEChartsOption", () => {
  const series = [{ type: "bar", data: [1, 2] }];

  it("keeps an ordinary option", () => {
    const option = sanitizeEChartsOption({
      xAxis: { type: "category", data: ["a", "b"] },
      series,
    });
    expect(option).toBeDefined();
    expect(option).toHaveProperty("series");
  });

  it("strips graphic, image, tooltip, and toolbox everywhere", () => {
    const option = sanitizeEChartsOption({
      graphic: [{ type: "image" }],
      tooltip: { formatter: "x" },
      toolbox: { feature: {} },
      series: [{ type: "bar", data: [1], itemStyle: { color: { image: "http://evil" } } }],
    }) as Record<string, unknown>;
    expect(option).toBeDefined();
    expect(JSON.stringify(option)).not.toMatch(/graphic|image|tooltip|toolbox|evil/);
  });

  it("drops image:// and path:// string values (SSRF/beacon vector)", () => {
    const option = sanitizeEChartsOption({
      series: [
        {
          type: "scatter",
          symbol: "image://https://attacker.example/beacon.png?leak=1",
          data: [[1, 1]],
        },
      ],
    }) as Record<string, unknown>;
    expect(option).toBeDefined();
    expect(JSON.stringify(option)).not.toMatch(/attacker\.example|image:\/\//);
    // A per-datum symbol and markPoint symbol carry the same value — also gone.
    const nested = sanitizeEChartsOption({
      series: [
        {
          type: "line",
          data: [{ value: 1, symbol: "image://https://x.test/p.png" }],
          markPoint: { data: [{ symbol: "path://M0,0" }] },
        },
      ],
    }) as Record<string, unknown>;
    expect(JSON.stringify(nested)).not.toMatch(/x\.test|image:\/\/|path:\/\//);
  });

  it("rejects non-objects, series-less options, and oversized payloads", () => {
    expect(sanitizeEChartsOption("SELECT")).toBeUndefined();
    expect(sanitizeEChartsOption({ xAxis: {} })).toBeUndefined();
    expect(
      sanitizeEChartsOption({ series, blob: "x".repeat(30_000) }),
    ).toBeUndefined();
  });
});
