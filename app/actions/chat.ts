"use server";

import { z } from "zod";

import { getDashboard } from "@/app/actions/transactions";
import {
  buildSystemPrompt,
  pickChart,
  type AssistantTurn,
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
 * One turn of the chat. The model only ever sees the pre-aggregated figure
 * sheet from `buildSystemPrompt` — raw rows stay on the server — and any chart
 * is computed here from the real aggregates, never parsed out of model output.
 *
 * Returns an `AssistantTurn` directly rather than the `ActionResult` envelope:
 * like the reads in `transactions.ts`, a failed turn is rendered in place (as
 * a chat bubble), not raised as a toast.
 *
 * Every turn is recorded to the in-memory debug log — including the ones that
 * never reach the API, since "why did no request go out" is exactly what the
 * debug menu is for. The Authorization header is never part of the snapshot.
 */
export async function askAssistant(rawHistory: unknown): Promise<AssistantTurn> {
  const user = await getCurrentUser();
  if (!user) {
    return failure("Your session has expired — sign in again to keep chatting.");
  }

  const started = Date.now();
  const model = process.env.MODEL ?? "apertus-ai/Apertus-v1.5-8B";
  const maxTokens = Number.parseInt(process.env.MAX_TOKENS ?? "", 10) || 100;

  const parsed = historySchema.safeParse(rawHistory);
  const question = parsed.success
    ? [...parsed.data].reverse().find((m) => m.role === "user")
    : undefined;

  const record = (
    patch: Partial<AssistantLogEntry> & { status: AssistantLogEntry["status"] },
  ): void =>
    pushAssistantLog({
      userId: user.id,
      at: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      model,
      maxTokens,
      question: question?.content ?? "(unreadable message)",
      messageCount: 0,
      ...patch,
    });

  if (!parsed.success || !question) {
    record({ status: "error", error: "History failed validation." });
    return failure("That message could not be read — try rephrasing it.");
  }

  const key = process.env.STONEY_KEY;
  if (!key) {
    record({ status: "error", error: "STONEY_KEY is not set." });
    return failure(
      "The assistant is not configured yet. Set STONEY_KEY in .env.local and restart the server.",
    );
  }

  const dashboard = await getDashboard({});
  if (!dashboard) {
    record({ status: "error", error: "Session expired mid-turn." });
    return failure("Your session has expired — sign in again to keep chatting.");
  }

  const body = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(dashboard) },
      // The figure sheet answers everything; older turns only pad the context
      // window of an 8B model.
      ...parsed.data.slice(-8),
    ],
    max_tokens: maxTokens,
  };
  const request = truncateSnapshot(JSON.stringify(body, null, 2));
  const messageCount = body.messages.length;

  try {
    const response = await fetch(STONEY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await response.text();
    const snapshot = truncateSnapshot(raw);

    if (!response.ok) {
      record({
        status: "error",
        httpStatus: response.status,
        error: `Upstream answered ${response.status}.`,
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
      record({
        status: "error",
        httpStatus: response.status,
        error: "Upstream body was not JSON.",
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
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      record({
        status: "error",
        httpStatus: response.status,
        error: "Upstream answer had no content.",
        messageCount,
        request,
        response: snapshot,
        usage,
      });
      return failure("The model returned an empty answer — try asking again.");
    }

    record({
      status: "ok",
      httpStatus: response.status,
      messageCount,
      request,
      response: snapshot,
      usage,
    });
    return { reply, chart: pickChart(question.content, dashboard) };
  } catch (cause) {
    record({
      status: "error",
      error:
        cause instanceof Error && cause.name === "TimeoutError"
          ? "Request timed out after 30s."
          : "Fetch failed — endpoint unreachable.",
      messageCount,
      request,
    });
    return failure(
      "Could not reach llm.stoney-cloud.com — check the connection and try again.",
    );
  }
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
