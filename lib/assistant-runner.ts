/**
 * The assistant's tool-calling loop, shared by the server action in
 * `app/actions/chat.ts` and the streaming route in `app/api/assistant`.
 *
 * Written as an async generator so both callers run the *same* loop: the
 * route forwards every event to the browser, the action drains it and keeps
 * the last one. Nothing about the loop knows which it is.
 *
 * The model starts with no figures at all: it requests data through the tools
 * in `lib/assistant.ts`, and each request is answered from the account's real
 * aggregates. Raw transaction rows never leave the server, and the assistant
 * draws nothing — the dashboard's own charts carry the visuals.
 *
 * Calls arrive as real OpenAI `tool_calls` with parsed arguments; nothing here
 * reads the model's prose for them. See the note in `lib/assistant.ts` about
 * why the system prompt must never show the call syntax inline.
 */
import "server-only";

import { getTranslations } from "next-intl/server";

import { getAnomalyOverview } from "@/app/actions/anomalies";
import { getSavingsOverview } from "@/app/actions/savings";
import { getDashboard, listTransactions } from "@/app/actions/transactions";
import {
  allocationsFrom,
  anomaliesToolResult,
  asToolName,
  buildAllocationProposal,
  defaultAllocationSplit,
  defaultPeriod,
  extractFollowUps,
  formatSwissNumbers,
  numbersIn,
  parseToolArguments,
  periodArgument,
  periodFromQuestion,
  plumbingAt,
  resolvePeriod,
  routeTool,
  runTool,
  savingsGoalsToolResult,
  savingsPotentialToolResult,
  showsPlumbing,
  sqlArgument,
  stripReasoning,
  subscriptionsToolResult,
  systemPromptFor,
  toolNamesIn,
  unverifiedAmounts,
  SUGGESTION_KEYS,
  TOOL_DEFINITIONS,
  type AllocationProposal,
  type AssistantTurn,
  type Period,
  type ToolCall,
  type WireMessage,
} from "@/lib/assistant";
import { normalizeHistory } from "@/lib/assistant-history";
import {
  pushAssistantLog,
  truncateSnapshot,
  type AssistantLogEntry,
} from "@/lib/assistant-log";
import { getCurrentUser } from "@/lib/auth";
import { monthHasEnded } from "@/lib/clock";
import { runSandboxSql } from "@/lib/sql-sandbox";

/**
 * The chat may run on a different model, and therefore a different endpoint,
 * than the anomaly narrator and the icon picker — those two ask for
 * `response_format: json_object`, which the onprem.ai gateway mangles (it
 * prefixes a stray `{"`, making every reply unparseable). All three fall back
 * to the shared APERTUS_* variables, so an unset CHAT_* keeps the old
 * behaviour exactly.
 */
const CHAT_URL = () =>
  process.env.CHAT_URL ??
  process.env.APERTUS_URL ??
  "https://llm.stoney-cloud.com/v1/chat/completions";
const CHAT_KEY = () => process.env.CHAT_KEY ?? process.env.APERTUS_KEY;
const CHAT_MODEL = () =>
  process.env.CHAT_MODEL ?? process.env.MODEL ?? "apertus-ai/Apertus-v1.5-8B";

/** API requests per turn. Tools are offered on all but the last, which forces
 * an answer so a fetch-happy model cannot loop forever. Five, not four: a
 * goals-then-proposal answer legitimately takes three tool rounds. */
const MAX_ROUNDS = 5;

/**
 * Re-asks that do not spend a round: an empty reply, a reply that is really a
 * tool call typed out as prose, a reply quoting francs no tool returned, and
 * an upstream 5xx. Two per turn, which is as many as have ever been needed.
 */
const MAX_RETRIES = 2;

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

export type TurnEvent =
  /** A fragment of the visible answer. */
  | { type: "delta"; text: string }
  /** Discard what was streamed — the round turned out to be a tool round. */
  | { type: "reset" }
  /** The finished turn, proposal and follow-ups included. Always last. */
  | { type: "done"; turn: AssistantTurn };

function failure(reply: string): AssistantTurn {
  return { reply, error: true };
}

/** One upstream reply, however it arrived. */
type Completion = {
  content: string;
  toolCalls: ToolCall[];
  usage?: { promptTokens?: number; completionTokens?: number };
  /** What the debug log shows for this round. */
  snapshot: string;
};

type Usage = { prompt_tokens?: number; completion_tokens?: number };

/** Non-streaming body → Completion. */
function readCompletion(raw: string): Completion {
  const data = JSON.parse(raw) as {
    choices?: {
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: ToolCall[] | null;
      };
    }[];
    usage?: Usage;
  };
  const message = data.choices?.[0]?.message;
  return {
    // `reasoning_content` is dropped rather than concatenated: it is the
    // model's scratchpad, and it is never part of the answer.
    content: message?.content ?? "",
    toolCalls: message?.tool_calls ?? [],
    usage: data.usage && {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    },
    snapshot: truncateSnapshot(raw),
  };
}

type StreamChunk = {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  usage?: Usage;
};

/**
 * Read an SSE completion, reassembling the pieces OpenAI-compatible servers
 * split across chunks: `content` arrives token by token, and a tool call's
 * name and arguments arrive as fragments keyed by `index`.
 *
 * `onDelta` fires only for content that is going to be part of the answer —
 * once a tool call appears in the stream the round is a tool round, and the
 * caller is told to discard whatever it already showed.
 */
async function readStreamedCompletion(
  response: Response,
  onDelta: (text: string) => void,
  onReset: () => void,
): Promise<Completion> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Upstream returned no body.");
  const decoder = new TextDecoder();

  let buffer = "";
  let content = "";
  let usage: Completion["usage"];
  const partials = new Map<number, { id: string; name: string; args: string }>();
  let streamed = false;

  const handle = (payload: string): void => {
    if (payload === "[DONE]") return;
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(payload) as StreamChunk;
    } catch {
      return; // A keep-alive, or a fragment we cannot use.
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
      };
    }
    const delta = chunk.choices?.[0]?.delta;

    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0;
      const partial = partials.get(index) ?? { id: "", name: "", args: "" };
      if (call.id) partial.id = call.id;
      if (call.function?.name) partial.name += call.function.name;
      if (call.function?.arguments) partial.args += call.function.arguments;
      partials.set(index, partial);
      // Anything already shown was preamble to a call, not the answer.
      if (streamed) {
        streamed = false;
        content = "";
        onReset();
      }
    }

    const text = delta?.content;
    if (text) {
      content += text;
      if (partials.size === 0) {
        streamed = true;
        onDelta(text);
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are blank-line delimited; \r\n\r\n for servers that use it.
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(buffer);
      if (!boundary) break;
      const event = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      for (const line of event.split(/\r?\n/)) {
        if (line.startsWith("data:")) handle(line.slice(5).trim());
      }
    }
  }

  const toolCalls: ToolCall[] = [...partials.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, partial]) => ({
      id: partial.id || `call_${index}`,
      type: "function" as const,
      function: { name: partial.name, arguments: partial.args },
    }));

  return {
    content,
    toolCalls,
    usage,
    snapshot: truncateSnapshot(
      JSON.stringify({ streamed: true, content, tool_calls: toolCalls, usage }, null, 2),
    ),
  };
}

/**
 * One turn of the chat. Yields the answer as it arrives when `stream` is set,
 * and always ends with exactly one `done` event carrying the whole turn.
 *
 * Every API request is recorded to the in-memory debug log — a turn with tool
 * rounds shows up as several entries. The Authorization header is never part
 * of the snapshot.
 */
export async function* runAssistantTurn(options: {
  rawHistory: unknown;
  locale: string;
  stream?: boolean;
}): AsyncGenerator<TurnEvent, void, void> {
  const { rawHistory, locale, stream = false } = options;

  const user = await getCurrentUser();
  if (!user) {
    yield {
      type: "done",
      turn: failure("Your session has expired — sign in again to keep chatting."),
    };
    return;
  }

  const turnStarted = Date.now();
  const model = CHAT_MODEL();
  // Unset (or unparseable, or 0) means "no cap": the request then carries no
  // max_tokens at all and the endpoint's own default applies.
  const maxTokens = Number.parseInt(process.env.MAX_TOKENS ?? "", 10) || undefined;

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
    yield {
      type: "done",
      turn: failure("That message could not be read — try rephrasing it."),
    };
    return;
  }

  const key = CHAT_KEY();
  if (!key) {
    record(turnStarted, { status: "error", error: "CHAT_KEY / APERTUS_KEY is not set." });
    yield {
      type: "done",
      turn: failure(
        "The assistant is not configured yet. Set CHAT_KEY in .env.local and restart the server.",
      ),
    };
    return;
  }

  // `view: "list"` explicitly: the dashboard's default is the calendar, and
  // building its per-day aggregates costs an account-wide anomaly read that no
  // chat turn has any use for.
  const dashboard = await getDashboard({ view: "list" });
  if (!dashboard) {
    record(turnStarted, { status: "error", error: "Session expired mid-turn." });
    yield {
      type: "done",
      turn: failure("Your session has expired — sign in again to keep chatting."),
    };
    return;
  }

  /**
   * Both corrective nudges below go back as `user` turns, not `system` ones:
   * llm.stoney-cloud.com answers "Invalid message role" (400) to a system
   * message anywhere but the front of the conversation.
   */
  const ANSWER_NOW =
    "Answer now, in prose, using only the figures already returned above. You have no tools this turn: do not announce, describe, or propose any action, and do not name any tool or field — state what the figures show, in the customer's words.";
  // The wording matters. An earlier version asked the model to "say which
  // figure you do not have", and it obliged by quoting the field names it had
  // been given (`net_saved_chf`, `flexible_spending_chf`) — trading an invented
  // figure for a reply full of schema, which `showsPlumbing` then rejected in
  // turn. Ask for the corrected answer, nothing else.
  const FIGURES_INVENTED = (amounts: string[]): string =>
    `These amounts were never returned by any tool: ${amounts.join(", ")}. Reply again with the same answer, using only figures copied exactly from the tool results above and simply leaving out anything you cannot support. Do not explain the correction, do not apologise, and never write a field name — the customer sees only your answer.`;

  const messages: WireMessage[] = [
    { role: "system", content: systemPromptFor(locale) },
    // Older turns only pad the context window.
    ...history.slice(-8),
  ];
  // A validated surplus split from propose_allocation, if the model made one.
  let proposal: AllocationProposal | undefined;
  let reply: string | undefined;
  let proposedFollowUps: string[] = [];
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
  /** Every figure the tools have handed over this turn — see `unverifiedAmounts`. */
  const figuresSeen = new Set<string>();
  let retries = 0;
  // Set when a round has to be re-asked as prose: withholding the tools is
  // what stops the model writing another call instead of an answer.
  let forceAnswer = false;

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
    const t = await getTranslations({ locale, namespace: "Chat" });
    return { reply: t("partialReply"), proposal };
  };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const offerTools = round < MAX_ROUNDS && !forceAnswer;
    const body = {
      model,
      messages,
      // MAX_TOKENS caps the visible answer; the +80 is the budget for the
      // FOLLOWUP: lines parsed out of it. Tool rounds get a higher floor —
      // a truncated SQL statement or allocation array is an unusable one.
      // Without MAX_TOKENS the key is omitted and the endpoint decides.
      ...(maxTokens !== undefined
        ? {
            max_tokens: offerTools ? Math.max(maxTokens + 80, 700) : maxTokens + 80,
          }
        : {}),
      // Low, like the anomaly narrator's. The model picks the right tool and
      // copies figures reliably at 0.2 and wanders at the server default — on
      // one recorded turn it answered a day-of-week question with the merchant
      // breakdown.
      temperature: 0.2,
      // No `tool_choice`: the onprem.ai gateway answers "required" with a null
      // tool_calls array, and a named function prefixes the arguments with a
      // <|tools_prefix|> token. The default is the only setting that works on
      // both endpoints.
      ...(offerTools ? { tools: TOOL_DEFINITIONS } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
    const startedAt = Date.now();
    const request = truncateSnapshot(JSON.stringify(body, null, 2));
    const messageCount = messages.length;

    let completion: Completion;
    try {
      const response = await fetch(CHAT_URL(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      // The gateway 502s intermittently under back-to-back requests, and a
      // turn that dies on one is a demo that dies on one. Retried on 5xx
      // only — a 401 or a 400 will say the same thing twice.
      if (response.status >= 500 && retries < MAX_RETRIES) {
        retries += 1;
        record(startedAt, {
          status: "error",
          httpStatus: response.status,
          error: `Upstream answered ${response.status}; retrying.`,
          note: `round ${round}`,
          messageCount,
          request,
        });
        await new Promise((resolve) => setTimeout(resolve, 750));
        round -= 1;
        continue;
      }

      if (!response.ok) {
        const snapshot = truncateSnapshot(await response.text());
        record(startedAt, {
          status: "error",
          httpStatus: response.status,
          error: `Upstream answered ${response.status}.`,
          note: `round ${round}`,
          messageCount,
          request,
          response: snapshot,
        });
        yield {
          type: "done",
          turn:
            (await salvage()) ??
            failure(
              response.status === 401
                ? "The model endpoint rejected the API key — check CHAT_KEY."
                : `The model endpoint answered ${response.status} — try again in a moment.`,
            ),
        };
        return;
      }

      if (stream) {
        // The generator cannot yield from inside the reader's callbacks, so
        // deltas are queued here and drained after the round completes. The
        // stream is still incremental to the browser — the route's writer
        // pulls as fast as this loop yields.
        const queued: TurnEvent[] = [];
        completion = await readStreamedCompletion(
          response,
          (text) => queued.push({ type: "delta", text }),
          () => queued.splice(0, queued.length, { type: "reset" }),
        );
        yield* queued;
      } else {
        completion = readCompletion(await response.text());
      }
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      record(startedAt, {
        status: "error",
        error: timedOut
          ? "Request timed out after 30s."
          : `Upstream reply unusable: ${cause instanceof Error ? cause.message : "unknown"}`,
        note: `round ${round}`,
        messageCount,
        request,
      });
      yield {
        type: "done",
        turn:
          (await salvage()) ??
          failure(
            timedOut
              ? "The model took too long to answer — try asking again."
              : "The model returned an unreadable answer — try again.",
          ),
      };
      return;
    }

    const { content, toolCalls } = completion;
    const calls = offerTools ? toolCalls : [];
    const names = toolNamesIn(calls);
    // Arguments parsed once per call and reused: the period below and the
    // per-tool handling further down read the same objects.
    const args = calls.map((call) => parseToolArguments(call.function?.arguments));

    // Time scope, first-RESOLVABLE-wins: the model's period argument, then a
    // period the question itself names ("in March", "last 3 months"), then
    // the year-to-date default. Each candidate is resolved before it wins —
    // taking the first truthy string let an off-enum token ("recent",
    // "everything") eat the whole chain and silently widen the window to the
    // full history. Relative periods anchor to the newest statement date.
    const last = dashboard.facets.last;
    const period =
      names.length > 0
        ? (args.reduce<Period | undefined>(
            (found, one) => found ?? resolvePeriod(periodArgument(one), last),
            undefined,
          ) ??
          resolvePeriod(periodFromQuestion(question.content), last) ??
          resolvePeriod(defaultPeriod(question.content), last))
        : undefined;
    if (period) lastPeriod = period;

    record(startedAt, {
      status: "ok",
      httpStatus: 200,
      note:
        names.length > 0
          ? `round ${round} · called ${names.join(", ")}${period ? ` · ${period.label}` : ""}`
          : `round ${round} · answer`,
      messageCount,
      request,
      response: completion.snapshot,
      usage: completion.usage,
    });

    if (names.length === 0) {
      // Normalize before anything reads the text. Swiss grouping first: the
      // model writes "10,150.15" often enough that a verifier working on the
      // raw string would read "150.15" out of it and call a correct figure
      // invented. Then the follow-ups come off, so a FOLLOWUP: line quoting a
      // number is not mistaken for the answer quoting one.
      const extracted = extractFollowUps(formatSwissNumbers(stripReasoning(content)));
      let visible = extracted.text.trim();

      // Two ways a round can come back without an answer in it: empty (a call
      // cut off at max_tokens), or a call the model typed out as text. Both
      // are re-asked with the tools withheld, which leaves prose as the only
      // thing left to produce. The retry does not spend a round.
      if ((!visible || showsPlumbing(visible)) && retries < MAX_RETRIES) {
        retries += 1;
        if (!forceAnswer) messages.push({ role: "user", content: ANSWER_NOW });
        forceAnswer = true;
        round -= 1;
        continue;
      }

      // Every franc on screen has to have come off the customer's statements.
      // The model quotes one it was never given on a minority of turns, most
      // readily when it fetched nothing at all.
      const invented = unverifiedAmounts(visible, figuresSeen);
      if (invented.length > 0 && retries < MAX_RETRIES) {
        retries += 1;
        messages.push({ role: "assistant", content: visible });
        messages.push({ role: "user", content: FIGURES_INVENTED(invented) });
        forceAnswer = true;
        round -= 1;
        continue;
      }
      if (invented.length > 0) {
        // Still quoting figures it was not given. Drop the sentences carrying
        // them; if that leaves nothing to say, say nothing rather than
        // something wrong.
        const kept = visible
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => unverifiedAmounts(sentence, figuresSeen).length === 0)
          .join(" ")
          .trim();
        if (kept.length < 40) {
          record(turnStarted, {
            status: "error",
            error: `Reply quoted figures no tool returned: ${invented.join(", ")}`,
            note: `round ${round}`,
          });
          yield {
            type: "done",
            turn:
              (await salvage()) ??
              failure(
                "The model could not answer that from your statements — try asking again.",
              ),
          };
          return;
        }
        visible = kept;
      }

      const plumbing = plumbingAt(visible);
      if (plumbing >= 0) {
        // It did it again. Keep whatever stands before the plumbing if that
        // is an answer on its own — on these turns the tool talk is a
        // trailing suggestion after a good paragraph — and give up otherwise
        // rather than show the reader a JSON object with invented figures.
        const kept = visible.slice(0, plumbing).replace(/[^.!?]*$/, "").trim();
        if (kept.length < 40) {
          record(turnStarted, {
            status: "error",
            error: "Model answered with a tool call instead of prose.",
            note: `round ${round}`,
          });
          yield {
            type: "done",
            turn:
              (await salvage()) ??
              failure("The model did not answer that one — try asking again."),
          };
          return;
        }
        visible = kept;
      }

      reply = visible;
      proposedFollowUps = extracted.followUps;
      break;
    }

    // Aggregates scoped to the window come from a second, filtered fetch —
    // the same query path the dashboard itself uses. Only when a called tool
    // actually reads the dashboard: the context tools (SQL, anomalies,
    // subscriptions, savings) resolve their own data, and paying a full
    // filtered fetch for them was waste.
    const wantsDashboard = names.some((name) => DASHBOARD_TOOLS.has(name));
    const scoped =
      period && wantsDashboard
        ? ((await getDashboard({
            from: period.from,
            to: period.to,
            view: "list",
          })) ?? dashboard)
        : dashboard;

    // The assistant message goes back carrying its calls, and every result
    // below quotes the id it answers — an endpoint that sees a tool message
    // whose id it never issued rejects the round.
    //
    // The arguments are re-serialized rather than echoed verbatim, for two
    // reasons. The honest one: they describe the call that actually ran, so
    // the period here matches the period in the result below. The forced one:
    // the onprem.ai gateway answers "Invalid tool call" (400) to an echoed
    // call whose arguments are `{}` or empty — which is every call to a tool
    // whose only argument is the optional period, i.e. most of them.
    messages.push({
      role: "assistant",
      content,
      tool_calls: calls.map((call, index) => ({
        ...call,
        function: {
          ...call.function,
          arguments: JSON.stringify({
            ...args[index],
            period: period?.label ?? "all statements",
          }),
        },
      })),
    });

    for (const [index, call] of calls.entries()) {
      const name = asToolName(call.function?.name);
      const callArgs = args[index] ?? {};
      const answer = (result: unknown, withPeriod = true): void => {
        const content = JSON.stringify({
          tool: name,
          ...(withPeriod ? { period: period?.label ?? "all statements" } : {}),
          result,
        });
        for (const figure of numbersIn(content)) figuresSeen.add(figure);
        messages.push({ role: "tool", tool_call_id: call.id, content });
      };

      if (!name) {
        // A call for something we do not serve. Say so rather than dropping
        // it: a tool message is owed for every id, or the next round 400s.
        answer({ error: `Unknown tool "${call.function?.name ?? ""}".` });
        continue;
      }

      // The SQL escape hatch: the model's SELECT runs in a throwaway
      // in-memory database seeded with only this user's rows — see
      // lib/sql-sandbox.ts for the layers under that sentence.
      if (name === "run_sql") {
        const sql = sqlArgument(callArgs);
        if (!sql) {
          answer({ error: 'No SQL found — pass {"sql": "SELECT …"}.' });
          continue;
        }
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
        answer(await runSandboxSql(sandboxRows ?? [], sql));
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
        answer(savingsPotentialToolResult(scoped, overview, period), false);
        continue;
      }

      if (name === "get_subscriptions") {
        historyRows ??= await listTransactions({});
        answer(subscriptionsToolResult(historyRows), false);
        continue;
      }

      if (name === "get_recent_anomalies") {
        answer(anomaliesToolResult(await getAnomalyOverview()), false);
        continue;
      }

      if (name === "get_savings_goals") {
        const overview = await getSavingsOverview(goalMonthFor(period));
        // Latch the month the model is being SHOWN — the resolved one, after
        // getSavingsOverview's own validation — so a later propose_allocation
        // round lands on the same goals and free amount.
        goalsMonth = overview?.month ?? goalsMonth;
        answer(savingsGoalsToolResult(overview), false);
        continue;
      }

      if (name === "propose_allocation") {
        // The model's split becomes a typed proposal only after validation
        // against the month's real free surplus; the Apply card renders what
        // survived, and the tool result tells the model the same final split.
        // Month precedence: a single-month period the model passed in THIS
        // call; else the month the last get_savings_goals call resolved (what
        // the model was shown); else the default. Re-deriving from scratch
        // here let a June goals fetch be followed by a proposal silently
        // validated against July.
        const explicitWindow = resolvePeriod(periodArgument(callArgs), last);
        const explicitMonth =
          explicitWindow &&
          explicitWindow.from.slice(0, 7) === explicitWindow.to.slice(0, 7)
            ? explicitWindow.from.slice(0, 7)
            : undefined;
        const { proposal: built, result } = buildAllocationProposal(
          allocationsFrom(callArgs),
          await getSavingsOverview(explicitMonth ?? goalsMonth ?? goalMonthFor(period)),
        );
        if (built) proposal = built;
        answer(result, false);
        continue;
      }

      answer(runTool(name, scoped, period).result);
    }
  }

  if (!reply) {
    yield {
      type: "done",
      turn:
        (await salvage()) ??
        failure("The model returned an empty answer — try asking again."),
    };
    return;
  }

  // Proposal safety net. The customer explicitly asked to split a month's
  // surplus, but no valid propose_allocation call materialized (the model
  // stalled after fetching the goals, or mangled its arguments past saving).
  // The app then proposes the deterministic gap-proportional split itself,
  // through the same validator every Apply card goes through — an explicit
  // ask for an action should end in an actionable card, not in prose about
  // one.
  if (
    !proposal &&
    routeTool(question.content) === "get_savings_goals" &&
    (/\b(split|allocat\w*|assign\w*|distribut\w*|verteil\w*|zuweis\w*|aufteil\w*)\b/i.test(
      question.content,
    ) ||
      /überschuss/i.test(question.content))
  ) {
    const overview = await getSavingsOverview(goalsMonth ?? goalMonthFor(lastPeriod));
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
    const t = await getTranslations({ locale, namespace: "Chat" });
    followUps = SUGGESTION_KEYS.map((key) => t(key)).filter(notAsked);
  }

  yield { type: "done", turn: { reply, proposal, followUps } };
}
