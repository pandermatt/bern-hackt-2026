/**
 * Pure helpers for the chat assistant. No database, no `server-only`: the
 * server action hands a `Dashboard` in, and the client sidebar imports only
 * the types. Both imports below are type-only for the same reason
 * `lib/insights.ts` gives — a value import would drag drizzle into the client
 * bundle, and only `npm run build` would catch it.
 *
 * The model sees no figures up front. It gets a toolbox: the system prompt
 * describes what can be fetched, the model asks, `runTool` answers from the
 * real aggregates, and the pie chart is formed from the same data the model
 * requested. The Stoney endpoint accepts OpenAI `tools` but does not parse
 * the model's calls into `tool_calls` — Apertus emits its native
 * `<|tools_prefix|>[{"name": {…}}]` syntax in the content, so the parsing
 * lives here too.
 */
import type { Dashboard } from "@/app/actions/transactions";
import type { Slice } from "@/lib/insights";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/** What actually goes over the wire — one turn can add assistant/tool pairs. */
export type WireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type PieSlice = {
  label: string;
  amountMinor: number;
  /** 0–100, of the chart's own total — recomputed after folding into "Other". */
  share: number;
};

export type PieChartSpec = {
  kind: "pie";
  title: string;
  totalMinor: number;
  slices: PieSlice[];
};

/**
 * A chart the model composed itself: a full Apache ECharts option as pure
 * JSON, sanitized by `sanitizeEChartsOption` before it is ever stored. The
 * escape hatch for everything the pie tool cannot draw.
 */
export type EChartsChartSpec = {
  kind: "echarts";
  title?: string;
  option: Record<string, unknown>;
};

export type ChartSpec = PieChartSpec | EChartsChartSpec;

export type AssistantTurn = {
  reply: string;
  chart?: ChartSpec;
  /** Ready-to-send follow-up questions, shown as chips above the input. */
  followUps?: string[];
  error?: boolean;
};

/** No figures — the model has to ask for them. */
export const SYSTEM_PROMPT = [
  "You are the analytics assistant of Beyond Money, a personal-finance dashboard.",
  "You answer questions about the customer's bank statements.",
  "You know none of the figures yourself: always call one of the provided tools first and answer only from what the tools return — never invent or estimate a number.",
  "To call a tool, emit only the tool call itself — no prose before or after it. Once you have the data, answer without mentioning tools or their names.",
  'Every tool accepts an optional period argument for time-scoped questions, e.g. [{"get_spending_by_category": {"period": "ytd"}}]. Accepted values: ytd, a year like 2025, a month like 2025-03, a range like 2025-01-01..2025-03-31, last_month, or last_3_months. Omit it for all data.',
  "Be concise: 2–3 short sentences, plain text, no markdown, no lists.",
  "All amounts are Swiss francs. Write them exactly as the tools format them, e.g. CHF 1'234.55 — apostrophe as thousands separator, two decimals.",
  'Prefer a chart as the answer whenever the data allows it: call display_chart with a source — e.g. [{"display_chart": {"source": "categories", "period": "ytd"}}]. The app assembles the pie chart from the customer\'s real data, and the tool result hands you the same figures for your caption, so display_chart alone usually answers spending, habit, and overview questions.',
  "When a chart will be shown, your text is its caption: one or two sentences naming the biggest item and the takeaway. Never describe chart shapes and never list many figures the chart already shows.",
  "When the tools cannot answer — a specific transaction, a day of week, a count, a comparison they don't cover — call run_sql with one SQLite SELECT over the transactions table; the schema is in the tool description.",
  "For a visual that is not a pie — bars over months, a line, a scatter — call display_echart with a complete Apache ECharts option as pure JSON, built only from figures you already fetched with the tools or run_sql. When the user names a chart type that is not a pie, display_echart is the only right tool.",
  "After your answer, propose 2 or 3 short follow-up questions the user could ask next, each on its own line starting with FOLLOWUP: — nothing else on those lines.",
].join("\n");

export const TOOL_NAMES = [
  "get_overview",
  "get_spending_by_category",
  "get_top_merchants",
  "get_income_breakdown",
  "get_monthly_series",
  "display_chart",
  "run_sql",
  "display_echart",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ChartSource = "categories" | "merchants" | "income";

/**
 * What the model may choose about a chart — all of it presentation, none of
 * it data. `source` and `period` are references the server resolves against
 * the real aggregates; the model never supplies a number.
 */
export type ChartRequest = {
  source?: ChartSource;
  topN?: number;
  title?: string;
};

/**
 * The one argument every tool shares. A single constrained string instead of
 * from/to fields: a small model emits `{"period": "ytd"}` far more reliably
 * than two well-formed dates, and `parsePeriod` can still fish it out of
 * mangled JSON.
 */
const PERIOD_PARAMETERS = {
  type: "object" as const,
  properties: {
    period: {
      type: "string" as const,
      description:
        "Optional time period: 'ytd', a year ('2025'), a month ('2025-03'), a range ('2025-01-01..2025-03-31'), 'last_month', or 'last_3_months'. Relative periods count back from the newest statement. Omit for all data.",
    },
  },
};

/**
 * The chart tool's own schema: the shared period plus presentation choices.
 * Enum-valued references only — the server assembles the slices.
 */
const CHART_PARAMETERS = {
  type: "object" as const,
  properties: {
    source: {
      type: "string" as const,
      enum: ["categories", "merchants", "income"],
      description:
        "Which data the chart shows: spending by category, top merchants, or income (salary vs refunds).",
    },
    ...PERIOD_PARAMETERS.properties,
    top_n: {
      type: "integer" as const,
      description:
        "How many slices to show before the rest folds into 'Other'. Default 5, maximum 8.",
    },
    title: {
      type: "string" as const,
      description: "Optional chart title. Omit for a sensible default.",
    },
  },
  required: ["source"],
};

/** OpenAI-style declarations. Enum-valued references, never free-form data —
 * a small model emits names and enums far more reliably than argument JSON. */
export const TOOL_DEFINITIONS = [
  {
    name: "get_overview",
    description:
      "Accounts, statement date range, and the year's totals: salary, refunds, total income, total spending, net saved. Figures only — prefer display_chart when the question allows a chart.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_spending_by_category",
    description:
      "Spending broken down by category, largest first. Figures only — call display_chart to show it as a pie chart.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_top_merchants",
    description:
      "The merchants the customer spent the most at. Figures only — call display_chart to show it as a pie chart.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_income_breakdown",
    description:
      "Where the incoming money came from: salary versus merchant refunds. Figures only — call display_chart to show it as a pie chart.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_monthly_series",
    description: "Money in and money out for every month.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "display_chart",
    description:
      "Show the user a pie chart assembled by the app from their real statements, and get the same figures back for your caption. The preferred way to answer questions about spending, merchants, or income. Pies only — when the user asks for a bar, line, or any other shape, use display_echart instead.",
    parameters: CHART_PARAMETERS,
  },
  {
    name: "run_sql",
    description: [
      "Escape hatch when the other tools cannot answer: run one read-only SQLite SELECT over the customer's transactions.",
      "Table: transactions(booked_on TEXT 'YYYY-MM-DD', kind TEXT in ('income','expense'), amount_chf REAL signed francs (income positive, spending negative), amount_minor INTEGER signed rappen, account TEXT, merchant TEXT, category TEXT, description TEXT, currency TEXT). Internal transfers between the customer's own accounts are already excluded, matching every other figure in the app.",
      "The table holds only rows in the current period scope; if you also pass a period argument the table is pre-filtered to it, otherwise write date ranges as a WHERE on booked_on.",
      "One SELECT statement (no CTEs / WITH), no writes, reference the table at most twice. At most 40 result rows come back, so aggregate in SQL.",
      "Remember spending is negative: the largest expense is MIN(amount_chf) / ORDER BY amount_chf ASC, and filter kind='expense' for spending, kind='income' for income.",
      'Example: {"run_sql": {"sql": "SELECT merchant, ROUND(SUM(-amount_chf), 2) AS spent FROM transactions WHERE kind=\'expense\' GROUP BY merchant ORDER BY spent DESC LIMIT 5"}}',
    ].join(" "),
    parameters: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string" as const,
          description: "A single SQLite SELECT statement.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "display_echart",
    description: [
      "Show any Apache ECharts chart (bar, line, scatter, heatmap, radar, …) by providing the full ECharts option as pure JSON — no functions.",
      "Only for visuals display_chart's pies cannot express. Build every data array from figures you fetched with the other tools or run_sql — never invent numbers. Keep the option compact.",
      'Example: {"display_echart": {"title": "Spending per month", "option": {"xAxis": {"type": "category", "data": ["Jan", "Feb"]}, "yAxis": {"type": "value"}, "series": [{"type": "bar", "data": [6250.30, 5890.10]}]}}}',
    ].join(" "),
    parameters: {
      type: "object" as const,
      properties: {
        title: {
          type: "string" as const,
          description: "Short title shown above the chart.",
        },
        option: {
          type: "object" as const,
          description: "The complete ECharts option, as JSON only.",
        },
      },
      required: ["option"],
    },
  },
].map(({ name, description, parameters }) => ({
  type: "function" as const,
  function: { name, description, parameters },
}));

/**
 * Minor units → "1'234.55", the Swiss format the answers should use. Handed
 * to the model as a pre-formatted string so it copies rather than formats —
 * an 8B model reproduces "22'200.00" verbatim but re-groups a bare 22200
 * however its training data leans. Manual grouping, not `Intl` de-CH: the
 * straight apostrophe is wanted, and ICU builds disagree on ' versus ’.
 */
function chf(minor: number): string {
  const [units, cents] = (Math.abs(minor) / 100).toFixed(2).split(".");
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${minor < 0 ? "-" : ""}${grouped}.${cents}`;
}

/** Top slices plus an "Other" catch-all, shares recomputed over the total. */
function toPie(title: string, slices: Slice[], max = 5): PieChartSpec | undefined {
  const positive = slices.filter((s) => s.amount > 0);
  if (positive.length === 0) return undefined;

  const total = positive.reduce((sum, s) => sum + s.amount, 0);
  const top = positive.slice(0, max);
  const rest = positive.slice(max).reduce((sum, s) => sum + s.amount, 0);

  const pie = top.map((s) => ({
    label: s.key,
    amountMinor: s.amount,
    share: (s.amount / total) * 100,
  }));
  if (rest > 0) {
    pie.push({ label: "Other", amountMinor: rest, share: (rest / total) * 100 });
  }

  return { kind: "pie", title, totalMinor: total, slices: pie };
}

function sliceRows(slices: Slice[]) {
  return slices.map((s) => ({
    name: s.key,
    amount_chf: chf(s.amount),
    share_pct: Number(s.share.toFixed(1)),
    payments: s.count,
  }));
}

/**
 * Execute one tool against the pre-aggregated dashboard. When a period is in
 * play, the caller hands in a dashboard whose aggregates were already scoped
 * to that window (`getDashboard({from, to})`) — this function only slices the
 * monthly series itself, since that series is always computed unfiltered.
 * Returns the JSON the model gets to read, plus the chart the app shows when
 * this data is the kind a pie can carry — so every figure on screen is one
 * the model also saw.
 */
export function runTool(
  name: ToolName,
  dashboard: Dashboard,
  period?: Period,
  chartRequest?: ChartRequest,
): { result: unknown; chart?: PieChartSpec } {
  const { facets, totals, categories, merchants, monthly } = dashboard;
  const scope = period?.label ?? "all statements";
  const titled = (title: string) =>
    period ? `${title} — ${period.label}` : title;
  const incomeSlices = (): Slice[] => [
    { key: "Salary", amount: totals.salary, count: 0, share: 0 },
    { key: "Refunds", amount: totals.refunds, count: 0, share: 0 },
  ];

  switch (name) {
    case "get_overview":
      return {
        result: {
          accounts: facets.accounts,
          period: scope,
          statements_from: period?.from ?? (facets.first || null),
          statements_to: period?.to ?? (facets.last || null),
          salary_chf: chf(totals.salary),
          refunds_chf: chf(totals.refunds),
          total_income_chf: chf(totals.income),
          total_spending_chf: chf(totals.expense),
          net_saved_chf: chf(totals.net),
          payments: totals.expenseCount,
        },
      };
    case "get_spending_by_category":
      return {
        result: {
          period: scope,
          total_spending_chf: chf(totals.expense),
          categories: sliceRows(categories),
        },
        chart: toPie(titled("Spending by category"), categories),
      };
    case "get_top_merchants":
      return {
        result: { period: scope, merchants: sliceRows(merchants) },
        chart: toPie(titled("Top merchants by spending"), merchants),
      };
    case "get_income_breakdown":
      return {
        result: {
          period: scope,
          salary_chf: chf(totals.salary),
          refunds_chf: chf(totals.refunds),
          total_income_chf: chf(totals.income),
          note: "Refunds are merchant credits, not earnings.",
        },
        chart: toPie(titled("Where the money came from"), incomeSlices()),
      };
    case "get_monthly_series": {
      // The monthly series is computed from the unfiltered rows by design,
      // so the period window is applied here, on the month keys.
      const fromMonth = period?.from.slice(0, 7);
      const toMonth = period?.to.slice(0, 7);
      const months = monthly.filter(
        (m) =>
          (!fromMonth || m.month >= fromMonth) && (!toMonth || m.month <= toMonth),
      );
      return {
        result: {
          period: scope,
          months: months.map((m) => ({
            month: m.month,
            label: m.label,
            in_chf: chf(m.income),
            out_chf: chf(m.expense),
            net_chf: chf(m.net),
          })),
        },
      };
    }
    case "display_chart": {
      // The model chose presentation (source, size, title, window); every
      // number still comes from the aggregates it points at.
      const source = chartRequest?.source ?? "categories";
      const slices =
        source === "merchants"
          ? merchants
          : source === "income"
            ? incomeSlices()
            : categories;
      const defaultTitle =
        source === "merchants"
          ? "Top merchants by spending"
          : source === "income"
            ? "Where the money came from"
            : "Spending by category";
      const title = chartRequest?.title?.slice(0, 60).trim() || titled(defaultTitle);
      const topN = Math.min(8, Math.max(2, chartRequest?.topN ?? 5));
      const chart = toPie(title, slices, topN);
      return {
        result: chart
          ? {
              displayed: chart.title,
              period: scope,
              total_chf: chf(chart.totalMinor),
              slices: chart.slices.map((s) => ({
                name: s.label,
                amount_chf: chf(s.amountMinor),
                share_pct: Number(s.share.toFixed(1)),
              })),
            }
          : { error: `No ${source} data in this period — nothing to chart.` },
        chart,
      };
    }
    case "run_sql":
    case "display_echart":
      // Both need what a pure helper cannot hold — the SQL sandbox and the
      // parsed option — so the action loop handles them before calling here.
      return { result: { error: "Handled by the action loop." } };
  }
}

/**
 * Static guard for the SQL escape hatch, applied before the sandbox even
 * opens. Pure and here (not in the server-only sandbox module) so it is unit-
 * testable. The sandbox adds its own layers: the database is a throwaway
 * in-memory copy holding ONLY the current user's rows, and better-sqlite3
 * rejects multi-statement strings at prepare time.
 */
export function validateSelect(sql: string): string | undefined {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.length === 0) return "Empty SQL.";
  if (trimmed.length > 2000) return "SQL too long (max 2000 characters).";
  if (!/^select\b/i.test(trimmed)) {
    // WITH is disallowed outright: a CTE can be aliased into a cartesian
    // product or made recursive without the RECURSIVE keyword, both of which
    // dodge static bounds. Subqueries express the same analytics safely.
    return "Only a single SELECT statement is allowed (no WITH / CTEs).";
  }
  if (trimmed.includes(";")) return "Only one statement is allowed.";
  // Writes, DDL, and connection-level verbs.
  const bannedVerb =
    /\b(pragma|attach|detach|vacuum|insert|update|delete|drop|create|alter|replace|reindex|analyze|begin|commit|rollback|savepoint|release|load_extension)\b/i.exec(
      trimmed,
    );
  if (bannedVerb) return `"${bannedVerb[1]}" is not allowed here.`;
  // Row generators and blow-up scalars. `json_each`/`generate_series` are
  // unbounded FROM sources that dodge the transactions-reference count and
  // build a cartesian product; `printf`/`char`/`hex`/`zeroblob`/`randomblob`
  // produce arbitrarily large single cells. The worker timeout backstops any
  // of these, but rejecting them up front keeps the worker from ever firing.
  const bannedFn =
    /\b(json_each|json_tree|json_group_array|generate_series|printf|format|char|hex|unicode|quote|zeroblob|randomblob)\b/i.exec(
      trimmed,
    );
  if (bannedFn) return `"${bannedFn[1]}" is not allowed here.`;
  // Bounds the worst honest self-join at rows². Deeper cartesians are stopped
  // by the worker deadline, not here.
  const references = trimmed.match(/\btransactions\b/gi)?.length ?? 0;
  if (references > 2) return "Reference the transactions table at most twice.";
  if (references === 0) return "Query the transactions table.";
  return undefined;
}

/** The SQL string out of a run_sql call, surviving mangled surrounding JSON. */
export function extractSql(content: string): string | undefined {
  const args = extractJsonAfter(content, "run_sql");
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const sql = (args as Record<string, unknown>).sql;
    if (typeof sql === "string" && sql.trim()) return sql;
  }
  // The args object was mangled — fish the one string field out directly.
  const match = /"sql"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(content);
  if (match) {
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      // fall through to the prose scan
    }
  }
  // Last resort: the model wrote the statement as prose ("you would need to
  // query … SELECT … FROM transactions …") instead of calling the tool.
  // Writing the query IS asking for it — cut it out of the surrounding text.
  const at = content.search(/\b(select|with)\b/i);
  if (at < 0) return undefined;
  let candidate = content.slice(at);
  const semi = candidate.indexOf(";");
  if (semi >= 0) {
    candidate = candidate.slice(0, semi);
  } else {
    const paragraphBreak = candidate.search(/\n\s*\n/);
    if (paragraphBreak >= 0) candidate = candidate.slice(0, paragraphBreak);
  }
  candidate = candidate.replace(/```/g, "").trim();
  return /\bfrom\s+transactions\b/i.test(candidate) ? candidate : undefined;
}

/**
 * The first balanced JSON object after `marker`, or undefined. A real parser
 * rather than a regex because ECharts options nest arbitrarily deep; string-
 * aware so braces inside labels don't unbalance the scan.
 */
export function extractJsonAfter(content: string, marker: string): unknown {
  const at = content.indexOf(marker);
  if (at < 0) return undefined;
  const start = content.indexOf("{", at + marker.length);
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (escaped) {
      escaped = false;
    } else if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(content.slice(start, i + 1));
          // When the model narrates before the call ("I'll use display_echart
          // …") the anchor lands on the prose mention, so the first balanced
          // object is the wrapper `{ "<marker>": {…real args…} }`. Unwrap it:
          // tool args never legitimately contain a key named after the tool.
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const inner = (parsed as Record<string, unknown>)[marker];
            if (inner && typeof inner === "object" && !Array.isArray(inner)) {
              return inner;
            }
          }
          return parsed;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Depth cap for `sanitizeEChartsOption` — a JSON bomb is not a chart. */
const OPTION_MAX_DEPTH = 12;
const OPTION_MAX_BYTES = 20_000;

/**
 * A model-composed ECharts option, made safe to store and render: JSON only
 * (so no functions can exist), size- and depth-capped, and stripped of the
 * vectors that are not "a chart": `graphic` (free-form drawing, can embed
 * images), any `image` property (external fetches from the viewer's browser),
 * and `tooltip` (removed app-wide by design).
 */
export function sanitizeEChartsOption(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  if (JSON.stringify(raw).length > OPTION_MAX_BYTES) return undefined;

  const BANNED_KEYS = new Set(["graphic", "image", "tooltip", "toolbox"]);
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > OPTION_MAX_DEPTH) return undefined;
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    if (typeof node === "object" && node !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (BANNED_KEYS.has(key)) continue;
        const cleaned = walk(value, depth + 1);
        if (cleaned !== undefined) out[key] = cleaned;
      }
      return out;
    }
    if (typeof node === "string") {
      // ECharts loads `image://<url>` (and `path://`) symbols and rich-text
      // resources by fetching them from the VIEWER's browser — an SSRF /
      // tracking-beacon vector that the banned-keys pass alone misses, because
      // the url is a string *value* (on `symbol`, per-datum symbols, markPoint
      // symbols, …), not a banned key. Drop any such value.
      if (/^\s*(image|path):\/\//i.test(node)) return undefined;
      return node;
    }
    // JSON primitives only — anything else has no business in an option.
    return typeof node === "number" || typeof node === "boolean" || node === null
      ? node
      : undefined;
  };

  const option = walk(raw, 0) as Record<string, unknown>;
  return "series" in option ? option : undefined;
}

/**
 * The non-pie chart type a question explicitly asks for, if any. Requires an
 * actual chart word next to "bar"/"line" so "bottom line" and "coffee bar"
 * don't trigger, and yields to an explicit "pie".
 */
export function wantsNonPieChart(question: string): "bar" | "line" | undefined {
  const q = question.toLowerCase();
  if (/\bpie\b/.test(q)) return undefined;
  if (/\b(bar|column)s?[\s-]*(chart|graph|plot|diagram)/.test(q) || /\bas\s+(a\s+)?(bar|column)s?\b/.test(q)) {
    return "bar";
  }
  if (/\bline[\s-]*(chart|graph|plot|diagram)/.test(q) || /\bas\s+(a\s+)?line\b/.test(q)) {
    return "line";
  }
  return undefined;
}

/**
 * The guarantee behind display_echart: when the user names a bar or line
 * chart and the model never composed one, the server does — from the same
 * real aggregates everything else draws on. Subject follows the question:
 * merchants and categories become ranked bars, everything else becomes the
 * monthly in/out series.
 */
export function composeEChart(
  type: "bar" | "line",
  question: string,
  dashboard: Dashboard,
  period?: Period,
): EChartsChartSpec | undefined {
  const q = question.toLowerCase();
  const francs = (minor: number) => Number((minor / 100).toFixed(2));
  const suffix = period ? ` — ${period.label}` : "";

  const ranked = /\b(merchant|shop|store|retailer|vendor)s?\b/.test(q)
    ? { title: "Top merchants", slices: dashboard.merchants }
    : /\bcategor(y|ies)\b/.test(q)
      ? { title: "Spending by category", slices: dashboard.categories }
      : undefined;

  if (ranked) {
    const top = ranked.slices.filter((s) => s.amount > 0).slice(0, 8);
    if (top.length === 0) return undefined;
    return {
      kind: "echarts",
      title: `${ranked.title} (CHF)${suffix}`,
      option: {
        grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
        xAxis: { type: "value" },
        yAxis: {
          type: "category",
          // Reversed so the biggest bar sits on top.
          data: top.map((s) => s.key).reverse(),
        },
        series: [
          { type: "bar", data: top.map((s) => francs(s.amount)).reverse() },
        ],
      },
    };
  }

  const fromMonth = period?.from.slice(0, 7);
  const toMonth = period?.to.slice(0, 7);
  const months = dashboard.monthly.filter(
    (m) => (!fromMonth || m.month >= fromMonth) && (!toMonth || m.month <= toMonth),
  );
  if (months.length === 0) return undefined;
  return {
    kind: "echarts",
    title: `Money in and out per month (CHF)${suffix}`,
    option: {
      legend: { bottom: 0 },
      grid: { left: 8, right: 16, top: 12, bottom: 32, containLabel: true },
      xAxis: { type: "category", data: months.map((m) => m.label) },
      yAxis: { type: "value" },
      series: [
        { name: "Out", type, data: months.map((m) => francs(m.expense)) },
        { name: "In", type, data: months.map((m) => francs(m.income)) },
      ],
    },
  };
}

/**
 * Which tools the model asked for. Scans for known names instead of parsing:
 * the emitted JSON is often malformed (`[{"get_overview": }]`, truncation at
 * a stop token), and the model sometimes writes prose *about* the call
 * ("Let me call get_spending_by_category.") without any call syntax at all.
 * In a round where tools are on offer, naming one is asking for it — the
 * round cap keeps a chatty final answer from looping the conversation.
 */
export function parseToolCalls(content: string): ToolName[] {
  return TOOL_NAMES.filter((name) => content.includes(name));
}

/** A resolved, inclusive date window over the statements. */
export type Period = {
  from: string;
  to: string;
  /** Human wording, echoed into tool results, chart titles, and the log. */
  label: string;
};

/**
 * The period string the model passed, fished out with a regex for the same
 * reason tool names are: the argument JSON is often mangled.
 */
export function parsePeriod(content: string): string | undefined {
  const match = /["']?period["']?\s*[:=]\s*["']?([\w.-]+)["']?/i.exec(content);
  return match?.[1]?.toLowerCase();
}

/**
 * The presentation choices in a display_chart call, fished out one regex per
 * field so a mangled argument object still yields whatever it did contain.
 */
export function parseChartRequest(content: string): ChartRequest {
  const sourceMatch =
    /["']?source["']?\s*[:=]\s*["']?(categor\w*|merchant\w*|income|spend\w*)/i.exec(content);
  const raw = sourceMatch?.[1]?.toLowerCase();
  const source: ChartSource | undefined =
    raw?.startsWith("categor") || raw?.startsWith("spend")
      ? "categories"
      : raw?.startsWith("merchant")
        ? "merchants"
        : raw === "income"
          ? "income"
          : undefined;

  const topMatch = /["']?top_?n["']?\s*[:=]\s*["']?(\d{1,2})/i.exec(content);
  const titleMatch = /["']?title["']?\s*[:=]\s*["']([^"'\n]{1,80})["']/i.exec(content);

  return {
    source,
    topN: topMatch ? Number(topMatch[1]) : undefined,
    title: titleMatch?.[1]?.trim(),
  };
}

/** Where a chart should come from when the model named no source. */
export function defaultChartSource(question: string): ChartSource {
  const q = question.toLowerCase();
  if (/\b(merchant|shop|store|retailer|vendor)s?\b/.test(q)) return "merchants";
  if (/\b(income|earn(ed|ings)?|salary|refunds?)\b/.test(q)) return "income";
  return "categories";
}

const MONTH_NUMBERS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

/**
 * A period the *question* names, for the turns where the model calls a tool
 * without passing one (or stalls and gets routed). "spending in march ytd"
 * style phrasings resolve like a model-passed argument would.
 */
export function periodFromQuestion(question: string): string | undefined {
  const q = question.toLowerCase();
  if (/\bytd\b|year[- ]to[- ]date/.test(q)) return "ytd";
  const lastN = /\blast (\d{1,2}) months\b/.exec(q);
  if (lastN) return `last_${lastN[1]}_months`;
  if (/\blast month\b/.test(q)) return "last_month";
  const month = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+(\d{4}))?/.exec(q);
  if (month) return month[2] ? `${month[2]}-${MONTH_NUMBERS[month[1]]}` : month[1];
  const year = /\bin (\d{4})\b/.exec(q);
  if (year) return year[1];
  return undefined;
}

/** "2025-03" minus 2 → "2025-01". String arithmetic, like `lib/insights.ts`. */
function monthsBack(month: string, count: number): string {
  let [year, index] = month.split("-").map(Number);
  index -= count;
  while (index < 1) {
    index += 12;
    year -= 1;
  }
  return `${year}-${String(index).padStart(2, "0")}`;
}

/**
 * Turn a period string into an inclusive date window. Relative periods (ytd,
 * last_month, …) anchor to the NEWEST STATEMENT date, not the wall clock —
 * against a 2025 export, a wall-clock "ytd" in 2026 would be an empty window.
 * Month windows end on day 31: dates compare lexically, so an impossible
 * "2025-02-31" is still a correct inclusive upper bound.
 */
export function resolvePeriod(
  raw: string | undefined,
  lastStatement: string,
): Period | undefined {
  if (!raw || !lastStatement) return undefined;
  const value = raw.toLowerCase().trim();
  const anchorYear = lastStatement.slice(0, 4);
  const anchorMonth = lastStatement.slice(0, 7);

  if (value === "ytd" || value === "year_to_date") {
    return {
      from: `${anchorYear}-01-01`,
      to: lastStatement,
      label: `year to date (${anchorYear}-01-01 to ${lastStatement})`,
    };
  }
  if (value === "last_month") {
    const month = monthsBack(anchorMonth, 1);
    return { from: `${month}-01`, to: `${month}-31`, label: month };
  }
  const lastN = /^last_(\d{1,2})_months$/.exec(value);
  if (lastN) {
    const from = `${monthsBack(anchorMonth, Number(lastN[1]) - 1)}-01`;
    return {
      from,
      to: lastStatement,
      label: `last ${lastN[1]} months (${from} to ${lastStatement})`,
    };
  }
  if (MONTH_NUMBERS[value]) {
    const month = `${anchorYear}-${MONTH_NUMBERS[value]}`;
    return { from: `${month}-01`, to: `${month}-31`, label: month };
  }
  if (/^\d{4}$/.test(value)) {
    return { from: `${value}-01-01`, to: `${value}-12-31`, label: value };
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    return { from: `${value}-01`, to: `${value}-31`, label: value };
  }
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (range) {
    return { from: range[1], to: range[2], label: `${range[1]} to ${range[2]}` };
  }
  return undefined;
}

/**
 * True when a round produced neither a tool call nor an answer — the model
 * talking *about* fetching ("Let me call the relevant tool…") or replying to
 * a finance question with no figure at all. Only consulted when no tool name
 * was found; whether anything is injected is `routeTool`'s call.
 */
export function looksLikeStall(content: string): boolean {
  // A real figure, not the `amount_chf` column name showing up in SQL prose.
  if (/CHF\s?\d/i.test(content)) return false;
  // Promising to do something is not doing it. Match the intent verbs plainly,
  // but "sql"/"query"/"generate" ONLY inside a planning phrase — otherwise a
  // genuine caption ("The query returned 42 transactions") is misread as a
  // stall and the real answer is thrown away.
  if (/\b(i'?ll|i will|let me|i need to|one moment|hold on|fetching|retrieving|getting)\b/i.test(content)) {
    return true;
  }
  if (/\b(i'?ll|i will|let me|i need to|first|going to|about to)\b[^.\n]{0,60}\b(generate|sql|quer(y|ies)|fetch|run)\b/i.test(content)) {
    return true;
  }
  return /\b(tools?|fetch|call|retriev|look up)\b/i.test(content) || !/\d/.test(content);
}

/**
 * Deterministic question → tool routing, the fallback when the model stalls.
 * Mirrors the tool descriptions; returns nothing for small talk, which lets
 * the model's own words stand as the reply.
 */
export function routeTool(question: string): ToolName | undefined {
  const q = question.toLowerCase();
  // Row-level questions no aggregate tool can answer route to the SQL escape
  // hatch. "largest/biggest/smallest" only when NOT paired with a subject the
  // dedicated tools answer better (and with a chart) — "largest single
  // expense" → SQL, but "biggest spending category" → the category tool.
  const rowLevel =
    /\b(single|exact(ly)?|which day|what day|when did|how many|how often|count)\b/.test(q) ||
    (/\b(largest|biggest|smallest|highest|lowest)\b/.test(q) &&
      !/\b(categor(y|ies)|merchant|shop|store|retailer|vendor|income|salary|refunds?|month)s?\b/.test(q));
  if (rowLevel) {
    return "run_sql";
  }
  // An explicit ask for a chart routes to the chart tool itself — the
  // caller fills the source from `defaultChartSource`.
  if (/\b(pie|charts?|graphs?|diagrams?|visuali[sz]e)\b/.test(q)) {
    return "display_chart";
  }
  if (/\b(merchant|shop|store|retailer|vendor)s?\b/.test(q)) {
    return "get_top_merchants";
  }
  if (/\b(income|earn(ed|ings)?|salary|refunds?)\b/.test(q)) {
    return "get_income_breakdown";
  }
  if (/\b(month(ly)?|cheapest|expensive|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/.test(q)) {
    return "get_monthly_series";
  }
  // "total" and "overview" deliberately fall through to the category tool:
  // those questions can be answered with a chart, and charts are preferred.
  if (/\b(save[d]?|savings|net|balance|how much money)\b/.test(q)) {
    return "get_overview";
  }
  if (
    /\b(categor(y|ies)|breakdown|distribution|split|share|pie|chart|graph|spend(ing)?|expenses?|allocat|overview|total|finances?|money)\b/.test(q) ||
    /where .*(go|goes|going|spent?)/.test(q)
  ) {
    return "get_spending_by_category";
  }
  return undefined;
}

/** Drop Apertus special tokens and any tool-call block from a visible reply. */
export function stripModelMarkup(content: string): string {
  return content
    .split("<|tools_prefix|>")[0]
    .replace(/<\|[^|>]*\|>/g, "")
    .trim();
}

/**
 * Normalize the amounts in a visible reply to Swiss grouping — the model is
 * told to copy the tools' "22'200.00" format but re-groups with commas often
 * enough that the guarantee has to live here. Comma groups anywhere in a
 * number become apostrophes; bare digit runs are only regrouped right after
 * "CHF", where a year can't appear.
 */
export function formatSwissNumbers(text: string): string {
  return text
    .replace(/(?<=\d),(?=\d{3}\b)/g, "'")
    .replace(/CHF\s?(\d[\d']*)(\.\d+)?/g, (_match, units: string, cents?: string) => {
      const grouped = units
        .replace(/'/g, "")
        .replace(/\B(?=(\d{3})+(?!\d))/g, "'");
      return `CHF ${grouped}${cents ?? ""}`;
    });
}

/** Tolerates the JSON-flavoured spelling too: `[{"FOLLOWUP": "…"}]`. */
const FOLLOWUP_MARKER = /[[{"']*\s*FOLLOW[\s-]?UPS?["']?\s*:/i;

/** Strip bullet/number/quote/JSON wrapping from a proposed question. */
function cleanFollowUp(line: string): string {
  return line
    .replace(/^[\s\-*\d.)"'[{]+/, "")
    .replace(/[\s"'\]}),]+$/, "")
    .trim();
}

/**
 * Pull the model's proposed follow-up questions out of its answer. The
 * system prompt asks for one `FOLLOWUP: …` line each, but a small model also
 * packs several onto one line ("…? FOLLOWUP: …?") or writes a bare
 * `FOLLOWUPS:` header with a list under it — so lines are split on the
 * marker, and after one, question-shaped lines are consumed too. Everything
 * matched is removed from the visible reply.
 */
export function extractFollowUps(text: string): {
  text: string;
  followUps: string[];
} {
  const followUps: string[] = [];
  const kept: string[] = [];
  let collecting = false;

  for (const line of text.split("\n")) {
    const parts = line.split(FOLLOWUP_MARKER);
    if (parts.length > 1) {
      collecting = true;
      if (parts[0].trim()) kept.push(parts[0].trimEnd());
      for (const part of parts.slice(1)) {
        const question = cleanFollowUp(part);
        if (question) followUps.push(question);
      }
      continue;
    }
    if (collecting) {
      const question = cleanFollowUp(line);
      if (question && question.endsWith("?")) {
        followUps.push(question);
        continue;
      }
      collecting = false;
    }
    kept.push(line);
  }

  return { text: kept.join("\n").trim(), followUps: followUps.slice(0, 3) };
}

/**
 * Follow-up inspiration for the chips above the input. Deterministic, like
 * the chart: candidates are phrased from the account's real aggregates
 * (top category, top merchant, priciest month), ordered so the ones that
 * change topic relative to the current question come first, and anything
 * already asked in this conversation is dropped.
 */
export function suggestFollowUps(
  question: string,
  dashboard: Dashboard,
  asked: string[],
): string[] {
  const q = question.toLowerCase();
  const topCategory = dashboard.categories[0]?.key;
  const topMerchant = dashboard.merchants[0]?.key;
  const priciest = dashboard.monthly.reduce(
    (max, month) => (max === null || month.expense > max.expense ? month : max),
    null as Dashboard["monthly"][number] | null,
  );

  const candidates: string[] = [];
  if (/\b(merchant|shop|store|retailer|vendor)s?\b/.test(q)) {
    if (topMerchant) candidates.push(`How much did I spend at ${topMerchant}?`);
    candidates.push("Where does my money go by category YTD?");
  } else if (/\b(income|earn(ed|ings)?|salary|refunds?)\b/.test(q)) {
    candidates.push("How much of my income did I spend?");
    candidates.push("Where does my money go YTD?");
  } else {
    if (topCategory) candidates.push(`Why is ${topCategory} so high?`);
    candidates.push("Who are my top merchants YTD?");
  }
  if (priciest && priciest.expense > 0) {
    candidates.push(`What happened in ${priciest.label}?`);
  }
  candidates.push(
    "How much did I save this year?",
    "Which month was my cheapest?",
  );

  const seen = new Set(asked.concat(question).map((s) => s.toLowerCase()));
  const fresh: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(candidate);
    if (fresh.length === 3) break;
  }
  return fresh;
}
