"use client";

import { Bug, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ChatDebug } from "@/components/chat-debug";
import { ChatPanel, useAssistantChat } from "@/components/chat-panel";

/**
 * The assistant, inline and already open, at the top of the entry page.
 *
 * The page itself is a server component and cannot call a hook, so this thin
 * client wrapper owns the conversation and hands it to the shared panel. It is
 * the second shell around `components/chat-panel.tsx`; the first is the
 * slide-over on the dashboard.
 *
 * Two deliberate differences from that slide-over:
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
        /* The debug list brings its own scroll; this wrapper only gives it the
           same height cap the transcript gets, so the card cannot grow without
           bound on a long log. */
        <div className="flex max-h-[45svh] flex-col">
          <ChatDebug />
        </div>
      ) : (
         <ChatPanel chat={chat} scrollClassName="max-h-[30svh] lg:max-h-[60svh]" />
      )}
         </div>
  );
}
