"use client";

import { askBatzi } from "@/lib/ask-batzi";

/**
 * The clickable shell of a nudge that talks to the chat instead of navigating.
 *
 * `NudgeCard` is a synchronous server component and stays one — this leaf is
 * the only part of the free-money card that needs a browser. A click hands the
 * prepared question (already in the reader's language, resolved server-side)
 * to `HomeChat` through the `askBatzi` seam, which sends it as the reader's
 * own turn and opens the panel on the answer. The card's content arrives as
 * `children` from the server for the same reason `NudgeStack` takes its cards
 * that way: nothing of the card's rendering crosses the boundary, only a
 * button element and one string.
 *
 * While the deck is collapsed, `NudgeStack`'s capture handler stops the click
 * before it reaches this button — first click deals the deck out, second click
 * asks — exactly as it does for the link cards.
 */
export function NudgeAskButton({
  question,
  className,
  children,
}: {
  question: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={() => askBatzi(question)} className={className}>
      {children}
    </button>
  );
}
