/**
 * The seam between the nudge deck and the chat: "paste this question".
 *
 * The free-money nudge does not navigate anywhere — it hands Batzi a prepared
 * question instead, and the two ends of that gesture live in components that
 * cannot see each other: `NudgeCard` is a server component at the bottom of
 * `/home`, and the conversation lives in `HomeChat`'s `useAssistantChat()` at
 * the top. A React context bridging them would need a new client boundary
 * wrapped around both page columns to carry one string one way; a window event
 * costs nothing in the tree, and this module is the whole contract — both ends
 * import it, so the event name and the payload shape cannot drift apart.
 *
 * One direction only, and the question is *sent*, not pasted: the card is
 * itself a fully-formed question, so clicking it is asking it — a
 * paste-then-confirm was tried first and demoted the click to ceremony. A
 * stray click while the deck is collapsed cannot fire it; `NudgeStack`'s
 * capture handler eats that one to unfold the deck.
 *
 * `window` is only touched inside the functions, so importing this module is
 * safe anywhere; calling it is for client components.
 */

const ASK_EVENT = "beyond-money:ask-batzi";

/** Ask Batzi `question`: sent as the reader's turn, panel opened. */
export function askBatzi(question: string) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: question }));
}

/** Subscribe to `askBatzi` calls. Returns the unsubscribe, for an effect. */
export function onAskBatzi(handler: (question: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string") handler(detail);
  };
  window.addEventListener(ASK_EVENT, listener);
  return () => window.removeEventListener(ASK_EVENT, listener);
}
