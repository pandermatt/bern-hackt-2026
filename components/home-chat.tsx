"use client";

import { Bug, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ChatDebug } from "@/components/chat-debug";
import { ChatPanel, useAssistantChat } from "@/components/chat-panel";

/**
 * The assistant, inline and already open, at the top of the entry page — and
 * the only place it lives. The dashboard used to carry a slide-over copy of it;
 * that one is gone, so this is the whole assistant.
 *
 * The page itself is a server component and cannot call a hook, so this thin
 * client wrapper owns the conversation and hands it to the shared panel in
 * `components/chat-panel.tsx`.
 *
 * Two deliberate choices, both inherited from the slide-over's mistakes:
 *
 * - **No `inputRef`, so nothing is focused on arrival.** Autofocusing an input
 *   near the top of a phone page raises the keyboard immediately, collapses the
 *   viewport and pushes away the very thing the reader opened the page to see.
 * - **The transcript is a fixed height, not a cap.** This was `max-h` once,
 *   on the reasoning that an empty chat should not reserve a screenful of
 *   blank panel. What that actually bought was a panel that grew with the
 *   first few replies and shoved the nudges and the mascot down the page on
 *   every turn — the reader's eye lost its place mid-conversation. A constant
 *   height costs some whitespace at the greeting and buys a page that never
 *   moves under you; the transcript scrolls inside it instead.
 *
 *   It is deliberately short on a phone (`30svh`): there the mascot sits below
 *   the chat, so every centimetre the panel holds is one the dragon loses.
 *   From `lg` the page is two columns and the two sit side by side, so the
 *   panel can have the room. `svh`, not `vh`: on iOS Safari `vh` measures
 *   against the collapsed URL bar, which would tuck the input underneath it.
 */
export function HomeChat() {
  const t = useTranslations("Chat");
  const chat = useAssistantChat();
  const [view, setView] = useState<"chat" | "debug">("chat");

  return (
    <div className="overflow-clip rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand">
          <Sparkles className="size-4 text-text" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] leading-tight font-semibold text-text">
            {view === "debug" ? t("debugTitle") : t("title")}
          </h2>
          <p className="text-[12px] text-text-muted">
            {view === "debug" ? t("debugSubtitle") : t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setView(view === "debug" ? "chat" : "debug")}
          aria-pressed={view === "debug"}
          className={`cursor-pointer rounded-md p-1.5 transition-colors ${
            view === "debug"
              ? "bg-accent-soft text-accent"
              : "text-text-muted hover:bg-surface-muted hover:text-text"
          }`}
          aria-label={t("toggleDebug")}
          title={t("debugTitle")}
        >
          <Bug className="size-4" />
        </button>
      </div>

      {view === "debug" ? (
        /* The debug list brings its own scroll; this wrapper gives it the same
           fixed height the transcript has, so toggling the bug icon does not
           resize the card under the reader. (The chat view is still taller by
           its input row — that one is not a scroll area and has nowhere to go.) */
        <div className="flex h-[30svh] flex-col lg:h-[60svh]">
          <ChatDebug />
        </div>
      ) : (
        <ChatPanel chat={chat} scrollClassName="h-[30svh] lg:h-[60svh]" />
      )}
    </div>
  );
}
