import { runAssistantTurn } from "@/lib/assistant-turn";

/**
 * The chat panel's transport: one turn, reported as it happens.
 *
 * A route handler rather than the server action, because an action returns
 * once and a turn has things worth saying before it finishes. A charted answer
 * is three round trips of Gemini thinking for ten to fifteen seconds apiece,
 * and the panel used to show a row of dots for all of it; now it says which
 * figures are being fetched, then that the chart is being drawn, then answers.
 *
 * **NDJSON, not SSE.** One JSON object per line, which `TurnEvent` already is.
 * SSE buys reconnection and an event-name field, and this needs neither: the
 * only consumer is `useAssistantChat`, and a dropped connection is a lost turn
 * either way. `text/event-stream` would also cost the `data: ` framing on
 * every line for nothing.
 *
 * The turn resolves the account from the session itself and answers a signed
 * out caller with an expired-session bubble, so there is no auth check here
 * that `runAssistantTurn` does not already make.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let history: unknown;
  let locale: string | undefined;
  try {
    const payload = await request.json();
    // The panel sends what it is rendering in. This route carries no locale
    // segment and the proxy does not run for it, so an inferred locale would
    // be the default one and an English reader would get German answers.
    history = (payload as { history?: unknown })?.history;
    const named = (payload as { locale?: unknown })?.locale;
    locale = typeof named === "string" ? named : undefined;
  } catch {
    // `runAssistantTurn` validates the history itself and has a sentence for
    // an unreadable one; handing it undefined gets that sentence.
    history = undefined;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAssistantTurn(history, locale)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (cause) {
        // The turn itself is written not to throw, so this is a bug or a
        // dropped connection. Either way the client gets a bubble rather than
        // a stream that simply stops.
        console.error("Assistant turn failed mid-stream.", cause);
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "turn",
              turn: { reply: "Something went wrong — try asking again.", error: true },
            })}\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Nginx and friends buffer a proxied response by default, which would
      // hold every event until the turn ended and undo the whole point.
      "X-Accel-Buffering": "no",
    },
  });
}
