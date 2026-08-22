"use server";

import { getLocale, getTranslations } from "next-intl/server";

import { getAnomalyOverview } from "@/app/actions/anomalies";
import { getSavingsOverview } from "@/app/actions/savings";
import { getDashboard, listTransactions } from "@/app/actions/transactions";
import {
  anomaliesToolResult,
  buildAllocationProposal,
  defaultAllocationSplit,
  defaultPeriod,
  extractFollowUps,
  extractSql,
  formatSwissNumbers,
  looksLikeStall,
  parseAllocationArgs,
  parsePeriod,
  parseToolCalls,
  periodFromQuestion,
  resolvePeriod,
  routeTool,
  runTool,
  savingsGoalsToolResult,
  savingsPotentialToolResult,
  stripModelMarkup,
  subscriptionsToolResult,
  systemPromptFor,
  SUGGESTION_KEYS,
  TOOL_DEFINITIONS,
  type AllocationProposal,
  type AssistantTurn,
  type Period,
  type WireMessage,
} from "@/lib/assistant";
import { runSandboxSql } from "@/lib/sql-sandbox";
import {
  clearAssistantLog,
  listAssistantLog,
  pushAssistantLog,
  truncateSnapshot,
  type AssistantLogEntry,
  type AssistantLogView,
} from "@/lib/assistant-log";
import { getCurrentUser } from "@/lib/auth";
import { monthHasEnded } from "@/lib/clock";

const APERTUS_URL =
  process.env.APERTUS_URL ?? "https://llm.stoney-cloud.com/v1/chat/completions";

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
]);

/**
 * One turn of the chat, as a tool-calling loop. The model starts with no
 * figures at all: it requests data through the tools in `lib/assistant.ts`,
 * and each request is answered from the account's real aggregates. Raw
 * transaction rows never leave the server, and the assistant draws nothing —
 * the dashboard's own charts carry the visuals.
 *
 * The endpoint accepts OpenAI `tools` but leaves Apertus's native call
 * syntax in the content instead of populating `tool_calls`, so calls are
 * parsed by name here and results go back as `tool`-role messages.
 *
 * Returns an `AssistantTurn` directly rather than the `ActionResult` envelope:
 * like the reads in `transactions.ts`, a failed turn is rendered in place (as
 * a chat bubble), not raised as a toast.
 *
 * Every API request is recorded to the in-memory debug log — a turn with tool
 * rounds shows up as several entries. The Authorization header is never part
 * of the snapshot.
 */
export async function askAssistant(rawHistory: unknown): Promise<AssistantTurn> {
  const user = await getCurrentUser();
  if (!user) {
    return failure("Your session has expired — sign in again to keep chatting.");
  }

  const turnStarted = Date.now();
  const model = process.env.MODEL ?? "apertus-ai/Apertus-v1.5-8B";
  // Unset (or unparseable, or 0) means "no cap": the request then carries no
  // max_tokens at all and the endpoint's own default applies.
  const maxTokens =
    Number.parseInt(process.env.MAX_TOKENS ?? "", 10) || undefined;

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

  const key = process.env.APERTUS_KEY;
  if (!key) {
    record(turnStarted, { status: "error", error: "APERTUS_KEY is not set." });
    return failure(
      "The assistant is not configured yet. Set APERTUS_KEY in .env.local and restart the server.",
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
    // Older turns only pad the context window of an 8B model.
    ...history.slice(-8),
  ];
  // A validated surplus split from propose_allocation, if the model made one.
  let proposal: AllocationProposal | undefined;
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
    if (!proposal) return undefined;
    const t = await getTranslations("Chat");
    return { reply: t("partialReply"), proposal };
  };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const offerTools = round < MAX_ROUNDS;
    const body = {
      model,
      messages,
      // MAX_TOKENS caps the visible answer; the +80 is the budget for the
      // FOLLOWUP: lines parsed out of it. Tool rounds get a higher floor —
      // a truncated SQL statement or allocation array is an unusable one.
      // Without MAX_TOKENS the key is omitted and the endpoint decides.
      ...(maxTokens !== undefined
        ? {
            max_tokens: offerTools
              ? Math.max(maxTokens + 80, 700)
              : maxTokens + 80,
          }
        : {}),
      ...(offerTools ? { tools: TOOL_DEFINITIONS } : {}),
    };
    const startedAt = Date.now();
    const request = truncateSnapshot(JSON.stringify(body, null, 2));
    const messageCount = messages.length;

    let response: Response;
    let raw: string;
    try {
      response = await fetch(APERTUS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      raw = await response.text();
    } catch (cause) {
      record(startedAt, {
        status: "error",
        error:
          cause instanceof Error && cause.name === "TimeoutError"
            ? "Request timed out after 30s."
            : "Fetch failed — endpoint unreachable.",
        note: `round ${round}`,
        messageCount,
        request,
      });
      return (
        (await salvage()) ??
        failure(
          "Could not reach llm.stoney-cloud.com — check the connection and try again.",
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
          response.status === 401
            ? "The model endpoint rejected the API key — check APERTUS_KEY."
            : `The model endpoint answered ${response.status} — try again in a moment.`,
        )
      );
    }

    let data: {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
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

    const usage = data.usage && {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    };
    const content = data.choices?.[0]?.message?.content ?? "";
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
          : `round ${round} · answer`,
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

    messages.push({ role: "assistant", content });
    for (const name of calls) {
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

      const tool = runTool(name, scoped, period);
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

  // The model's own FOLLOWUP proposals lead; a turn without them falls back
  // to the four starter questions — the same localized strings the empty
  // state shows, so the chips never invent a fifth phrasing. Either way,
  // nothing already asked in this conversation comes back around.
  const asked = history
    .filter((m) => m.role === "user")
    .map((m) => m.content.toLowerCase());
  const notAsked = (q: string) => !asked.includes(q.toLowerCase());
  let followUps = proposedFollowUps.filter(notAsked).slice(0, 3);
  if (followUps.length === 0) {
    const t = await getTranslations("Chat");
    followUps = SUGGESTION_KEYS.map((key) => t(key)).filter(notAsked);
  }

  return { reply, proposal, followUps };
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
