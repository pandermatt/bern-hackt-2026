"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

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
 * - **The transcript is capped rather than stretched.** An auto-height root
 *   keeps an empty chat short — it is a greeting, not a screenful of blank
 *   panel — and the cap takes over once a conversation gets going. It is
 *   deliberately tight on a phone (`30svh`): the transcript scrolls, the
 *   mascot below it does not, so every extra centimetre the chat takes is one
 *   the dragon loses. From `lg` the page is two columns and the mascot sits
 *   beside the chat rather than under it, so the cap opens up. `svh`, not
 *   `vh`: on iOS Safari `vh` measures against the collapsed URL bar, which
 *   would tuck the input underneath it.
 */
export function HomeChat() {
  const t = useTranslations("Chat");
  const chat = useAssistantChat();

  return (
    <div className="overflow-clip rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand">
          <Sparkles className="size-4 text-text" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] leading-tight font-semibold text-text">
            {t("title")}
          </h2>
          <p className="text-[12px] text-text-muted">{t("subtitle")}</p>
        </div>
      </div>

      <ChatPanel chat={chat} scrollClassName="max-h-[30svh] lg:max-h-[60svh]" />
    </div>
  );
}
