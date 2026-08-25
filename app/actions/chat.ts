"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { getAnomalyOverview } from "@/app/actions/anomalies";
import { getSavingsOverview } from "@/app/actions/savings";
import { getDashboard, listTransactions } from "@/app/actions/transactions";
import {
  anomaliesToolResult,
  buildAllocationProposal,
  chartToolForSource,
  composeEChart,
  defaultAllocationSplit,
  defaultChartSource,
  defaultPeriod,
  extractFollowUps,
  extractJsonAfter,
  extractSql,
  formatSwissNumbers,
  languageName,
  looksLikeStall,
  parseAllocationArgs,
  parseChartRequest,
  parsePeriod,
  parseToolCalls,
  periodFromQuestion,
  resolvePeriod,
  routeTool,
  runTool,
  sanitizeEChartsOption,
  savingsGoalsToolResult,
  savingsPotentialToolResult,
  shouldDefaultChart,
  stripModelMarkup,
  subscriptionsToolResult,
  systemPromptFor,
  wantsNonPieChart,
  SUGGESTION_KEYS,
  TOOL_DEFINITIONS,
  type AllocationProposal,
  type AssistantTurn,
  type ChartRequest,
  type ChartSpec,
  type Period,
  type WireMessage,
} from "@/lib/assistant";
import {
  anomaliesSummary,
  categorySummary,
  matchHappyPath,
  paraphrasePromptFor,
  recentCount,
  recentSpendingSummary,
  renderSummary,
  savingsPotentialSummary,
  subscriptionsSummary,
  keepsFigures,
  type HappyContext,
  type HappyPathId,
  type HappySummary,
} from "@/lib/happy-path";
import { monthLabel } from "@/lib/month-label";
import { runSandboxSql } from "@/lib/sql-sandbox";
import {
  clearAssistantLog,
  listAssistantLog,
  pushAssistantLog,
  truncateSnapshot,
  type AssistantConfigView,
  type AssistantLogEntry,
  type AssistantLogView,
} from "@/lib/assistant-log";
import { getCurrentUser } from "@/lib/auth";
import { monthHasEnded } from "@/lib/clock";
import {
  geminiApiKey,
  geminiEndpoint,
  geminiFinishReason,
  geminiHeaders,
  geminiModel,
  geminiText,
  geminiUsage,
  toGeminiBody,
  type GeminiResponse,
} from "@/lib/llm/gemini";

/** Unset (or unparseable, or 0) means "no cap": the request then carries no
 * output cap at all and the model's own default applies. The thinking budget
 * is added on top of this inside `toGeminiBody` — this number is what the
 * customer actually reads. */
function assistantMaxTokens(): number | undefined {
  return Number.parseInt(process.env.MAX_TOKENS ?? "", 10) || undefined;
}

/** API requests per turn. Tools are offered on all but the last, which forces
 * an answer so a fetch-happy model cannot loop forever. Five, not four: a
 * goals-then-proposal answer legitimately takes three tool rounds. */
const MAX_ROUNDS = 5;

/**
 * The history, made usable rather than policed. The client ships its whole
 * transcript and assistant bubbles are unbounded (MAX_TOKENS may be unset), so
 * a hard schema reject here once BRICKED long conversations: the rejection's
 * own error bubble pushed every following turn over the same limit, for good.
 * Only garbage is refused now — sizes are clamped to what the prompt would
 * use anyway (the last 24 messages, 2000 chars each).
 */
function normalizeHistory(
  raw: unknown,
): { role: "user" | "assistant"; content: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw.flatMap(
    (entry): { role: "user" | "assistant"; content: string }[] => {
      if (!entry || typeof entry !== "object") return [];
      const { role, content } = entry as { role?: unknown; content?: unknown };
      if (role !== "user" && role !== "assistant") return [];
      if (typeof content !== "string") return [];
      const trimmed = content.trim();
      return trimmed ? [{ role, content: trimmed.slice(0, 2000) }] : [];
    },
  );
  const tail = cleaned.slice(-24);
  return tail.some((m) => m.role === "user") ? tail : undefined;
}

function failure(reply: string): AssistantTurn {
  return { reply, error: true };
}

/** The tools whose figures come out of the (period-scoped) dashboard
 * aggregate; only a round calling one of these pays for the scoped fetch. */
const DASHBOARD_TOOLS = new Set<string>([
  "get_overview",
  "get_spending_by_category",
  "get_top_merchants",
  "get_income_breakdown",
  "get_monthly_series",
  "get_savings_potential",
  "display_chart",
]);

/**
 * One turn of the chat, as a tool-calling loop. The model starts with no
 * figures at all: it requests data through the tools in `lib/assistant.ts`,
 * and each request is answered from the account's real aggregates. Raw
 * transaction rows never leave the server, and a chart the turn produces is
 * built from the same figures the model was handed — never from its prose.
 *
 * Gemini returns its calls as structured `functionCall` parts;
 * `lib/llm/gemini.ts` renders them back into the `{"name": {…}}` text
 * `lib/assistant.ts` parses, and results go back as `tool`-role messages.
 *
 * Returns an `AssistantTurn` directly rather than the `ActionResult` envelope:
 * like the reads in `transactions.ts`, a failed turn is rendered in place (as
 * a chat bubble), not raised as a toast.
 *
 * Every API request is recorded to the in-memory debug log — a turn with tool
 * rounds shows up as several entries. The API key travels in a header and is
 * never part of the snapshot.
 */
export async function askAssistant(rawHistory: unknown): Promise<AssistantTurn> {
  const user = await getCurrentUser();
  if (!user) {
    return failure("Your session has expired — sign in again to keep chatting.");
  }

  const turnStarted = Date.now();
  const model = geminiModel();
  const maxTokens = assistantMaxTokens();

  const history = normalizeHistory(rawHistory);
  const question = history
    ? [...history].reverse().find((m) => m.role === "user")
    : undefined;

  const record = (
    startedAt: number,
    patch: Partial<AssistantLogEntry> & { status: AssistantLogEntry["status"] },
  ): void =>
    pushAssistantLog({
      userId: user.id,
      at: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      model,
      maxTokens,
      question: question?.content ?? "(unreadable message)",
      messageCount: 0,
      ...patch,
    });

  if (!history || !question) {
    record(turnStarted, { status: "error", error: "History failed validation." });
    return failure("That message could not be read — try rephrasing it.");
  }

  const key = geminiApiKey();

  // The happy paths come first, and deliberately before the key check: they
  // answer from the app's own aggregates, so a missing key costs them their
  // prose and nothing else. See `lib/happy-path.ts`.
  const happyPath = matchHappyPath(question.content);
  if (happyPath) {
    return answerHappyPath({
      id: happyPath,
      question: question.content,
      history,
      model,
      maxTokens,
      key,
      record,
    });
  }

  if (!key) {
    record(turnStarted, { status: "error", error: "GEMINI_API_KEY is not set." });
    return failure(
      "The assistant is not configured yet. Set GEMINI_API_KEY in .env.local and restart the server.",
    );
  }

  // `view: "list"` explicitly: the dashboard's default is the calendar, and
  // building its per-day aggregates costs an account-wide anomaly read that no
  // chat turn has any use for.
  const dashboard = await getDashboard({ view: "list" });
  if (!dashboard) {
    record(turnStarted, { status: "error", error: "Session expired mid-turn." });
    return failure("Your session has expired — sign in again to keep chatting.");
  }

  const messages: WireMessage[] = [
    { role: "system", content: systemPromptFor(await getLocale()) },
    // Older turns are dropped rather than sent: the model has room for them,
    // but a chat turn is billed per prompt token and the last eight carry the
    // thread.
    ...history.slice(-8),
  ];
  // A validated surplus split from propose_allocation, if the model made one.
  let proposal: AllocationProposal | undefined;
  // The chart shown under the reply. An explicit display_chart /
  // display_echart call outranks the auto-attach that fires when the model
  // fetched chartable data without asking for a picture.
  let chart: ChartSpec | undefined;
  let chartExplicit = false;
  let reply: string | undefined;
  let proposedFollowUps: string[] = [];
  // Once any tool has run this turn, a digit-bearing reply is a caption, not a
  // stall — the stall/prose heuristics stand down.
  let toolRan = false;
  // The SQL sandbox's source rows, cached per turn and keyed by the window
  // they were fetched for.
  let sandboxRows: Awaited<ReturnType<typeof listTransactions>> | undefined;
  let sandboxKey: string | undefined;
  // The subscription detector's rows — always the whole history, never the
  // turn's period window: a year-to-date view would demote every yearly bill.
  let historyRows: Awaited<ReturnType<typeof listTransactions>> | undefined;
  // The month getSavingsOverview actually resolved for the last
  // get_savings_goals call this turn. propose_allocation prefers it, so the
  // proposal is validated against exactly the goals and free amount the model
  // was shown — re-deriving from that round's period let a June fetch be
  // followed by a proposal silently validated against July.
  let goalsMonth: string | undefined;
  // The window the last tool round resolved, for the post-loop proposal
  // safety net: the net must aim at the month the tool rounds actually used,
  // not re-derive one of its own.
  let lastPeriod: Period | undefined;
  // Which month the savings tools are about: a single-month period picks it;
  // otherwise the newest COMPLETED month — the newest statement month when it
  // is already over (statements that simply end in July, read in August), and
  // only otherwise the month before it. getSavingsOverview validates the
  // month against the statements and falls back on its own default.
  const goalMonthFor = (window?: Period) => {
    if (window && window.from.slice(0, 7) === window.to.slice(0, 7)) {
      return window.from.slice(0, 7);
    }
    const anchor = dashboard.facets.last.slice(0, 7);
    if (anchor && monthHasEnded(anchor)) return anchor;
    return resolvePeriod("last_month", dashboard.facets.last)?.from.slice(0, 7);
  };
  // A turn that already produced a proposal must not die to a late upstream
  // hiccup: the split is the app's own figures, so a short localized caption
  // carries it out where failure() would have thrown it away with the error.
  const salvage = async (): Promise<AssistantTurn | undefined> => {
    if (!proposal && !chart) return undefined;
    const t = await getTranslations("Chat");
    return { reply: t("partialReply"), proposal, chart };
  };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const offerTools = round < MAX_ROUNDS;
    const body = toGeminiBody({
      model,
      messages,
      // MAX_TOKENS caps the visible answer; the +80 is the budget for the
      // FOLLOWUP: lines parsed out of it. Tool rounds get a higher floor —
      // a truncated SQL statement or allocation array is an unusable one.
      // Thinking is budgeted on top of this, inside toGeminiBody. Without
      // MAX_TOKENS no cap is sent at all and the model decides.
      ...(maxTokens !== undefined
        ? {
            maxTokens: offerTools
              ? Math.max(maxTokens + 80, 700)
              : maxTokens + 80,
          }
        : {}),
      ...(offerTools ? { tools: TOOL_DEFINITIONS } : {}),
    });
    const startedAt = Date.now();
    const request = truncateSnapshot(JSON.stringify(body, null, 2));
    const messageCount = messages.length;

    let response: Response;
    let raw: string;
    try {
      response = await fetch(geminiEndpoint(model), {
        method: "POST",
        headers: geminiHeaders(key),
        body: JSON.stringify(body),
        // Longer than the 30s the 8B endpoint got: a reasoning model thinks
        // before it answers, and a tool round pays that twice over.
        signal: AbortSignal.timeout(60_000),
      });
      raw = await response.text();
    } catch (cause) {
      record(startedAt, {
        status: "error",
        error:
          cause instanceof Error && cause.name === "TimeoutError"
            ? "Request timed out after 60s."
            : "Fetch failed — endpoint unreachable.",
        note: `round ${round}`,
        messageCount,
        request,
      });
      return (
        (await salvage()) ??
        failure(
          "Could not reach the Gemini API — check the connection and try again.",
        )
      );
    }

    const snapshot = truncateSnapshot(raw);
    if (!response.ok) {
      record(startedAt, {
        status: "error",
        httpStatus: response.status,
        error: `Upstream answered ${response.status}.`,
        note: `round ${round}`,
        messageCount,
        request,
        response: snapshot,
      });
      return (
        (await salvage()) ??
        failure(
          // Gemini rejects a bad or unauthorized key with either code.
          response.status === 401 || response.status === 403
            ? "The model endpoint rejected the API key — check GEMINI_API_KEY."
            : `The model endpoint answered ${response.status} — try again in a moment.`,
        )
      );
    }

    let data: GeminiResponse;
    try {
      data = JSON.parse(raw);
    } catch {
      record(startedAt, {
        status: "error",
        httpStatus: response.status,
        error: "Upstream body was not JSON.",
        note: `round ${round}`,
        messageCount,
        request,
        response: snapshot,
      });
      return (
        (await salvage()) ??
        failure("The model returned an unreadable answer — try again.")
      );
    }

    const usage = geminiUsage(data);
    const content = geminiText(data);
    let calls = offerTools ? parseToolCalls(content) : [];
    // The model sometimes stalls — "Let me call the relevant tool…" with no
    // name to parse. Rather than showing that as the answer, route the
    // question to a tool ourselves and let the loop carry on.
    // The stall and prose-SQL heuristics only apply while no tool has run
    // this turn. Once one has, a digit-bearing reply is a caption ("The query
    // returned 42…"), not a stall, and re-routing would discard the real
    // answer.
    let routed = false;
    if (offerTools && !toolRan && calls.length === 0 && looksLikeStall(content)) {
      const fallback = routeTool(question.content);
      if (fallback) {
        calls = [fallback];
        routed = true;
      }
    }
    // The model sometimes writes the SELECT it wants as prose instead of
    // calling run_sql. Trigger on the extractor itself — if extractSql can
    // pull a statement out, that is the model asking for it — so the trigger
    // can never disagree with what actually runs.
    if (offerTools && !toolRan && !calls.includes("run_sql") && extractSql(content)) {
      calls = [...calls, "run_sql"];
      routed = true;
    }

    // Time scope, first-RESOLVABLE-wins: the model's period argument, then a
    // period the question itself names ("in March", "last 3 months"), then
    // the year-to-date default. Each candidate is resolved before it wins —
    // taking the first truthy string let an off-enum token ("recent",
    // "everything") eat the whole chain and silently widen the window to the
    // full history. Relative periods anchor to the newest statement date.
    const last = dashboard.facets.last;
    const period =
      calls.length > 0
        ? (resolvePeriod(parsePeriod(content), last) ??
          resolvePeriod(periodFromQuestion(question.content), last) ??
          resolvePeriod(defaultPeriod(question.content), last))
        : undefined;
    if (period) lastPeriod = period;

    record(startedAt, {
      status: "ok",
      httpStatus: response.status,
      note:
        calls.length > 0
          ? `round ${round} · fetched ${calls.join(", ")}${routed ? " (routed)" : ""}${period ? ` · ${period.label}` : ""}`
          : // An empty answer from a reasoning model usually means the output
            // budget went on thoughts — say so rather than leaving the log to
            // read like the model simply had nothing to add.
            `round ${round} · answer${content ? "" : ` · empty (${geminiFinishReason(data) ?? "no reason given"})`}`,
      messageCount,
      request,
      response: snapshot,
      usage,
    });

    if (calls.length === 0) {
      const extracted = extractFollowUps(stripModelMarkup(content));
      reply = formatSwissNumbers(extracted.text);
      proposedFollowUps = extracted.followUps;
      break;
    }

    // Aggregates scoped to the window come from a second, filtered fetch —
    // the same query path the dashboard itself uses. Only when a called tool
    // actually reads the dashboard: the context tools (SQL, anomalies,
    // subscriptions, savings) resolve their own data, and paying a full
    // filtered fetch for them was waste.
    const wantsDashboard = calls.some((name) =>
      DASHBOARD_TOOLS.has(name),
    );
    const scoped =
      period && wantsDashboard
        ? ((await getDashboard({
            from: period.from,
            to: period.to,
            view: "list",
          })) ?? dashboard)
        : dashboard;

    // Presentation choices for a display_chart call; the source falls back
    // to what the question is about when the argument didn't survive.
    let chartRequest: ChartRequest | undefined;
    if (calls.includes("display_chart")) {
      chartRequest = parseChartRequest(content);
      chartRequest.source ??= defaultChartSource(question.content);
      // "just the top 3" in the question stands in for a lost top_n arg.
      chartRequest.topN ??=
        Number(/\btop\s+(\d{1,2})\b/i.exec(question.content)?.[1]) || undefined;
    }

    messages.push({ role: "assistant", content });
    for (const name of calls) {
      // The model composed a chart itself. Only presentation is trusted:
      // the option is sanitized (JSON-only, size-capped, graphic/image/
      // tooltip stripped) before it is stored or rendered.
      if (name === "display_echart") {
        const args = extractJsonAfter(content, "display_echart");
        const argObject =
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : undefined;
        // The declared argument is a JSON string, which the sanitizer parses
        // itself; a model that hands over a bare object is understood too.
        const option = sanitizeEChartsOption(
          argObject && "option" in argObject ? argObject.option : argObject,
        );
        let result;
        if (!option) {
          result = {
            error:
              'No usable ECharts option found — pass {"display_echart": {"option": "{…}"}} as a JSON string with a "series" array.',
          };
        } else {
          chart = {
            kind: "echarts",
            title:
              typeof argObject?.title === "string"
                ? argObject.title.slice(0, 60)
                : undefined,
            option,
          };
          chartExplicit = true;
          result = {
            displayed: true,
            note: "The chart is now shown. Answer with its takeaway.",
          };
        }
        messages.push({
          role: "tool",
          content: JSON.stringify({ tool: name, result }),
        });
        toolRan = true;
        continue;
      }

      // The SQL escape hatch: the model's SELECT runs in a throwaway
      // in-memory database seeded with only this user's rows — see
      // lib/sql-sandbox.ts for the layers under that sentence.
      if (name === "run_sql") {
        const sql = extractSql(content);
        let result;
        if (!sql) {
          result = {
            error: 'No SQL found — pass {"run_sql": {"sql": "SELECT …"}}.',
          };
        } else {
          // Seed the sandbox with the SAME rows the rest of the app counts:
          // transfers excluded, and scoped to the resolved window so a
          // "last month" question is answered over last month even if the
          // model omits its own WHERE. Cache is keyed by window.
          const cacheKey = `${period?.from ?? ""}..${period?.to ?? ""}`;
          if (sandboxKey !== cacheKey) {
            sandboxRows = await listTransactions({
              from: period?.from,
              to: period?.to,
            });
            sandboxKey = cacheKey;
          }
          result = await runSandboxSql(sandboxRows ?? [], sql);
          // Only a query that actually ran counts: a "No SQL found" round
          // must leave the stall and prose-SQL heuristics armed, or the next
          // round's stall text becomes the final answer.
          toolRan = true;
        }
        messages.push({
          role: "tool",
          content: JSON.stringify({
            tool: name,
            period: period?.label ?? "all statements",
            result,
          }),
        });
        continue;
      }

      // The context tools read beyond the dashboard aggregate — stored scan
      // findings, the savings tables, the raw rows — so each fetches lazily,
      // only on the turn the model actually asks. All of them resolve the
      // account from the session, like every other read.
      if (name === "get_savings_potential") {
        // The unassigned figure comes from the same read the Savings page's
        // Unallocated pot uses, so the assistant and the pot can never quote
        // two different amounts; the category split stays on the scoped
        // dashboard, which is why this tool remains in DASHBOARD_TOOLS.
        const overview = await getSavingsOverview(goalMonthFor(period));
        messages.push({
          role: "tool",
          content: JSON.stringify({
            tool: name,
            result: savingsPotentialToolResult(scoped, overview, period),
          }),
        });
        toolRan = true;
        continue;
      }

      if (name === "get_subscriptions") {
        historyRows ??= await listTransactions({});
        messages.push({
          role: "tool",
          content: JSON.stringify({
            tool: name,
            result: subscriptionsToolResult(historyRows),
          }),
        });
        toolRan = true;
        continue;
      }

      if (name === "get_recent_anomalies") {
        messages.push({
          role: "tool",
          content: JSON.stringify({
            tool: name,
            result: anomaliesToolResult(await getAnomalyOverview()),
          }),
        });
        toolRan = true;
        continue;
      }

      if (name === "get_savings_goals") {
        const overview = await getSavingsOverview(goalMonthFor(period));
        // Latch the month the model is being SHOWN — the resolved one, after
        // getSavingsOverview's own validation — so a later propose_allocation
        // round lands on the same goals and free amount.
        goalsMonth = overview?.month ?? goalsMonth;
        messages.push({
          role: "tool",
          content: JSON.stringify({
            tool: name,
            result: savingsGoalsToolResult(overview),
          }),
        });
        toolRan = true;
        continue;
      }

      if (name === "propose_allocation") {
        // The model's split becomes a typed proposal only after validation
        // against the month's real free surplus; the Apply card renders what
        // survived, and the tool result tells the model the same final split.
        // Month precedence: a single-month period the model passed in THIS
        // round; else the month the last get_savings_goals call resolved
        // (what the model was shown); else the default. Re-deriving from
        // scratch here let a June goals fetch be followed by a proposal
        // silently validated against July.
        const explicitWindow = resolvePeriod(
          parsePeriod(content),
          dashboard.facets.last,
        );
        const explicitMonth =
          explicitWindow &&
          explicitWindow.from.slice(0, 7) === explicitWindow.to.slice(0, 7)
            ? explicitWindow.from.slice(0, 7)
            : undefined;
        const { proposal: built, result } = buildAllocationProposal(
          parseAllocationArgs(content),
          await getSavingsOverview(
            explicitMonth ?? goalsMonth ?? goalMonthFor(period),
          ),
        );
        if (built) proposal = built;
        messages.push({
          role: "tool",
          content: JSON.stringify({ tool: name, result }),
        });
        toolRan = true;
        continue;
      }

      const tool = runTool(
        name,
        scoped,
        period,
        name === "display_chart" ? chartRequest : undefined,
      );
      // A pie the model asked for wins; one that merely came along with a
      // data tool fills an empty slot and never overwrites a chosen chart.
      if (tool.chart) {
        if (name === "display_chart") {
          chart = tool.chart;
          chartExplicit = true;
        } else if (!chartExplicit) {
          chart = tool.chart;
        }
      }
      messages.push({
        role: "tool",
        content: JSON.stringify({ tool: name, result: tool.result }),
      });
      toolRan = true;
    }
  }

  if (!reply) {
    return (
      (await salvage()) ??
      failure("The model returned an empty answer — try asking again.")
    );
  }

  // Chart safety net. Two cases, both only when the model did not compose a
  // chart itself (an explicit one is never overridden — it may have chosen its
  // shape deliberately):
  //   1. the user named a bar/line chart → compose it from real aggregates;
  //   2. no chart came out but the question is about how the customer's money
  //      splits → attach a pie from real aggregates.
  // Both draw only figures the tools produce, scoped to the resolved window.
  const wantedType = wantsNonPieChart(question.content);
  const wantsDefaultChart = !chart && shouldDefaultChart(question.content);
  if (!chartExplicit && (wantedType || wantsDefaultChart)) {
    const window =
      lastPeriod ??
      resolvePeriod(
        periodFromQuestion(question.content) ?? defaultPeriod(question.content),
        dashboard.facets.last,
      );
    const scopedForChart = window
      ? ((await getDashboard({
          from: window.from,
          to: window.to,
          view: "list",
        })) ?? dashboard)
      : dashboard;
    if (wantedType) {
      chart =
        composeEChart(wantedType, question.content, scopedForChart, window) ??
        chart;
    } else {
      const source = defaultChartSource(question.content);
      chart =
        runTool(chartToolForSource(source), scopedForChart, window).chart ??
        chart;
    }
  }

  // Proposal safety net. The customer
  // explicitly asked to split a month's surplus, but no valid
  // propose_allocation call materialized (the model stalled after fetching
  // the goals, or mangled its arguments past saving). The app then proposes
  // the deterministic gap-proportional split itself, through the same
  // validator every Apply card goes through — an explicit ask for an action
  // should end in an actionable card, not in prose about one.
  if (
    !proposal &&
    routeTool(question.content) === "get_savings_goals" &&
    (/\b(split|allocat\w*|assign\w*|distribut\w*|verteil\w*|zuweis\w*|aufteil\w*)\b/i.test(
      question.content,
    ) ||
      /überschuss/i.test(question.content))
  ) {
    const overview = await getSavingsOverview(
      goalsMonth ?? goalMonthFor(lastPeriod),
    );
    const split = defaultAllocationSplit(overview);
    if (split.length > 0) {
      proposal = buildAllocationProposal(split, overview).proposal;
    }
  }

  return {
    reply,
    chart,
    proposal,
    followUps: await followUpsFor(history, proposedFollowUps),
  };
}

/**
 * The chips under the input.
 *
 * The model's own FOLLOWUP proposals lead; a turn without them falls back to
 * the starter questions — the same localized strings the empty state shows, so
 * the chips never invent a phrasing of their own. Either way, nothing already
 * asked in this conversation comes back around.
 *
 * Shared with the happy paths, which propose none: a paraphrase is one job,
 * and asking an 8B model for follow-up questions in the same breath is what
 * turns a clean two-sentence answer into a list. They take the fallback.
 */
async function followUpsFor(
  history: { role: "user" | "assistant"; content: string }[],
  proposed: string[],
): Promise<string[]> {
  const asked = history
    .filter((m) => m.role === "user")
    .map((m) => m.content.toLowerCase());
  const notAsked = (q: string) => !asked.includes(q.toLowerCase());
  const followUps = proposed.filter(notAsked).slice(0, 3);
  if (followUps.length > 0) return followUps;
  const t = await getTranslations("Chat");
  return SUGGESTION_KEYS.map((key) => t(key)).filter(notAsked);
}

/**
 * One turn of a happy path: fetch, render, and let the model do the wording.
 *
 * No loop, no tools, no period to spell — see the note at the top of
 * `lib/happy-path.ts` for why these questions are worth taking off the general
 * path. The shape is two steps:
 *
 *  1. the app fetches this recipe's data and renders it into a summary out of
 *     its own formatters, so every figure on the screen is a figure the
 *     dashboard would print;
 *  2. the model gets exactly one request — say that, in two or three
 *     sentences, in the reader's language.
 *
 * Step 2 is the only part that can fail, and when it does the rendered summary
 * IS the answer. That covers a timeout, a 500, a truncated reply, an invented
 * total (`keepsFigures`), and an unset GEMINI_API_KEY — which is why the caller
 * reaches this before the key check rather than after it.
 */
async function answerHappyPath({
  id,
  question,
  history,
  model,
  maxTokens,
  key,
  record,
}: {
  id: HappyPathId;
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
  model: string;
  maxTokens: number | undefined;
  key: string | undefined;
  record: (
    startedAt: number,
    patch: Partial<AssistantLogEntry> & { status: AssistantLogEntry["status"] },
  ) => void;
}): Promise<AssistantTurn> {
  const [phrase, categories, months] = await Promise.all([
    getTranslations("Chat.happy"),
    getTranslations("Categories"),
    getTranslations("Months"),
  ]);
  // `year` is the newest statement's, never the wall clock's — against a 2026
  // export read in 2027 a wall-clock year is an empty window. Recipes that are
  // not scoped to a year (the anomaly scan is about the whole account) leave
  // the default in place and never read it.
  const context = (year = ""): HappyContext => ({
    phrase: (message, values) => phrase(message, values),
    // A category the catalog does not know falls through as itself, exactly
    // as `useCategoryLabel` does on the client.
    label: (category) => (categories.has(category) ? categories(category) : category),
    monthName: (month) => monthLabel(months, month),
    year,
  });

  const expired = () =>
    failure("Your session has expired — sign in again to keep chatting.");

  /** The account's aggregate, plus the same aggregate re-scoped to the newest
   * statement year — the assistant's stated default window. Two reads of ~930
   * rows through a synchronous driver, which is what the tool loop pays for
   * the same scoping. */
  const scopedDashboard = async () => {
    const whole = await getDashboard({ view: "list" });
    if (!whole) return undefined;
    const year = whole.facets.last.slice(0, 4);
    const scoped =
      (await getDashboard({
        from: `${year}-01-01`,
        to: whole.facets.last,
        view: "list",
      })) ?? whole;
    return { whole, scoped, year };
  };

  let summary: HappySummary;
  // The one happy path with a picture in it. The category split is the
  // question a pie answers best, and the chart comes out of the same scoped
  // dashboard the summary is rendered from — so it costs no extra read and
  // cannot show a figure the sentence does not. The advice recipes stay
  // words-only, for the reason `shouldDefaultChart` keeps them off the pie.
  let chart: ChartSpec | undefined;
  switch (id) {
    case "recent_spending": {
      // Unscoped and unfiltered: "my last ten" means the last ten there are,
      // whichever month they fall in.
      const rows = await listTransactions({});
      summary = recentSpendingSummary(
        rows,
        recentCount(question),
        context(rows[0]?.bookedOn.slice(0, 4)),
      );
      break;
    }
    case "anomalies": {
      summary = anomaliesSummary(await getAnomalyOverview(), context());
      break;
    }
    case "subscriptions": {
      // The whole history, never a year: a year-to-date window demotes every
      // yearly bill, which is the same reason the tool loop fetches these rows
      // unscoped.
      const rows = await listTransactions({});
      summary = subscriptionsSummary(rows, context(rows[0]?.bookedOn.slice(0, 4)));
      break;
    }
    case "savings_potential": {
      const dashboards = await scopedDashboard();
      if (!dashboards) return expired();
      const { whole, scoped, year } = dashboards;
      // The month the surplus is about: the newest statement month when it is
      // already over (statements that simply end in July, read in August), and
      // only otherwise the month before it — `goalMonthFor`'s rule, without a
      // period to override it.
      const anchor = whole.facets.last.slice(0, 7);
      const month = monthHasEnded(anchor)
        ? anchor
        : resolvePeriod("last_month", whole.facets.last)?.from.slice(0, 7);
      summary = savingsPotentialSummary(
        scoped,
        await getSavingsOverview(month),
        context(year),
      );
      break;
    }
    case "spending_by_category": {
      const dashboards = await scopedDashboard();
      if (!dashboards) return expired();
      summary = categorySummary(dashboards.scoped, context(dashboards.year));
      chart = runTool(
        "get_spending_by_category",
        dashboards.scoped,
        resolvePeriod("ytd", dashboards.whole.facets.last),
      ).chart;
      break;
    }
  }

  const text = renderSummary(summary);
  const followUps = await followUpsFor(history, []);
  if (!key) {
    record(Date.now(), {
      status: "ok",
      note: `happy path · ${id} · no key, summary served`,
    });
    return { reply: text, chart, followUps };
  }
  const reply = await paraphrase({
    id,
    question,
    text,
    model,
    maxTokens,
    key,
    record,
  });
  return { reply: reply ?? text, chart, followUps };
}

/**
 * The model's only job on a happy path. One request, no tools, no history:
 * the question and the rendered summary go in, prose comes out.
 *
 * Returns nothing rather than throwing on every failure mode — the caller
 * already holds a correct answer, so there is no error to report and nothing
 * to retry. A reply is dropped when it is too short to be an answer, or when
 * `keepsFigures` finds an amount in it that the summary never stated: on a
 * screen of real francs one invented one is worse than a plainer sentence.
 */
async function paraphrase({
  id,
  question,
  text,
  model,
  maxTokens,
  key,
  record,
}: {
  id: HappyPathId;
  question: string;
  text: string;
  model: string;
  maxTokens: number | undefined;
  key: string;
  record: (
    startedAt: number,
    patch: Partial<AssistantLogEntry> & { status: AssistantLogEntry["status"] },
  ) => void;
}): Promise<string | undefined> {
  const body = toGeminiBody({
    model,
    messages: [
      {
        role: "system",
        content: paraphrasePromptFor(languageName(await getLocale())),
      },
      { role: "user", content: `${question}\n\n${text}` },
    ],
    // No tool round to budget for, and no FOLLOWUP lines to parse out — the
    // chips fall back to the starters. A paraphrase of a fixed summary is a
    // short completion; +40 is the slack for a longer language's wording.
    ...(maxTokens !== undefined ? { maxTokens: maxTokens + 40 } : {}),
  });
  const startedAt = Date.now();
  const request = truncateSnapshot(JSON.stringify(body, null, 2));

  let response: Response;
  let raw: string;
  try {
    response = await fetch(geminiEndpoint(model), {
      method: "POST",
      headers: geminiHeaders(key),
      body: JSON.stringify(body),
      // Shorter than the loop's 60s on purpose: the fallback here is instant
      // and already correct, so a slow endpoint should cost the wording
      // rather than the answer.
      signal: AbortSignal.timeout(30_000),
    });
    raw = await response.text();
  } catch (cause) {
    record(startedAt, {
      status: "error",
      error:
        cause instanceof Error && cause.name === "TimeoutError"
          ? "Paraphrase timed out after 30s."
          : "Paraphrase fetch failed — endpoint unreachable.",
      note: `happy path · ${id} · summary served`,
      messageCount: 2,
      request,
    });
    return undefined;
  }

  const snapshot = truncateSnapshot(raw);
  if (!response.ok) {
    record(startedAt, {
      status: "error",
      httpStatus: response.status,
      error: `Upstream answered ${response.status}.`,
      note: `happy path · ${id} · summary served`,
      messageCount: 2,
      request,
      response: snapshot,
    });
    return undefined;
  }

  let data: GeminiResponse;
  try {
    data = JSON.parse(raw);
  } catch {
    record(startedAt, {
      status: "error",
      httpStatus: response.status,
      error: "Upstream body was not JSON.",
      note: `happy path · ${id} · summary served`,
      messageCount: 2,
      request,
      response: snapshot,
    });
    return undefined;
  }

  const usage = geminiUsage(data);
  const content = geminiText(data);
  // FOLLOWUP lines are not asked for here, but a model that has seen the other
  // prompt sometimes writes them anyway; stripping is cheaper than explaining.
  const cleaned = formatSwissNumbers(
    extractFollowUps(stripModelMarkup(content)).text,
  ).trim();

  // Twenty characters is below any real answer in either language and above
  // the "Sure!" a truncated completion leaves behind.
  const tooShort = cleaned.length < 20;
  const invented = !keepsFigures(cleaned, text);
  if (tooShort || invented) {
    record(startedAt, {
      status: "error",
      httpStatus: response.status,
      error: tooShort
        ? "Paraphrase was too short to be an answer."
        : "Paraphrase stated an amount the summary did not.",
      note: `happy path · ${id} · summary served`,
      messageCount: 2,
      request,
      response: snapshot,
      usage,
    });
    return undefined;
  }

  record(startedAt, {
    status: "ok",
    httpStatus: response.status,
    note: `happy path · ${id} · paraphrased`,
    messageCount: 2,
    request,
    response: snapshot,
    usage,
  });
  return cleaned;
}

/** Where the calls go and under what caps — the header of the debug panel,
 * which otherwise says nothing at all until a turn has been logged. The API
 * key is deliberately not part of it, the same way the request snapshots
 * never carry the X-goog-api-key header. */
export async function getAssistantConfig(): Promise<AssistantConfigView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    url: geminiEndpoint(geminiModel()),
    model: geminiModel(),
    maxTokens: assistantMaxTokens(),
  };
}

/** The current user's recent assistant calls, newest first. */
export async function getAssistantLog(): Promise<AssistantLogView[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return listAssistantLog(user.id);
}

export async function clearAssistantLogAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  clearAssistantLog(user.id);
}
