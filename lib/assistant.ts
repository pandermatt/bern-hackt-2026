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
 * Calls arrive as real OpenAI `tool_calls` with parsed `arguments`, so no
 * prose is scraped here. That is load-bearing on the prompt: earlier versions
 * of `SYSTEM_PROMPT` showed the call syntax inline (`[{"get_overview": {…}}]`),
 * which teaches the model to write calls as text in `content` and suppresses
 * the native ones outright. Do not put call syntax back.
 */
import type { AnomalyGroup, AnomalyOverview } from "@/app/actions/anomalies";
import type { SavingsOverview } from "@/app/actions/savings";
import type { Dashboard } from "@/app/actions/transactions";
import type { Transaction } from "@/db/schema";
import type { Slice } from "@/lib/insights";

export type ChatRole = "user" | "assistant";

/**
 * The `Chat` namespace keys of the four starter proposals — the one-tap chips
 * the empty state shows. Shared, not duplicated: the panel renders them on
 * start, and the action re-offers the same questions as follow-up chips on
 * turns where the model proposed none, so both readers stay in lockstep when
 * a proposal is reworded or added.
 */
export const SUGGESTION_KEYS = [
  "suggestion1",
  "suggestion2",
  "suggestion3",
  "suggestion4",
] as const;

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/** One call as the endpoint reports it, arguments still a JSON string. */
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * What actually goes over the wire — one turn can add assistant/tool pairs.
 * The assistant message is echoed back carrying its `tool_calls`, and every
 * result quotes the `tool_call_id` it answers; an endpoint that loses either
 * side of that pairing rejects the next round.
 */
export type WireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

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
  "Call tools through the function-calling interface. Never write a call out as text in your reply, and never describe the call you are about to make — just make it. Once you have the data, answer without mentioning tools or their names.",
  "Your reply is read by a person, not by a program. It must never contain a tool name, a JSON object, or a suggestion that the reader run something. When you need data, call the tool — do not tell the reader about it.",
  "Be concise: 2–3 short sentences, plain text, no markdown, no lists.",
  "All amounts are Swiss francs. The tools return them already formatted, apostrophe as thousands separator — reproduce those strings character for character. Never state a figure the tools did not return, and never reuse a number that appears in these instructions or in a tool description: those are format templates, not the customer's money.",
  "Name only the figures that answer the question — the biggest item and the takeaway — rather than listing everything a tool returned.",
  "When the tools cannot answer — a specific transaction, a day of week, a count, a comparison they don't cover — call run_sql with one SQLite SELECT over the transactions table; the schema is in the tool description.",
  "Four tools carry the advice questions: get_savings_potential for where the customer could save (advise only on its flexible categories — fixed costs like housing, insurance and taxes cannot be cut); get_recent_anomalies for anything suspicious or unusual (stay calm — most findings are the customer's own legitimate spending); get_subscriptions for recurring subscriptions; get_savings_goals for the saving goals and a month's unallocated surplus.",
  "To allocate a month's surplus: call get_savings_goals first, then propose_allocation with one amount per goal from the free amount. The app validates the split and shows it to the customer with an Apply button; caption the final split the tool returns and invite the tap. Only that tap moves money — never claim it already moved.",
  "You cannot draw charts or graphs. When one is asked for, answer with the figures themselves and mention that the dashboard's own charts carry the visual.",
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
  // Spelled out the same way `lib/llm/analyze-insights.ts` does it: a bare
  // "German" gets ß back, which is wrong on a Swiss statement.
  de: "German (Swiss usage: never the letter ß, always ss)",
  en: "English",
};

export function systemPromptFor(locale: string): string {
  const language = LANGUAGE_NAMES[locale];
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
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * The one argument every tool shares. A single constrained string instead of
 * from/to fields: a model emits one `"period"` far more reliably than two
 * well-formed dates, and `resolvePeriod` does the calendar work server-side.
 *
 * The default is stated here rather than in the system prompt because it has
 * to be true at the point of the call — without it the model stops to ask the
 * customer which period they meant instead of answering.
 */
const PERIOD_PARAMETERS = {
  type: "object" as const,
  properties: {
    period: {
      type: "string" as const,
      description:
        "Optional time period: 'ytd', a year ('2025'), a month ('2025-03'), a range ('2025-01-01..2025-03-31'), 'last_month', or 'last_3_months'. Relative periods count back from the newest statement, not from today. Omit it unless the question names a period — omitting scopes to the current year, which is the right default. Pass an explicit range for the full history.",
    },
  },
};

/** For the tools that take nothing — anomalies and subscriptions read the
 * account whole, so a period argument would only invite a mangled one. */
const EMPTY_PARAMETERS = {
  type: "object" as const,
  properties: {},
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
      "Table: transactions(booked_on TEXT 'YYYY-MM-DD', weekday TEXT the English day name ('Monday'…'Sunday'), month TEXT 'YYYY-MM', kind TEXT in ('income','expense'), amount_chf REAL signed francs (income positive, spending negative), amount_minor INTEGER signed rappen, account TEXT, merchant TEXT, category TEXT, description TEXT, currency TEXT). Internal transfers between the customer's own accounts are already excluded, matching every other figure in the app.",
      "Group by weekday or month directly — they are real columns. Do not derive them with strftime, and never report a day or month as a number.",
      "The table holds ONLY rows inside the resolved period scope (year-to-date by default). A WHERE on booked_on can narrow further but can never reach outside that scope — to query a different or wider window, pass the period argument.",
      "One SELECT statement (no CTEs / WITH), no writes, reference the table at most twice. At most 40 result rows come back, so aggregate in SQL.",
      "Remember spending is negative: the largest expense is MIN(amount_chf) / ORDER BY amount_chf ASC, and filter kind='expense' for spending, kind='income' for income.",
      "Example: SELECT weekday, ROUND(SUM(-amount_chf), 2) AS spent FROM transactions WHERE kind='expense' GROUP BY weekday ORDER BY spent DESC LIMIT 3",
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
].map(({ name, description, parameters }) => ({
  type: "function" as const,
  function: { name, description, parameters },
}));

/** A tool we actually serve, or nothing — the model can name anything. */
export function asToolName(name: string | undefined): ToolName | undefined {
  return TOOL_NAMES.includes(name as ToolName) ? (name as ToolName) : undefined;
}

/** Every name in `tool_calls` that we actually serve, in the order asked. */
export function toolNamesIn(calls: ToolCall[]): ToolName[] {
  return calls
    .map((call) => asToolName(call.function?.name))
    .filter((name): name is ToolName => name !== undefined);
}

/**
 * A call's arguments, guarded. The endpoint hands back `arguments` as a JSON
 * string it did not itself validate, and a model that truncated mid-object or
 * emitted `{}` is routine — an unreadable argument set means "no arguments",
 * never a failed turn. Every tool but propose_allocation has a working default
 * for every field, so an empty object still answers.
 */
export function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The `period` argument, if the model passed a usable one. */
export function periodArgument(args: Record<string, unknown>): string | undefined {
  const period = args.period;
  return typeof period === "string" && period.trim()
    ? period.trim().toLowerCase()
    : undefined;
}

/** The `sql` argument of a run_sql call. Validation is `validateSelect`'s job. */
export function sqlArgument(args: Record<string, unknown>): string | undefined {
  const sql = args.sql;
  return typeof sql === "string" && sql.trim() ? sql : undefined;
}

/**
 * The goal/amount pairs of a propose_allocation call. The wrapper key is
 * tolerated in the spellings the model reaches for, and so are the field
 * names, because the alternative is a wasted round trip to say "call it
 * allocations". The figures themselves are requests, not facts:
 * `buildAllocationProposal` clamps every one against the month's real free
 * surplus before anything reaches the Apply card.
 */
export function allocationsFrom(args: Record<string, unknown>): RawAllocation[] {
  const list = Array.isArray(args)
    ? args
    : (args.allocations ?? args.split ?? args.goals);
  if (!Array.isArray(list)) return [];
  const parsed: RawAllocation[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const goal = entry.goal ?? entry.name ?? entry.goal_name;
    const amountMinor = francsToMinor(entry.amount_chf ?? entry.amount ?? entry.chf);
    if (typeof goal === "string" && goal.trim() && amountMinor !== undefined) {
      parsed.push({ goal: goal.trim(), amountMinor });
    }
  }
  return parsed;
}

/** A JSON object literal — `{"key":` — anywhere in a would-be answer. */
const JSON_OBJECT = /\{\s*"[^"\n]+"\s*:/;

/**
 * A snake_case identifier — `get_weekday_spending`, `amount_chf`. Matching the
 * shape rather than the eleven known names on purpose: the model invents tool
 * names it wishes existed ("Bitte rufe get_weekday_spending an") as readily as
 * it misuses the real ones, and a reader told to call a function that does not
 * exist is worse off than one told nothing. No German or English word is
 * spelled this way, so the shape is safe to reject on sight.
 */
const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

/**
 * Where a would-be answer stops being an answer, or -1 if it never does.
 *
 * Three shapes, all of them the model showing its plumbing instead of using
 * it: naming a tool, writing a call out as JSON rather than making it, and
 * naming a function that does not exist at all.
 * Used only to *reject* a reply, never to route one — the difference from the
 * keyword routing this replaced. It matters more than it looks: on exactly
 * these turns the model also invents the figures it puts in the JSON.
 */
export function plumbingAt(text: string): number {
  const marks = [
    ...TOOL_NAMES.map((name) => text.indexOf(name)),
    text.search(JSON_OBJECT),
    text.search(SNAKE_CASE),
  ].filter((at) => at >= 0);
  return marks.length > 0 ? Math.min(...marks) : -1;
}

/** Whether a would-be answer shows the plumbing anywhere. */
export function showsPlumbing(text: string): boolean {
  return plumbingAt(text) >= 0;
}

/**
 * Every number a tool handed the model this turn, in the spellings a reply
 * might use it in. Amounts come back pre-formatted ("6'044.27"), so the
 * apostrophes go and both the exact and whole-franc forms are kept.
 */
export function numbersIn(json: string): Set<string> {
  const seen = new Set<string>();
  for (const match of json.matchAll(/-?\d[\d']*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/'/g, ""));
    if (!Number.isFinite(value)) continue;
    seen.add(Math.abs(value).toFixed(2));
    seen.add(Math.round(Math.abs(value)).toString());
  }
  return seen;
}

/**
 * Amounts of money in a reply, as written. Deliberately narrow: a figure
 * counts only if it is marked as money — next to CHF, grouped with an
 * apostrophe, or written to the rappen. Bare integers are years, counts and
 * ranks, and percentages are the model's own arithmetic over figures it did
 * fetch; neither is checkable, so neither is checked.
 */
export function amountsIn(text: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:CHF\s?)?(\d{1,3}(?:'\d{3})+(?:\.\d{2})?|\d+\.\d{2})(?:\s?(?:CHF|%))?/g;
  for (const match of text.matchAll(pattern)) {
    const whole = match[0];
    if (whole.trimEnd().endsWith("%")) continue;
    if (!/CHF/i.test(whole) && !whole.includes("'")) continue;
    found.push(match[1]);
  }
  return found;
}

/**
 * The amounts in a reply that no tool returned this turn.
 *
 * The assistant's one hard promise is that every franc on screen came off the
 * customer's statements. The model breaks it on a minority of turns — naming
 * March's spending as CHF 5'210.40 when March was CHF 6'960.90, or inventing
 * merchants outright — and it breaks it most readily when it never fetched
 * anything. Amounts are cheap to verify against what came back, so they are.
 */
export function unverifiedAmounts(text: string, seen: Set<string>): string[] {
  return amountsIn(text).filter((written) => {
    const value = Math.abs(Number(written.replace(/'/g, "")));
    if (!Number.isFinite(value)) return false;
    return !(
      seen.has(value.toFixed(2)) ||
      seen.has(Math.round(value).toString()) ||
      seen.has((value * 100).toFixed(2))
    );
  });
}

/**
 * Everything that is the model thinking rather than the model answering.
 * Three sources, all seen on the endpoints this talks to: `<think>` blocks
 * from a reasoning model, Apertus's `<|…|>` control tokens, and a
 * `reasoning_content` field the caller drops separately. An unclosed
 * `<think>` means the answer was truncated inside the reasoning — there is no
 * answer in there to keep, so the whole tail goes.
 */
export function stripReasoning(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .split("<|tools_prefix|>")[0]
    .replace(/<\|[^|>]*\|>/g, "")
    .trim();
}

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
 * Returns the JSON the model gets to read — figures only; the assistant
 * draws nothing.
 */
export function runTool(
  name: ToolName,
  dashboard: Dashboard,
  period?: Period,
): { result: unknown } {
  const { facets, totals, categories, merchants, monthly } = dashboard;
  const scope = period?.label ?? "all statements";

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
      };
    case "get_top_merchants":
      return {
        result: { period: scope, merchants: sliceRows(merchants) },
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
    case "run_sql":
    case "get_savings_potential":
    case "get_subscriptions":
    case "get_recent_anomalies":
    case "get_savings_goals":
    case "propose_allocation":
      // All need what a pure helper cannot hold — the SQL sandbox, or a
      // database read of their own — so the action loop handles them before
      // calling here.
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

/** A resolved, inclusive date window over the statements. */
export type Period = {
  from: string;
  to: string;
  /** Human wording, echoed into tool results, chart titles, and the log. */
  label: string;
};

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
 * Deterministic question → tool classification. No longer a fallback for a
 * stalled model — calls arrive as `tool_calls` now — but still what the
 * proposal safety net at the end of a turn reads intent with.
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
  // The assistant no longer draws; an explicit chart ask is answered with
  // the figures the chart would have shown.
  if (/\b(pie|charts?|graphs?|diagrams?|visuali[sz]e)\b/.test(q)) {
    return "get_spending_by_category";
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

