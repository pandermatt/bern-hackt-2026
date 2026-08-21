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

export type ChartSpec = {
  kind: "pie";
  title: string;
  totalMinor: number;
  slices: PieSlice[];
};

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
  "You answer questions about the customer's imported bank statements.",
  "You know none of the figures yourself: always call one of the provided tools first and answer only from what the tools return — never invent or estimate a number.",
  "To call a tool, emit only the tool call itself — no prose before or after it. Once you have the data, answer without mentioning tools or their names.",
  'Every tool accepts an optional period argument for time-scoped questions, e.g. [{"get_spending_by_category": {"period": "ytd"}}]. Accepted values: ytd, a year like 2025, a month like 2025-03, a range like 2025-01-01..2025-03-31, last_month, or last_3_months. Omit it for all data.',
  "Be concise: 2–3 short sentences, plain text, no markdown, no lists.",
  "All amounts are Swiss francs. Write them exactly as the tools format them, e.g. CHF 1'234.55 — apostrophe as thousands separator, two decimals.",
  "Prefer a chart as the answer whenever the data allows it: the app automatically draws a pie chart when you fetch category, merchant, or income data, so for questions about spending, money habits, or a general overview, reach for get_spending_by_category (or the merchant/income tool) rather than plain totals.",
  "When a chart will be shown, your text is its caption: one or two sentences naming the biggest item and the takeaway. Never describe chart shapes and never list many figures the chart already shows.",
  "After your answer, propose 2 or 3 short follow-up questions the user could ask next, each on its own line starting with FOLLOWUP: — nothing else on those lines.",
].join("\n");

export const TOOL_NAMES = [
  "get_overview",
  "get_spending_by_category",
  "get_top_merchants",
  "get_income_breakdown",
  "get_monthly_series",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

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

/** OpenAI-style declarations. Names only plus the shared period argument —
 * an 8B model emits a bare name far more reliably than argument JSON. */
export const TOOL_DEFINITIONS = [
  {
    name: "get_overview",
    description:
      "Accounts, statement date range, and the year's totals: salary, refunds, total income, total spending, net saved. No chart — prefer a breakdown tool when the question allows one.",
  },
  {
    name: "get_spending_by_category",
    description:
      "Spending broken down by category, largest first. Shown to the user as a pie chart.",
  },
  {
    name: "get_top_merchants",
    description:
      "The merchants the customer spent the most at. Shown to the user as a pie chart.",
  },
  {
    name: "get_income_breakdown",
    description:
      "Where the incoming money came from: salary versus merchant refunds. Shown to the user as a pie chart.",
  },
  {
    name: "get_monthly_series",
    description: "Money in and money out for every month.",
  },
].map(({ name, description }) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: PERIOD_PARAMETERS,
  },
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
function toPie(title: string, slices: Slice[], max = 5): ChartSpec | undefined {
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
): { result: unknown; chart?: ChartSpec } {
  const { facets, totals, categories, merchants, monthly } = dashboard;
  const scope = period?.label ?? "all statements";
  const titled = (title: string) =>
    period ? `${title} — ${period.label}` : title;

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
    case "get_income_breakdown": {
      const slices: Slice[] = [
        { key: "Salary", amount: totals.salary, count: 0, share: 0 },
        { key: "Refunds", amount: totals.refunds, count: 0, share: 0 },
      ];
      return {
        result: {
          period: scope,
          salary_chf: chf(totals.salary),
          refunds_chf: chf(totals.refunds),
          total_income_chf: chf(totals.income),
          note: "Refunds are merchant credits, not earnings.",
        },
        chart: toPie(titled("Where the money came from"), slices),
      };
    }
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
  }
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
  if (/CHF/i.test(content)) return false;
  return /\b(tools?|fetch|call|retriev|look up|data)\b/i.test(content) || !/\d/.test(content);
}

/**
 * Deterministic question → tool routing, the fallback when the model stalls.
 * Mirrors the tool descriptions; returns nothing for small talk, which lets
 * the model's own words stand as the reply.
 */
export function routeTool(question: string): ToolName | undefined {
  const q = question.toLowerCase();
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
    candidates.push("Where does my money go by category?");
  } else if (/\b(income|earn(ed|ings)?|salary|refunds?)\b/.test(q)) {
    candidates.push("How much of my income did I spend?");
    candidates.push("Where does my money go?");
  } else {
    if (topCategory) candidates.push(`Why is ${topCategory} so high?`);
    candidates.push("Who are my top merchants?");
  }
  if (priciest && priciest.expense > 0) {
    candidates.push(`What happened in ${priciest.label}?`);
  }
  candidates.push(
    "How much did I save this year?",
    "How do refunds affect my total?",
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
