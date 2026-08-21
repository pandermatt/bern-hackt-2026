"use server";

import { z } from "zod";

import { getDashboard } from "@/app/actions/transactions";
import {
  extractFollowUps,
  formatSwissNumbers,
  looksLikeStall,
  parseToolCalls,
  routeTool,
  runTool,
  stripModelMarkup,
  suggestFollowUps,
  SYSTEM_PROMPT,
  TOOL_DEFINITIONS,
  type AssistantTurn,
  type ChartSpec,
  type WireMessage,
} from "@/lib/assistant";
import {
  clearAssistantLog,
  listAssistantLog,
  pushAssistantLog,
  truncateSnapshot,
  type AssistantLogEntry,
  type AssistantLogView,
} from "@/lib/assistant-log";
import { getCurrentUser } from "@/lib/auth";

const STONEY_URL =
  process.env.STONEY_URL ?? "https://llm.stoney-cloud.com/v1/chat/completions";

/** API requests per turn. Tools are offered on all but the last, which forces
 * an answer so a fetch-happy model cannot loop forever. */
const MAX_ROUNDS = 4;

/**
 * Bounded on every axis: this whole array is interpolated into one prompt, and
 * an unbounded history would let a single request ship megabytes upstream.
 */
const historySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(2000),
    }),
  )
  .min(1)
  .max(24);

function failure(reply: string): AssistantTurn {
  return { reply, error: true };
}

/**
 * One turn of the chat, as a tool-calling loop. The model starts with no
 * figures at all: it requests data through the tools in `lib/assistant.ts`,
 * each request is answered from the account's real aggregates, and the pie
 * chart is formed from the data the model actually fetched — never parsed
 * out of model prose. Raw transaction rows never leave the server.
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
  const maxTokens = Number.parseInt(process.env.MAX_TOKENS ?? "", 10) || 100;

  const parsed = historySchema.safeParse(rawHistory);
  const question = parsed.success
    ? [...parsed.data].reverse().find((m) => m.role === "user")
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

  if (!parsed.success || !question) {
    record(turnStarted, { status: "error", error: "History failed validation." });
    return failure("That message could not be read — try rephrasing it.");
  }

  const key = process.env.STONEY_KEY;
  if (!key) {
    record(turnStarted, { status: "error", error: "STONEY_KEY is not set." });
    return failure(
      "The assistant is not configured yet. Set STONEY_KEY in .env.local and restart the server.",
    );
  }

  const dashboard = await getDashboard({});
  if (!dashboard) {
    record(turnStarted, { status: "error", error: "Session expired mid-turn." });
    return failure("Your session has expired — sign in again to keep chatting.");
  }

  const messages: WireMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    // Older turns only pad the context window of an 8B model.
    ...parsed.data.slice(-8),
  ];
  let chart: ChartSpec | undefined;
  let reply: string | undefined;
  let proposedFollowUps: string[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const offerTools = round < MAX_ROUNDS;
    const body = {
      model,
      messages,
      // MAX_TOKENS caps the visible answer; the +80 is the budget for the
      // FOLLOWUP: lines parsed out of it, and the floor of 200 keeps a tool
      // call from truncating into something unparseable.
      max_tokens: Math.max(maxTokens + 80, 200),
      ...(offerTools ? { tools: TOOL_DEFINITIONS } : {}),
    };
    const startedAt = Date.now();
    const request = truncateSnapshot(JSON.stringify(body, null, 2));
    const messageCount = messages.length;

    let response: Response;
    let raw: string;
    try {
      response = await fetch(STONEY_URL, {
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
      return failure(
        "Could not reach llm.stoney-cloud.com — check the connection and try again.",
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
      return failure(
        response.status === 401
          ? "The model endpoint rejected the API key — check STONEY_KEY."
          : `The model endpoint answered ${response.status} — try again in a moment.`,
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
      return failure("The model returned an unreadable answer — try again.");
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
    let routed = false;
    if (offerTools && calls.length === 0 && looksLikeStall(content)) {
      const fallback = routeTool(question.content);
      if (fallback) {
        calls = [fallback];
        routed = true;
      }
    }

    record(startedAt, {
      status: "ok",
      httpStatus: response.status,
      note:
        calls.length > 0
          ? `round ${round} · fetched ${calls.join(", ")}${routed ? " (routed)" : ""}`
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

    messages.push({ role: "assistant", content });
    for (const name of calls) {
      const tool = runTool(name, dashboard);
      if (tool.chart) chart = tool.chart;
      messages.push({
        role: "tool",
        content: JSON.stringify({ tool: name, result: tool.result }),
      });
    }
  }

  if (!reply) {
    return failure("The model returned an empty answer — try asking again.");
  }

  // The model's own proposals lead; the deterministic ones cover the turns
  // where it forgot the FOLLOWUP: lines. Either way nothing already asked
  // in this conversation comes back around.
  const asked = parsed.data
    .filter((m) => m.role === "user")
    .map((m) => m.content.toLowerCase());
  const followUps = proposedFollowUps
    .filter((q) => !asked.includes(q.toLowerCase()))
    .slice(0, 3);

  return {
    reply,
    chart,
    followUps: followUps.length
      ? followUps
      : suggestFollowUps(question.content, dashboard, asked),
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
