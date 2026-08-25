/**
 * Pure helpers for the chat assistant. No database, no `server-only`: the
 * server action hands a `Dashboard` in, and the client sidebar imports only
 * the types. Every import below is type-only for the same reason
 * `lib/insights.ts` gives — a value import would drag drizzle into the client
 * bundle, and only `npm run build` would catch it.
 *
 * The model sees no figures up front. It gets a toolbox: the system prompt
 * describes what can be fetched, the model asks, `runTool` answers from the
 * real aggregates, and the pie chart is formed from the same data the model
 * requested.
 *
 * Tool calls arrive as text, and the parsing lives here. Gemini returns them
 * as structured `functionCall` parts, which `lib/llm/gemini.ts` writes back
 * out as `{"<tool name>": {…args…}}` — the shape these parsers were written
 * for when the endpoint was an 8B model that emitted its calls into the
 * content and nothing ever populated `tool_calls`. Keeping the seam there
 * rather than here is what lets every tolerant path below stay in place as a
 * net: a model that narrates its call, or writes a SELECT as prose, is still
 * understood.
 */
import type { AnomalyGroup, AnomalyOverview } from "@/app/actions/anomalies";
import type { SavingsOverview } from "@/app/actions/savings";
import type { Dashboard } from "@/app/actions/transactions";
import type { Transaction } from "@/db/schema";
import type { Slice } from "@/lib/insights";

export type ChatRole = "user" | "assistant";

/**
 * The `Chat` namespace keys of the starter proposals — the one-tap chips the
 * empty state shows. Shared, not duplicated: the panel renders them on start,
 * and the action re-offers the same questions as follow-up chips on turns
 * where the model proposed none, so both readers stay in lockstep when a
 * proposal is reworded or added.
 *
 * Four of the five are **happy paths** — `matchHappyPath` recognizes them and
 * the app answers from its own aggregates, so the chips a first-time reader
 * taps cannot fail. The exception is `suggestion4`: allocating a surplus ends
 * in an Apply card built by `propose_allocation`, which is a validated action
 * rather than a summary, and that belongs on the tool loop.
 */
export const SUGGESTION_KEYS = [
  "suggestion1",
  "suggestion2",
  "suggestion3",
  "suggestion4",
  "suggestion5",
] as const;

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

/**
 * A pie the app assembled from its own aggregates. The model chose only what
 * it is about; every figure in it came out of the same read that answered the
 * tool call, which is what makes the chart and the caption agree by
 * construction.
 */
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

/**
 * A validated split of a month's free surplus, awaiting the user's Apply tap.
 * Built by `buildAllocationProposal` from a propose_allocation call — never
 * from model prose — so every figure the card shows already survived the
 * server's clamping. The items are ADDS, not month totals: Apply posts them
 * through `applyAllocationAdds`, which resolves each goal's current month
 * total at apply time — a proposal frozen as absolute totals would silently
 * revert any allocation made between propose and Apply.
 */
export type AllocationProposal = {
  month: string;
  /** The card's rows: each receiving goal and what would be added to it. */
  items: { goalId: number; name: string; addMinor: number }[];
  addTotalMinor: number;
};

export type AssistantTurn = {
  reply: string;
  /** The chart shown under the reply, when the turn produced one. */
  chart?: ChartSpec;
  /** A surplus split awaiting the user's Apply tap, rendered as a card. */
  proposal?: AllocationProposal;
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
  'Every tool accepts an optional period argument for time-scoped questions, e.g. [{"get_spending_by_category": {"period": "ytd"}}]. Accepted values: ytd, a year like 2025, a month like 2025-03, a range like 2025-01-01..2025-03-31, last_month, or last_3_months. When you omit it the app scopes to the current year (year-to-date) by default; pass an explicit range, or the user must say "all time", for the full history.',
  "Be concise: 2–3 short sentences, plain text, no markdown, no lists.",
  "All amounts are Swiss francs. Write them exactly as the tools format them, e.g. CHF 1'234.55 — apostrophe as thousands separator, two decimals.",
  "Name only the figures that answer the question — the biggest item and the takeaway — rather than listing everything a tool returned.",
  "When the tools cannot answer — a specific transaction, a day of week, a count, a comparison they don't cover — call run_sql with one SQLite SELECT over the transactions table; the schema is in the tool description.",
  "Four tools carry the advice questions: get_savings_potential for where the customer could save (advise only on its flexible categories — fixed costs like housing, insurance and taxes cannot be cut); get_recent_anomalies for anything suspicious or unusual (stay calm — most findings are the customer's own legitimate spending); get_subscriptions for recurring subscriptions; get_savings_goals for the saving goals and a month's unallocated surplus.",
  "To allocate a month's surplus: call get_savings_goals first, then propose_allocation with one amount per goal from the free amount. The app validates the split and shows it to the customer with an Apply button; caption the final split the tool returns and invite the tap. Only that tap moves money — never claim it already moved.",
  'You can show one chart per answer. When the question is about how money splits or how it moves — spending by category, top merchants, income, a trend over months — call display_chart with a source, e.g. [{"display_chart": {"source": "categories", "period": "ytd"}}]. The app assembles the pie from the customer\'s real data and hands you the same figures back for your caption. Skip the chart for a single specific number, a date, a yes/no answer, and for the advice questions below — a pie under "is anything suspicious" helps nobody.',
  'For a visual a pie cannot carry — bars over months, a line, a scatter — call display_echart with a complete Apache ECharts option as a JSON string, built only from figures you already fetched with the tools or run_sql. When the user names a chart type that is not a pie, display_echart is the only right tool.',
  "When a chart is shown, your text is its caption: one or two sentences naming the biggest item and the takeaway. Never describe the chart's shape and never list figures it already shows.",
  "After your answer, propose 2 or 3 short follow-up questions the user could ask next, each on its own line starting with FOLLOWUP: — nothing else on those lines.",
].join("\n");

/**
 * The reply has to come back in the language the dashboard is being read in.
 * Everything else on the page is translated, and an English paragraph in the
 * middle of a German page is the one bit of the app that would still look
 * untranslated — so the locale is appended to the system prompt per turn rather
 * than baked into it.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  de: "German",
  en: "English",
};

/**
 * The model-facing name of a locale, or nothing for one we have no word for.
 * Exported because `lib/happy-path.ts` has to name the reply's language in
 * its own prompt, and two spellings of "German" is one too many.
 */
export function languageName(locale: string): string | undefined {
  return LANGUAGE_NAMES[locale];
}

export function systemPromptFor(locale: string): string {
  const language = languageName(locale);
  if (!language) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\nAnswer in ${language}, including matching FOLLOWUP lines. The followups should be relevant to the user's question and from the user's perspective. They should be short and listed as array under FOLLOWUP. The followups should either be questions about the users financial data or match a toolcall available to you. If you don't have a matching followup leave it empty. Keep the amounts formatted exactly as the tools return them.`;
}

export const TOOL_NAMES = [
  "get_overview",
  "get_spending_by_category",
  "get_top_merchants",
  "get_income_breakdown",
  "get_monthly_series",
  "get_savings_potential",
  "get_subscriptions",
  "get_recent_anomalies",
  "get_savings_goals",
  "propose_allocation",
  "run_sql",
  "display_chart",
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

/** For the tools that take nothing — anomalies and subscriptions read the
 * account whole, so a period argument would only invite a mangled one.
 * `toFunctionDeclarations` drops the empty schema entirely: Gemini rejects an
 * object with no properties. */
const EMPTY_PARAMETERS = {
  type: "object" as const,
  properties: {},
};

/**
 * The pie tool's own schema: the shared period plus presentation choices.
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
      "Accounts, statement date range, and the year's totals: salary, refunds, total income, total spending, net saved.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_spending_by_category",
    description:
      "Spending broken down by category, largest first.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_top_merchants",
    description:
      "The merchants the customer spent the most at.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_income_breakdown",
    description:
      "Where the incoming money came from: salary versus merchant refunds.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_monthly_series",
    description: "Money in and money out for every month.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_savings_potential",
    description:
      "Where the customer could realistically save. Returns the month's unassigned money (income minus spending minus what is already in savings goals — the same figure the app's Unallocated pot shows, negative when the month overspent) plus spending split into fixed costs (housing, insurance, taxes — not cuttable) and the flexible categories, ranked. The right tool for any 'where/how much could I save' question.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "get_subscriptions",
    description:
      "The customer's recurring subscriptions, detected across the whole statement history — same merchant, steady amount, regular weekly/monthly/quarterly/yearly rhythm — each with its cost per year. Contractual fixed costs (rent, insurance, taxes) are excluded.",
    parameters: EMPTY_PARAMETERS,
  },
  {
    name: "get_recent_anomalies",
    description:
      "The findings of the customer's latest anomaly scan — unusual charges, spikes, new counterparties — grouped by kind, with severity and how recent. The right tool for 'is anything shady or suspicious going on' questions.",
    parameters: EMPTY_PARAMETERS,
  },
  {
    name: "get_savings_goals",
    description:
      "The customer's saving goals (target, saved so far, still missing) plus a month's surplus and how much of it is still free to put into the goals. Defaults to the last completed month; pass a month period for another one.",
    parameters: PERIOD_PARAMETERS,
  },
  {
    name: "propose_allocation",
    description:
      "Propose splitting a month's free surplus across the saving goals. Call get_savings_goals first, then pass one amount per goal, in francs, summing to at most the free amount. The app validates the split, shows it to the customer with an Apply button, and returns the final registered split — caption from that. Only the customer's tap moves the money.",
    parameters: {
      type: "object" as const,
      properties: {
        allocations: {
          type: "array" as const,
          description: "One entry per goal that should receive money.",
          items: {
            type: "object" as const,
            properties: {
              goal: {
                type: "string" as const,
                description:
                  "The goal's name, exactly as get_savings_goals returned it.",
              },
              amount_chf: {
                type: "number" as const,
                description: "Francs to add to this goal from the free surplus.",
              },
            },
            required: ["goal", "amount_chf"],
          },
        },
        ...PERIOD_PARAMETERS.properties,
      },
      required: ["allocations"],
    },
  },
  {
    name: "run_sql",
    description: [
      "Escape hatch when the other tools cannot answer: run one read-only SQLite SELECT over the customer's transactions.",
      "Table: transactions(booked_on TEXT 'YYYY-MM-DD', kind TEXT in ('income','expense'), amount_chf REAL signed francs (income positive, spending negative), amount_minor INTEGER signed rappen, account TEXT, merchant TEXT, category TEXT, description TEXT, currency TEXT). Internal transfers between the customer's own accounts are already excluded, matching every other figure in the app.",
      "The table holds ONLY rows inside the resolved period scope (year-to-date by default). A WHERE on booked_on can narrow further but can never reach outside that scope — to query a different or wider window, pass the period argument.",
      "One SELECT statement (no CTEs / WITH), no writes, reference the table at most twice. At most 40 result rows come back, so aggregate in SQL.",
      "Remember spending is negative: the largest expense is MIN(amount_chf) / ORDER BY amount_chf ASC, and filter kind='expense' for spending, kind='income' for income.",
      'Example: {"run_sql": {"sql": "SELECT merchant, ROUND(SUM(-amount_chf), 2) AS spent FROM transactions WHERE kind=\'expense\' GROUP BY merchant ORDER BY spent DESC LIMIT 5", "period": "2025"}}',
    ].join(" "),
    parameters: {
      type: "object" as const,
      properties: {
        sql: {
          type: "string" as const,
          description: "A single SQLite SELECT statement.",
        },
        ...PERIOD_PARAMETERS.properties,
      },
      required: ["sql"],
    },
  },
  {
    name: "display_chart",
    description:
      "Show the customer a pie chart assembled by the app from their real statements, and get the same figures back for your caption. The right tool for a question about how spending, merchants or income split up. Pies only — for a bar, line, or any other shape, use display_echart.",
    parameters: CHART_PARAMETERS,
  },
  {
    name: "display_echart",
    description: [
      "Show any Apache ECharts chart (bar, line, scatter, heatmap, radar, …) by providing the full ECharts option as a JSON string — no functions, no callbacks.",
      "Only for visuals display_chart's pies cannot express. Build every data array from figures you fetched with the other tools or run_sql — never invent numbers. Keep the option compact.",
      'Example: {"display_echart": {"title": "Spending per month", "option": "{\\"xAxis\\": {\\"type\\": \\"category\\", \\"data\\": [\\"Jan\\", \\"Feb\\"]}, \\"yAxis\\": {\\"type\\": \\"value\\"}, \\"series\\": [{\\"type\\": \\"bar\\", \\"data\\": [6250.30, 5890.10]}]}"}}',
    ].join(" "),
    parameters: {
      type: "object" as const,
      properties: {
        title: {
          type: "string" as const,
          description: "Short title shown above the chart.",
        },
        option: {
          // A string rather than an object: a function declaration's schema
          // cannot express a free-form object (Gemini wants every property
          // named), and the loop parses this back before sanitizing it.
          type: "string" as const,
          description:
            "The complete ECharts option as a JSON string. Must contain a series array.",
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
 * Categories where a "spend less" tip is noise: the amounts are contractual —
 * rent, premiums, taxes — so the savings-potential tool reports them as one
 * lump and ranks only the rest. Spelled as the importer assigns them;
 * `scripts/lib/statement.ts` is the source of that spelling.
 */
export const FIXED_EXPENSE_CATEGORIES = new Set([
  "Housing",
  "Health & Insurance",
  "Taxes & Fees",
]);

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
    case "get_savings_potential":
    case "get_subscriptions":
    case "get_recent_anomalies":
    case "get_savings_goals":
    case "propose_allocation":
      // All need what a pure helper cannot hold — the SQL sandbox, the parsed
      // ECharts option, or a database read of their own — so the action loop
      // handles them before calling here.
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
  // A handful of candidate regions, not one: prose pseudo-JSON ("{series:
  // [1]}") or a format echo with a literal ellipsis often sits between the
  // marker and the real arguments, and giving up on the first unparseable
  // balanced region would throw the real call away with it.
  let from = at + marker.length;
  for (let attempt = 0; attempt < 5; attempt++) {
    const start = content.indexOf("{", from);
    if (start < 0) return undefined;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
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
          end = i;
          break;
        }
      }
    }
    // Unclosed (a stray prose brace swallowed the rest): step inside it —
    // the next `{` may open a region that does balance.
    if (end < 0) {
      from = start + 1;
      continue;
    }
    try {
      const parsed = JSON.parse(content.slice(start, end + 1));
      // When the model narrates before the call ("I'll use propose_allocation
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
      from = start + 1;
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
 *
 * Takes the option as parsed JSON or as the JSON string the tool declares —
 * `display_echart`'s argument is a string, because a function declaration's
 * schema cannot describe a free-form object.
 */
export function sanitizeEChartsOption(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (typeof raw === "string") {
    try {
      return sanitizeEChartsOption(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
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
 * The presentation choices out of a display_chart call. A regex sweep rather
 * than a JSON parse, for the same reason `parsePeriod` is one: this has to
 * read a call the model narrated as well as one it made properly, and every
 * field here is optional with a sane default behind it.
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

/** What a chart is about when the model asked for one without saying. */
export function defaultChartSource(question: string): ChartSource {
  const q = question.toLowerCase();
  if (/\b(merchant|shop|store|retailer|vendor)s?\b/.test(q)) return "merchants";
  if (/\b(income|earn(ed|ings)?|salary|refunds?)\b/.test(q)) return "income";
  return "categories";
}

/** The aggregate tool behind a chart source, for the server-side fallback. */
export function chartToolForSource(source: ChartSource): ToolName {
  return source === "merchants"
    ? "get_top_merchants"
    : source === "income"
      ? "get_income_breakdown"
      : "get_spending_by_category";
}

/**
 * True for a question a pie answers better than a paragraph — the safety net
 * for a turn where the model fetched chartable data and then forgot to ask for
 * the chart. Deliberately narrow: it follows `routeTool`, so the advice
 * questions (savings potential, anomalies, subscriptions, goals) never pull a
 * pie in behind the model's back.
 */
export function shouldDefaultChart(question: string): boolean {
  const routed = routeTool(question);
  return (
    routed === "display_chart" ||
    routed === "get_spending_by_category" ||
    routed === "get_top_merchants" ||
    routed === "get_income_breakdown"
  );
}

/**
 * The non-pie chart type a question explicitly asks for, if any. Requires an
 * actual chart word next to "bar"/"line" so "bottom line" and "coffee bar"
 * don't trigger, and yields to an explicit "pie".
 */
export function wantsNonPieChart(question: string): "bar" | "line" | undefined {
  const q = question.toLowerCase();
  if (/\bpie\b|\bkuchen\w*|\bkreisdiagramm\w*/.test(q)) return undefined;
  if (
    /\b(bar|column|balken|säulen)\w*[\s-]*(chart|graph|plot|diagram|diagramm)/.test(q) ||
    /\bas\s+(a\s+)?(bar|column)s?\b/.test(q) ||
    /\bals\s+(balken|säulen)\w*/.test(q)
  ) {
    return "bar";
  }
  if (
    /\b(line|linien)\w*[\s-]*(chart|graph|plot|diagram|diagramm)/.test(q) ||
    /\bas\s+(a\s+)?line\b/.test(q) ||
    /\bals\s+linie\b/.test(q)
  ) {
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

/** One detected recurring charge. */
export type Subscription = {
  merchant: string;
  category: string;
  cadence: "weekly" | "monthly" | "quarterly" | "yearly";
  payments: number;
  /** The median charge, minor units. */
  typicalMinor: number;
  lastOn: string;
  /** Median charge × cycles per year — what keeping it costs annually. */
  yearlyMinor: number;
};

/** Day-gap windows a rhythm may drift inside and still count as one. */
const CADENCES = [
  { cadence: "weekly", min: 5, max: 9, perYear: 52 },
  { cadence: "monthly", min: 24, max: 38, perYear: 12 },
  { cadence: "quarterly", min: 76, max: 104, perYear: 4 },
  { cadence: "yearly", min: 330, max: 400, perYear: 1 },
] as const;

/** "YYYY-MM-DD" → whole days since the epoch. Via `Date.UTC` on the parsed
 * parts, so no timezone can shift the day the way `new Date(string)` might. */
function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Recurring charges, straight from the rows: a merchant billing a steady
 * amount on a steady rhythm. Both tests are two-thirds majority votes — gaps
 * inside the cadence window, amounts within 25% of the median — so one skipped
 * month or one price change does not hide a real subscription, while a grocery
 * habit (weekly-ish, never the same amount) stays out. Wants the account's
 * whole history: a year-to-date window would demote every yearly bill.
 *
 * The fixed-cost categories are excluded up front: rent and health premiums
 * are the most regular charges an account has, and a "your subscriptions"
 * list led by Rent answers a question nobody asked — those amounts already
 * appear as the fixed lump in `get_savings_potential`.
 */
export function detectSubscriptions(rows: Transaction[]): Subscription[] {
  const byMerchant = new Map<
    string,
    { days: number[]; amounts: number[]; lastOn: string; category: string }
  >();
  for (const row of rows) {
    if (row.kind !== "expense") continue;
    if (FIXED_EXPENSE_CATEGORIES.has(row.category)) continue;
    let group = byMerchant.get(row.merchant);
    if (!group) {
      group = { days: [], amounts: [], lastOn: row.bookedOn, category: row.category };
      byMerchant.set(row.merchant, group);
    }
    group.days.push(dayNumber(row.bookedOn));
    group.amounts.push(Math.abs(row.amountMinor));
    if (row.bookedOn > group.lastOn) group.lastOn = row.bookedOn;
  }

  const found: Subscription[] = [];
  for (const [merchant, group] of byMerchant) {
    // Same-day pairs would put zero-length gaps under the median; the rhythm
    // is read from one charge per day.
    const days = [...new Set(group.days)].sort((a, b) => a - b);
    if (days.length < 2) continue;
    const gaps = days.slice(1).map((day, i) => day - days[i]);
    const gap = median(gaps);
    const match = CADENCES.find((c) => gap >= c.min && gap <= c.max);
    if (!match) continue;
    // Two charges a year apart are a real yearly signal; anything faster
    // needs a third before "twice" reads as "regularly".
    if (match.cadence !== "yearly" && days.length < 3) continue;
    const regular = gaps.filter((g) => g >= match.min && g <= match.max).length;
    if (regular < Math.ceil(gaps.length * (2 / 3))) continue;
    const typical = median(group.amounts);
    const stable = group.amounts.filter(
      (amount) => Math.abs(amount - typical) <= typical * 0.25,
    ).length;
    if (stable < Math.ceil(group.amounts.length * (2 / 3))) continue;
    found.push({
      merchant,
      category: group.category,
      cadence: match.cadence,
      payments: group.amounts.length,
      typicalMinor: Math.round(typical),
      lastOn: group.lastOn,
      yearlyMinor: Math.round(typical * match.perYear),
    });
  }
  return found.sort((a, b) => b.yearlyMinor - a.yearlyMinor).slice(0, 15);
}

/** The get_subscriptions payload the model reads. */
export function subscriptionsToolResult(rows: Transaction[]): unknown {
  const subscriptions = detectSubscriptions(rows);
  if (subscriptions.length === 0) {
    return {
      subscriptions: [],
      note: "No recurring charges found — no merchant bills a steady amount on a steady rhythm in these statements.",
    };
  }
  return {
    scope: "whole statement history",
    note: "Contractual fixed costs (rent, insurance, taxes) are not listed here even when they recur.",
    total_per_year_chf: chf(
      subscriptions.reduce((sum, s) => sum + s.yearlyMinor, 0),
    ),
    subscriptions: subscriptions.map((s) => ({
      merchant: s.merchant,
      category: s.category,
      billing: s.cadence,
      typical_charge_chf: chf(s.typicalMinor),
      charges: s.payments,
      last_charged: s.lastOn,
      cost_per_year_chf: chf(s.yearlyMinor),
    })),
  };
}

/**
 * The get_savings_potential payload: two halves that answer "where could I
 * save" together. The headline is the **unassigned money**, taken from the
 * very read the Savings page's Unallocated pot uses (`getSavingsOverview`,
 * income minus spending minus what is already in goals) — the same logic, so
 * the assistant and the pot can never quote two different figures. Negative
 * means the month overspent, and the tool says so instead of flooring it.
 * The second half is the fixed/flexible category split over the asked
 * window, which says where future spending could realistically be cut.
 */
export function savingsPotentialToolResult(
  dashboard: Dashboard,
  overview: SavingsOverview | null,
  period?: Period,
): unknown {
  const { totals, categories } = dashboard;
  const fixed = categories.filter((s) => FIXED_EXPENSE_CATEGORIES.has(s.key));
  const flexible = categories.filter(
    (s) => !FIXED_EXPENSE_CATEGORIES.has(s.key),
  );
  const fixedTotal = fixed.reduce((sum, s) => sum + s.amount, 0);
  const flexibleTotal = flexible.reduce((sum, s) => sum + s.amount, 0);
  const unassigned =
    overview && overview.month !== null
      ? {
          unassigned_month: overview.month,
          unassigned_chf: chf(overview.freeMinor),
          month_over: overview.monthEnded,
        }
      : {};
  return {
    period: period?.label ?? "all statements",
    ...unassigned,
    net_saved_chf: chf(totals.net),
    total_spending_chf: chf(totals.expense),
    fixed_costs_chf: chf(fixedTotal),
    fixed_categories: fixed.map((s) => s.key),
    flexible_spending_chf: chf(flexibleTotal),
    flexible_categories: sliceRows(flexible),
    note: "unassigned_chf is what that month actually left over and has not been put into a goal — the same figure the app's Unallocated pot shows; negative means the month overspent. Lead with it, then advise cutting in the largest flexible categories. Fixed costs cannot realistically be cut.",
  };
}

/**
 * The get_recent_anomalies payload: the stored scan, never a fresh one — a
 * scan is minutes of CPU and belongs to the Account page's explicit button.
 * The three not-ok states are spelled out for the model so "no findings" and
 * "never scanned" cannot blur into the same falsely reassuring answer.
 */
export function anomaliesToolResult(overview: AnomalyOverview): unknown {
  if (overview.running) {
    return {
      status: "scan_running",
      note: "An anomaly scan is running right now — the findings will be ready in a moment.",
    };
  }
  if (!overview.hasCompletedScan) {
    return {
      status: "never_scanned",
      note: "No anomaly scan has been run yet, so nothing has been checked. The customer can start one on the Account page.",
    };
  }
  if (overview.outdated) {
    return {
      status: "outdated",
      note: "The statements changed after the last scan, so its findings are outdated. A fresh scan can be started on the Account page.",
    };
  }
  const compact = (group: AnomalyGroup) => ({
    finding: group.title,
    severity: group.severity,
    transactions: group.transactionCount,
    latest_on: group.latestOn,
    summary: group.description,
  });
  return {
    status: "ok",
    needs_a_look: overview.action.slice(0, 8).map(compact),
    ordinary_context: overview.context.slice(0, 5).map(compact),
    note:
      overview.action.length === 0
        ? "Nothing needs attention — reassure the customer."
        : "Summarize what needs a look without alarm — most findings are the customer's own legitimate spending. Details are on the Anomalies page.",
  };
}

/**
 * The get_savings_goals payload. The caller resolves which month the overview
 * is about (the last completed one by default); `surplus_chf` is null while
 * that month still runs, and the free figure is the ceiling a proposed split
 * may distribute. The note names who moves the money, because the model must
 * not promise an allocation it cannot perform.
 */
export function savingsGoalsToolResult(overview: SavingsOverview | null): unknown {
  if (!overview || overview.month === null) {
    return { note: "No statement months yet — there is nothing to allocate." };
  }
  const notes: string[] = [];
  if (overview.pots.length === 0) {
    notes.push(
      "The customer has no saving goals yet — they can be created in the dashboard's Savings section.",
    );
  }
  if (!overview.monthEnded) {
    notes.push("This month is still running, so its surplus is not final yet.");
  } else if (overview.freeMinor === 0) {
    notes.push("Nothing is left to allocate from this month.");
  } else if (overview.pots.length > 0) {
    notes.push(
      "To split the free amount across the goals call propose_allocation — favor the goals further from target; the customer gets an Apply button. You cannot move money yourself.",
    );
  }
  return {
    month: overview.month,
    month_over: overview.monthEnded,
    surplus_chf: overview.surplusMinor === null ? null : chf(overview.surplusMinor),
    already_allocated_chf: chf(overview.allocatedMinor),
    free_to_allocate_chf: chf(overview.freeMinor),
    goals: overview.pots.map((pot) => ({
      name: pot.name,
      target_chf: chf(pot.targetMinor),
      saved_chf: chf(pot.savedMinor),
      still_missing_chf: chf(Math.max(0, pot.targetMinor - pot.savedMinor)),
      allocated_this_month_chf: chf(pot.monthMinor),
      target_date: pot.targetOn,
    })),
    note: notes.join(" "),
  };
}

/** A goal-and-francs pair as the model wrote it, minor units, unvalidated. */
export type RawAllocation = { goal: string; amountMinor: number };

/** "600", "1'234.50", "CHF 89,90" → minor units; undefined when unparseable. */
function francsToMinor(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : undefined;
  }
  if (typeof value !== "string") return undefined;
  let cleaned = value.replace(/chf/i, "").replace(/[’'\s]/g, "").trim();
  // A comma is the Swiss decimal only when it carries one or two trailing
  // digits ("89,90"); anything else ("1,250") is a thousands group, and
  // reading it as a decimal silently shrinks the amount a thousandfold.
  const decimal = /,(\d{1,2})$/.exec(cleaned);
  cleaned = decimal
    ? `${cleaned.slice(0, decimal.index).replace(/,/g, "")}.${decimal[1]}`
    : cleaned.replace(/,/g, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}

/**
 * The goal/amount pairs out of a propose_allocation call. Two layers, like
 * `extractSql`: the balanced-JSON extractor first, and when the surrounding
 * array was mangled past parsing, a regex sweep for `"goal": …, "amount…": …`
 * pairs — an 8B model truncates argument arrays often enough that the pairs
 * deserve to survive their wrapper.
 */
export function parseAllocationArgs(content: string): RawAllocation[] {
  const args = extractJsonAfter(content, "propose_allocation");
  const list = Array.isArray(args)
    ? args
    : args && typeof args === "object"
      ? (args as Record<string, unknown>).allocations ??
        (args as Record<string, unknown>).split
      : undefined;
  if (Array.isArray(list)) {
    const parsed: RawAllocation[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const goal = record.goal ?? record.name ?? record.goal_name;
      const amountMinor = francsToMinor(
        record.amount_chf ?? record.amount ?? record.chf,
      );
      if (typeof goal === "string" && goal.trim() && amountMinor !== undefined) {
        parsed.push({ goal: goal.trim(), amountMinor });
      }
    }
    if (parsed.length > 0) return parsed;
  }

  const parsed: RawAllocation[] = [];
  // The trailing delimiter is the guard: a pair cut off mid-amount ("…chf": 2⏎)
  // may be a truncated 250, and a confidently wrong figure is worse than one
  // dropped row the model can re-propose.
  const pair =
    /"(?:goal|name|goal_name)"\s*:\s*"([^"]+)"\s*,\s*"(?:amount_chf|amount|chf)"\s*:\s*"?([\d.,'’]+)"?\s*[,}\]]/g;
  // The sweep is fenced to the argument region — from the tool name to the
  // first `]` that could close its array. Goal/amount-shaped pairs elsewhere
  // in the content (an echoed goals list, a quoted earlier proposal) must not
  // turn into phantom allocations.
  const at = content.indexOf("propose_allocation");
  let region = at >= 0 ? content.slice(at) : content;
  const close = region.indexOf("]");
  if (close >= 0) region = region.slice(0, close + 1);
  for (const match of region.matchAll(pair)) {
    const amountMinor = francsToMinor(match[2]);
    if (amountMinor !== undefined) {
      parsed.push({ goal: match[1].trim(), amountMinor });
    }
  }
  return parsed;
}

/**
 * Validate a proposed split against the month's real state, yielding both the
 * typed proposal the Apply card renders and the result the model captions.
 * The model's numbers are requests, not figures: goals are matched against
 * the pots by name (exact first, then unique substring), amounts are floored
 * at zero, duplicates merge, and a sum beyond the free surplus is scaled down
 * to whole francs to fit. Whatever survives is the split — both readers see
 * the same one, which is what makes the caption trustworthy.
 */
export function buildAllocationProposal(
  raw: RawAllocation[],
  overview: SavingsOverview | null,
): { proposal?: AllocationProposal; result: unknown } {
  if (!overview || overview.month === null) {
    return { result: { error: "No statement months yet — nothing to allocate." } };
  }
  const goalNames = overview.pots.map((pot) => pot.name);
  if (overview.pots.length === 0) {
    return {
      result: {
        error:
          "There are no saving goals to allocate to. The customer can create some in the dashboard's Savings section.",
      },
    };
  }
  if (!overview.monthEnded) {
    return {
      result: {
        error: `${overview.month} is still running and has no final surplus yet. Only a completed month can be allocated.`,
      },
    };
  }
  if (overview.freeMinor <= 0) {
    return {
      result: {
        error: `Nothing is free to allocate from ${overview.month} — its surplus is already fully put away.`,
        goals: goalNames,
      },
    };
  }
  if (raw.length === 0) {
    return {
      result: {
        error:
          'No allocations found — pass {"propose_allocation": {"allocations": [{"goal": "…", "amount_chf": 0}]}}.',
        goals: goalNames,
        free_to_allocate_chf: chf(overview.freeMinor),
      },
    };
  }

  // Exact name first; a unique substring match second, so "Ferien" still
  // finds "Ferien 2026" without letting an ambiguous fragment guess.
  const matchPot = (goal: string) => {
    const wanted = goal.toLowerCase();
    const exact = overview.pots.find((pot) => pot.name.toLowerCase() === wanted);
    if (exact) return exact;
    const partial = overview.pots.filter(
      (pot) =>
        pot.name.toLowerCase().includes(wanted) ||
        wanted.includes(pot.name.toLowerCase()),
    );
    return partial.length === 1 ? partial[0] : undefined;
  };

  const adds = new Map<number, number>();
  const unmatched: string[] = [];
  for (const item of raw) {
    const pot = matchPot(item.goal);
    if (!pot) {
      unmatched.push(item.goal);
      continue;
    }
    const add = Math.max(0, item.amountMinor);
    if (add === 0) continue;
    adds.set(pot.id, (adds.get(pot.id) ?? 0) + add);
  }
  if (adds.size === 0) {
    return {
      result: {
        error: `None of the proposed goals exist. The goals are: ${goalNames.join(", ")}.`,
        free_to_allocate_chf: chf(overview.freeMinor),
      },
    };
  }

  // Over the ceiling: scale everything down proportionally, to whole francs,
  // so the split always fits what the month actually has left.
  let addTotal = [...adds.values()].reduce((sum, add) => sum + add, 0);
  const scaled = addTotal > overview.freeMinor;
  if (scaled) {
    for (const [goalId, add] of adds) {
      const shrunk =
        Math.floor((add * overview.freeMinor) / addTotal / 100) * 100;
      if (shrunk === 0) adds.delete(goalId);
      else adds.set(goalId, shrunk);
    }
    if (adds.size === 0) {
      return {
        result: {
          error: `The free amount is only ${chf(overview.freeMinor)} CHF — propose smaller amounts.`,
        },
      };
    }
    addTotal = [...adds.values()].reduce((sum, add) => sum + add, 0);
  }

  // Card rows in the pots' own order. Adds only — what these mean against
  // each goal's month total is resolved at apply time, not frozen here.
  const receiving = overview.pots.filter((pot) => adds.has(pot.id));
  const proposal: AllocationProposal = {
    month: overview.month,
    items: receiving.map((pot) => ({
      goalId: pot.id,
      name: pot.name,
      addMinor: adds.get(pot.id) as number,
    })),
    addTotalMinor: addTotal,
  };
  return {
    proposal,
    result: {
      shown_to_customer: true,
      month: overview.month,
      split: proposal.items.map((item) => ({
        goal: item.name,
        add_chf: chf(item.addMinor),
      })),
      total_chf: chf(addTotal),
      ...(scaled
        ? { note_scaled: "The amounts were scaled down to fit the free surplus." }
        : {}),
      ...(unmatched.length > 0
        ? { ignored_unknown_goals: unmatched }
        : {}),
      note: "The split is now shown with an Apply button. Caption it briefly and invite the customer to tap Apply — the money has NOT moved yet.",
    },
  };
}

/**
 * The deterministic split the proposal safety net offers when the customer
 * asked to allocate and the model never made a valid propose_allocation call.
 *
 * The free surplus is spread proportional to each goal's remaining gap (equal
 * parts when every goal is already full), floored to whole francs.
 *
 * This used to consult a first source ahead of the gaps — the pot's
 * Dauersparauftrag, which said outright what the holder meant to put in each
 * month. That feature is gone, and with it the only stored statement of intent
 * the split could read; what remains is inferred from the goals themselves.
 *
 * Expressed as RawAllocations so `buildAllocationProposal` stays the single
 * validator for everything that becomes an Apply card.
 */
export function defaultAllocationSplit(
  overview: SavingsOverview | null,
): RawAllocation[] {
  if (!overview || !overview.monthEnded || overview.freeMinor <= 0) return [];
  const pots = overview.pots;
  if (pots.length === 0) return [];

  const gaps = pots.map((pot) => Math.max(0, pot.targetMinor - pot.savedMinor));
  const gapTotal = gaps.reduce((sum, gap) => sum + gap, 0);
  const weights = gapTotal > 0 ? gaps : pots.map(() => 1);
  const weightTotal = gapTotal > 0 ? gapTotal : pots.length;
  return pots
    .map((pot, i) => ({
      goal: pot.name,
      amountMinor:
        Math.floor((overview.freeMinor * weights[i]) / weightTotal / 100) * 100,
    }))
    .filter((item) => item.amountMinor > 0);
}

/**
 * Which tools the model asked for. Scans for known names instead of parsing:
 * the emitted JSON is often malformed (`[{"get_overview": }]`, truncation at
 * a stop token), and the model sometimes writes prose *about* the call
 * ("Let me call get_spending_by_category.") without any call syntax at all.
 * In a round where tools are on offer, naming one is asking for it — the
 * round cap keeps a chatty final answer from looping the conversation.
 *
 * FOLLOWUP lines are exempt from the scan: they are definitionally part of a
 * finished answer, and the locale prompt actively invites tool names there
 * ("match a toolcall available to you") — scanning them would turn a
 * finished caption back into a tool round and discard the real answer.
 */
export function parseToolCalls(content: string): ToolName[] {
  const scanned = content
    .split("\n")
    .filter((line) => !FOLLOWUP_MARKER.test(line))
    .join("\n");
  return TOOL_NAMES.filter((name) => scanned.includes(name));
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

/**
 * The turn's time window when the question and the model both name none.
 * Defaults to year-to-date so the assistant answers about "this year"
 * unless the user explicitly asks for the whole history — matching how
 * people read a finance question. Returns undefined (all statements) only
 * for an explicit all-time ask.
 */
export function defaultPeriod(question: string): string | undefined {
  return /\b(all[- ]?time|all years|every year|entire history|whole history|lifetime|since the (start|beginning)|ever|overall|all[- ]?statements)\b/i.test(
    question,
  )
    ? undefined
    : "ytd";
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

  // The off-enum spellings an 8B model actually emits, mapped rather than
  // dropped — an unrecognized token would otherwise fall through to the
  // caller's next fallback, or worse, silently widen the window.
  if (
    value === "ytd" ||
    value === "year_to_date" ||
    value === "this_year" ||
    value === "current_year"
  ) {
    return {
      from: `${anchorYear}-01-01`,
      to: lastStatement,
      label: `year to date (${anchorYear}-01-01 to ${lastStatement})`,
    };
  }
  if (value === "this_month" || value === "current_month") {
    return { from: `${anchorMonth}-01`, to: lastStatement, label: anchorMonth };
  }
  if (value === "last_year" || value === "previous_year") {
    const year = String(Number(anchorYear) - 1);
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: year };
  }
  if (value === "last_month" || value === "previous_month") {
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
  // The advice tools go first, and carry German keywords: the one-tap starter
  // chips are localized, and a stalled model on a German question would
  // otherwise fall through to the English-keyed branches below. They outrank
  // the row-level check so "how many subscriptions" reads as a subscriptions
  // question, not a COUNT(*). (No \b before umlaut-initial words — JS \b is
  // ASCII-only and never matches before "ü".)
  if (/\b(subscriptions?|abos?|abonnements?|recurring|wiederkehrend\w*)\b/.test(q)) {
    return "get_subscriptions";
  }
  if (
    /\b(anomal\w*|suspicious|shady|fraud\w*|scam\w*|unusual|auffällig\w*|verdächtig\w*|ungewöhnlich\w*)\b/.test(q)
  ) {
    return "get_recent_anomalies";
  }
  if (
    /\b(goals?|pots?|allocat\w*|assign\w*|surplus|sparziel\w*|verteil\w*|zuweis\w*)\b/.test(q) ||
    /überschuss/.test(q)
  ) {
    return "get_savings_goals";
  }
  // "save" alone stays with get_overview below ("how much did I save?"); it is
  // the ability/where words beside it that make the question about potential.
  if (
    /\b(save|saving|savings|spar\w*)\b/.test(q) &&
    /\b(more|less|cut|reduce|potential|possible|where|can|could|wo|kann|könnte|mehr|weniger)\b/.test(q)
  ) {
    return "get_savings_potential";
  }
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
  // An explicit ask for a picture. The pie is the routed answer; a question
  // naming a bar or a line is caught after the loop by `wantsNonPieChart`,
  // which composes that shape from the same aggregates.
  if (
    /\b(pie|charts?|graphs?|diagrams?|diagramm\w*|grafik\w*|visuali[sz]e|visualisier\w*)\b/.test(q)
  ) {
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
  // the category split is the most useful single answer for them.
  if (/\b(save[d]?|savings|net|balance|how much money)\b/.test(q)) {
    return "get_overview";
  }
  if (
    /\b(categor(y|ies)|breakdown|distribution|split|share|pie|chart|graph|spend(ing)?|expenses?|allocat|overview|summary|total|financ\w*|money|doing|habits?|health|standing)\b/.test(q) ||
    /where .*(go|goes|going|spent?)/.test(q) ||
    /how (am|are|is|'?s|are my|is my)\b/.test(q)
  ) {
    return "get_spending_by_category";
  }
  return undefined;
}

/** Drop any special-token markup and tool-call block from a visible reply. */
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

/**
 * Tolerates the JSON-flavoured spelling too: `[{"FOLLOWUP": "…"}]`.
 * Uppercase only, on purpose: the prompt asks for `FOLLOWUP:` verbatim, and a
 * case-insensitive match amputated legitimate prose — "One follow-up: cancel
 * Netflix…" lost everything after the colon to the chip row.
 */
const FOLLOWUP_MARKER = /[[{"']*\s*FOLLOW[\s-]?UPS?["']?\s*:/;

/** Strip bullet/number/quote/JSON wrapping from a proposed question. */
function cleanFollowUp(line: string): string {
  return line
    .replace(/^[\s\-*\d.)"'[{]+/, "")
    .replace(/[\s"'\]}),]+$/, "")
    .trim();
}

/**
 * One marker payload → individual questions. The locale prompt invites an
 * inline array (`FOLLOWUP: ["q1", "q2"]`), which a single cleanFollowUp pass
 * would mangle into one half-stripped chip — so an array is parsed (or, when
 * its JSON is broken, split on the quote-comma-quote seams) first.
 */
function splitFollowUpPayload(part: string): string[] {
  const trimmed = part.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every((q): q is string => typeof q === "string")
      ) {
        return parsed;
      }
    } catch {
      // fall through to the seam split
    }
  }
  if (/["']\s*,\s*["']/.test(trimmed)) {
    return trimmed.split(/["']\s*,\s*["']/);
  }
  return [trimmed];
}

/**
 * Pull the model's proposed follow-up questions out of its answer. The
 * system prompt asks for one `FOLLOWUP: …` line each, but a small model also
 * packs several onto one line ("…? FOLLOWUP: …?"), writes a bare
 * `FOLLOWUPS:` header with a list under it, or ships them as one inline
 * array — so lines are split on the marker, each payload is split again, and
 * after a marker, question-shaped lines are consumed too. Everything matched
 * is removed from the visible reply, and repeats are dropped: a small model
 * happily proposes the same question twice, and duplicate chips would also
 * be duplicate React keys.
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
        for (const piece of splitFollowUpPayload(part)) {
          const question = cleanFollowUp(piece);
          if (question) followUps.push(question);
        }
      }
      continue;
    }
    if (collecting) {
      const questions = splitFollowUpPayload(line)
        .map(cleanFollowUp)
        .filter((q) => q && q.endsWith("?"));
      if (questions.length > 0) {
        followUps.push(...questions);
        continue;
      }
      collecting = false;
    }
    kept.push(line);
  }

  const seen = new Set<string>();
  const unique = followUps.filter((q) => {
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { text: kept.join("\n").trim(), followUps: unique.slice(0, 3) };
}

