"use client";

import { Bug, ChevronDown, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

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
 * On a phone that fixed height is now **two** constants and a toggle: `h-24`
 * arriving, `38svh` once the reader opens it. The panel used to arrive at
 * `30svh`, which with the header and the input row around it was over half a
 * 667px screen, and the mascot — the thing the page is arranged around, and
 * the thing saying the nudges — started below the fold. Collapsed is the SSR
 * state, like the nudge deck's, so the dragon is visible on arrival and stays
 * visible with JS off. It is still a height and not a cap, so the rule above
 * holds inside each state: nothing resizes under the reader except the tap
 * they made.
 *
 * From `lg` the page is two columns and the mascot sits *beside* the chat
 * rather than under it, so there is nothing to gain by folding: the panel
 * keeps its `60svh` and the toggle is not rendered. `svh`, not `vh`: on iOS
 * Safari `vh` measures against the collapsed URL bar, which would tuck the
 * input underneath it.
 */
export function HomeChat() {
  const t = useTranslations("Chat");
  const chat = useAssistantChat();
  const [view, setView] = useState<"chat" | "debug">("chat");
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  /* Asking is the one gesture that plainly means "I want to read the answer",
     so a send opens the panel — including the empty state's starter chips,
     which is how most first turns begin. Nothing closes it again by itself:
     collapsing under a reader mid-conversation is the shifting page the fixed
     height exists to prevent. */
  const send = (text: string) => {
    setExpanded(true);
    chat.send(text);
  };

  /* One height for both branches, so toggling the bug icon does not resize the
     card under the reader — the same parity the debug view has always kept
     with the transcript. (The chat view is still taller by its input row —
     that one is not a scroll area and has nowhere to go.) */
  const bodyHeight = `${
    expanded ? "h-[38svh]" : "h-24"
  } transition-[height] duration-300 ease-out lg:h-[60svh]`;

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
        {/* `lg:hidden`, because from `lg` there is no folded state to get back
            out of — the panel is `60svh` either way, and a chevron that
            changed nothing would be a lie. */}
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-muted hover:text-text lg:hidden"
          aria-label={expanded ? t("collapse") : t("expand")}
          title={expanded ? t("collapse") : t("expand")}
        >
          <ChevronDown
            className={`size-4 transition-transform duration-300 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {/* The wrapper carries the id `aria-controls` points at, so it has to sit
          outside the branch: both views are the same box being resized. */}
      <div id={bodyId}>
        {view === "debug" ? (
          /* The debug list brings its own scroll and needs a bounded flex
             column to do it in. */
          <div className={`flex flex-col ${bodyHeight}`}>
            <ChatDebug />
          </div>
        ) : (
          <ChatPanel
            chat={{ ...chat, send }}
            /* Folded, the transcript's own 32px of vertical padding is a
               third of the box — trimming it is a whole starter chip back,
               inside the same 96px. The mask is the other half of the same
               problem: what a window that size cuts through is a chip or a
               bubble of whatever height the sentence came out at, so rather
               than try to land the fold cleanly — which no height does in both
               locales — it fades the last quarter, and the slice reads as
               "there is more below". Both are reset at `lg`, where the panel
               is `60svh` and never folds. */
            scrollClassName={`${bodyHeight} ${
              expanded ? "py-4" : "py-2 mask-b-from-75% lg:py-4 lg:mask-none"
            }`}
            /* Folded, the box is 96px: the intro paragraph alone fills it and
               pushes the starter chips out of sight. The header's subtitle is
               already saying what the assistant is for. */
            introClassName={expanded ? "" : "max-lg:hidden"}
          />
        )}
      </div>
    </div>
  );
}
