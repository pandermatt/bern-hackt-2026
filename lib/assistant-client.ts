/**
 * The browser's half of the streaming turn: POST the history to
 * `app/api/assistant`, read the newline-delimited events back, and hand them
 * to the caller as they arrive.
 *
 * Kept out of `components/chat-panel.tsx` so the transport is testable
 * without React, and out of `lib/assistant.ts` so nothing here can drag the
 * server's imports into the bundle.
 */
import type { AssistantTurn } from "@/lib/assistant";

type Handlers = {
  onDelta: (text: string) => void;
  onReset: () => void;
  onDone: (turn: AssistantTurn) => void;
};

type WireEvent =
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; turn: AssistantTurn };

export async function streamAssistant(
  history: { role: "user" | "assistant"; content: string }[],
  { onDelta, onReset, onDone }: Handlers,
): Promise<void> {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(history),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Assistant endpoint answered ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const consume = (line: string): void => {
    if (!line.trim()) return;
    let event: WireEvent;
    try {
      event = JSON.parse(line) as WireEvent;
    } catch {
      return; // A partial line at the very end; the reader will not resume it.
    }
    if (event.type === "delta") onDelta(event.text);
    else if (event.type === "reset") onReset();
    else if (event.type === "done") {
      finished = true;
      onDone(event.turn);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      consume(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 1);
    }
  }
  consume(buffer);

  // A stream that ends without a `done` event is a dropped connection, not an
  // empty answer — let the caller show its failure bubble.
  if (!finished) throw new Error("Assistant stream ended without a result.");
}
