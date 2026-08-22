/**
 * The chat's streaming endpoint. A route handler rather than a server action
 * because actions resolve to one value — they cannot hand back an answer a
 * token at a time, and a tool-calling turn is slow enough that watching it
 * arrive is most of the difference between "thinking" and "hung".
 *
 * The loop is `lib/assistant-runner.ts`, shared with `askAssistant`. This file
 * only turns its events into newline-delimited JSON. Auth is re-checked inside
 * the runner: a route handler inherits nothing from the action's session
 * lookup.
 */
import { cookies } from "next/headers";

import { defaultLocale, isAppLocale, LOCALE_COOKIE_NAME } from "@/i18n/routing";
import { runAssistantTurn } from "@/lib/assistant-runner";

/** The sandbox worker and better-sqlite3 rule out the edge runtime. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let rawHistory: unknown;
  try {
    rawHistory = await request.json();
  } catch {
    return Response.json({ error: "Body was not JSON." }, { status: 400 });
  }

  // next-intl's `getLocale` reads a request context a server action has and a
  // route handler does not, so the cookie is read directly — the same one
  // `i18n/routing.ts` documents as the server's view of the user's choice.
  const cookie = (await cookies()).get(LOCALE_COOKIE_NAME)?.value;
  const locale = isAppLocale(cookie) ? cookie : defaultLocale;

  const encoder = new TextEncoder();
  const events = runAssistantTurn({ rawHistory, locale, stream: true });

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        if (value.type === "done") controller.close();
      } catch (cause) {
        // The turn broke after headers were already sent, so the error has to
        // travel as a final event rather than a status code.
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "done",
              turn: {
                reply: "The assistant stopped unexpectedly — try asking again.",
                error: true,
              },
            })}\n`,
          ),
        );
        controller.close();
        console.error("assistant stream failed", cause);
      }
    },
    cancel() {
      // The reader closed the panel or navigated away mid-turn.
      void events.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Stops a reverse proxy from buffering the whole turn into one write.
      "X-Accel-Buffering": "no",
    },
  });
}
