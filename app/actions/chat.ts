"use server";

import { getLocale } from "next-intl/server";

import type { AssistantTurn } from "@/lib/assistant";
import {
  clearAssistantLog,
  listAssistantLog,
  type AssistantLogView,
} from "@/lib/assistant-log";
import { runAssistantTurn } from "@/lib/assistant-runner";
import { getCurrentUser } from "@/lib/auth";

/**
 * One turn of the chat, without streaming. `components/chat-panel.tsx` calls
 * `app/api/assistant` first and lands here only when that stream breaks — a
 * proxy that buffered it, a dropped connection — so a turn that is perfectly
 * answerable is not lost to a transport problem.
 *
 * The loop itself lives in `lib/assistant-runner.ts`; this drains it and
 * keeps the last event.
 *
 * Returns an `AssistantTurn` directly rather than the `ActionResult` envelope:
 * like the reads in `transactions.ts`, a failed turn is rendered in place (as
 * a chat bubble), not raised as a toast.
 */
export async function askAssistant(rawHistory: unknown): Promise<AssistantTurn> {
  let turn: AssistantTurn = {
    reply: "The model returned an empty answer — try asking again.",
    error: true,
  };
  for await (const event of runAssistantTurn({
    rawHistory,
    locale: await getLocale(),
  })) {
    if (event.type === "done") turn = event.turn;
  }
  return turn;
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
