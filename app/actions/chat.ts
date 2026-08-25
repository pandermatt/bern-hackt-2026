"use server";

import { cookies } from "next/headers";

import {
  geminiEndpoint,
  geminiModelChoices,
  modelChain,
} from "@/lib/llm/gemini";
import { preferredModel, runAssistantTurn } from "@/lib/assistant-turn";
import {
  clearAssistantLog,
  listAssistantLog,
  type AssistantConfigView,
  type AssistantLogView,
} from "@/lib/assistant-log";
import { getCurrentUser } from "@/lib/auth";
import { ASSISTANT_MODEL_COOKIE } from "@/lib/site";
import type { AssistantTurn } from "@/lib/assistant";

/** Unset (or unparseable, or 0) means "no cap": the request then carries no
 * output cap at all and the model's own default applies. The thinking budget
 * is added on top of this inside `toGeminiBody` — this number is what the
 * customer actually reads. */
function assistantMaxTokens(): number | undefined {
  return Number.parseInt(process.env.MAX_TOKENS ?? "", 10) || undefined;
}

/**
 * One turn, waited out in full.
 *
 * The panel streams instead (`app/api/assistant/route.ts`), so what this is
 * for is everything that cannot: a browser whose stream failed to open, and
 * any future caller that just wants the answer. Same turn either way — it
 * drains the same generator and keeps the last event.
 */
export async function askAssistant(rawHistory: unknown): Promise<AssistantTurn> {
  let turn: AssistantTurn = {
    reply: "The model returned an empty answer — try asking again.",
    error: true,
  };
  for await (const event of runAssistantTurn(rawHistory)) {
    if (event.type === "turn") turn = event.turn;
  }
  return turn;
}

/** Where the calls go and under what caps — the header of the debug panel,
 * which otherwise says nothing at all until a turn has been logged. The API
 * key is deliberately not part of it, the same way the request snapshots
 * never carry the X-goog-api-key header. */
export async function getAssistantConfig(): Promise<AssistantConfigView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const chain = modelChain(await preferredModel());
  return {
    url: geminiEndpoint(chain[0]),
    model: chain[0],
    // The dropdown's options, in the order a turn would try them.
    choices: chain,
    maxTokens: assistantMaxTokens(),
  };
}

/**
 * Point this browser's turns at another model, from the debug panel.
 *
 * A cookie rather than an env var or a stored setting: it is a knob for
 * whoever is demonstrating the app, on the machine they are demonstrating it
 * from, and Gemini's capacity moves faster than a redeploy. An unknown name is
 * ignored rather than rejected — `geminiModelChoices` is the allowlist, and
 * clearing the cookie is how you go back to the configured default.
 */
export async function setAssistantModel(model: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const jar = await cookies();
  if (!geminiModelChoices().includes(model)) {
    jar.delete(ASSISTANT_MODEL_COOKIE);
    return;
  }
  jar.set(ASSISTANT_MODEL_COOKIE, model, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
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

