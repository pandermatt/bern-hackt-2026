"use client";

import { Bug, ChevronDown, PenLine, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { ChatDebug } from "@/components/chat-debug";
import {
  CHAT_PILL,
  CHAT_PILL_SHAPE,
  ChatPanel,
  useAssistantChat,
} from "@/components/chat-panel";
import { SUGGESTION_KEYS } from "@/lib/assistant";

/**
 * The assistant, at the top of the entry page — and the only place it lives.
 * The dashboard used to carry a slide-over copy of it; that one is gone, so
 * this is the whole assistant.
 *
 * The page itself is a server component and cannot call a hook, so this thin
 * client wrapper owns the conversation and hands it to the shared panel in
 * `components/chat-panel.tsx`.
 *
 * Three deliberate choices, the first two inherited from the slide-over's
 * mistakes:
 *
 * - **Nothing is focused on arrival.** Autofocusing an input near the top of a
 *   phone page raises the keyboard immediately, collapses the viewport and
 *   pushes away the very thing the reader opened the page to see. The one
 *   thing that focuses the input is the reader asking for it — the "other"
 *   button below, which is the shell-opens-the-chat-on-demand case
 *   `ChatPanel`'s `inputRef` was kept for.
 * - **The transcript is a fixed height, not a cap.** This was `max-h` once,
 *   on the reasoning that an empty chat should not reserve a screenful of
 *   blank panel. What that actually bought was a panel that grew with the
 *   first few replies and shoved the nudges and the mascot down the page on
 *   every turn — the reader's eye lost its place mid-conversation. A constant
 *   height costs some whitespace at the greeting and buys a page that never
 *   moves under you; the transcript scrolls inside it instead.
 * - **On a phone there is no panel at all until it is asked for.** Below `lg`
 *   the card arrives as a block of chips — what to ask, and an "other" pill for
 *   anything else — with the transcript and the input row not rendered at all.
 *   That is around 200px of card against 380, and the difference is the
 *   mascot's: the dragon is what the entry page is arranged around and what is
 *   saying the nudges, and at the full height he started below the fold. Any
 *   chip opens the panel, and it stays open. The launcher is the SSR state,
 *   like the nudge deck's folded row, so the page arrives with the dragon in
 *   frame and stays that way with JS off.
 *
 * From `lg` the page is two columns and the mascot sits *beside* the chat
 * rather than under it, so the launcher never renders there and the panel is
 * simply always open at `60svh`. `svh`, not `vh`: on iOS Safari `vh` measures
 * against the collapsed URL bar, which would tuck the input underneath it.
 */
export function HomeChat() {
  const t = useTranslations("Chat");
  const chat = useAssistantChat();
  const [view, setView] = useState<"chat" | "debug">("chat");
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  const inputRef = useRef<HTMLInputElement>(null);
  /* Set only by the "other" button, and read once. Opening the panel any other
     way — a chip, the chevron, the bug icon — must not raise the keyboard,
     which is the whole reason nothing autofocuses on arrival. */
  const focusOnOpen = useRef(false);
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    // The panel is `hidden` below `lg` while folded, and focusing a
    // `display: none` element is a no-op — so this has to happen *after* the
    // render that opened it, which is what an effect on `open` is.
    inputRef.current?.focus();
  }, [open]);

  /* Asking is the one gesture that plainly means "I want to read the answer",
     so a send opens the panel. Nothing closes it again by itself: collapsing
     under a reader mid-conversation is the shifting page the fixed height
     exists to prevent. */
  const send = (text: string) => {
    setOpen(true);
    chat.send(text);
  };

  return (
    /* The nudge cards' own shape — `rounded-lg border border-line bg-surface`,
       from `components/nudge-card.tsx`. This used to be a rounded-xl card with
       a shadow, which made the first thing on the page the one thing on it
       drawn in a different design. */
    <div className="overflow-clip rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-3.5 py-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand">
          <Sparkles className="size-4 text-text" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] leading-snug font-semibold text-text">
            {view === "debug" ? t("debugTitle") : t("title")}
          </h2>
          {/* Phone-hidden: the tagline is a second line under a title that is
              already an instruction ("Ask Batzi"), and above a one-row
              launcher a two-line header is most of the card. From `lg` there
              is room and it comes back. */}
          <p className="hidden text-[12.5px] leading-snug text-text-muted lg:block">
            {view === "debug" ? t("debugSubtitle") : t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setView(view === "debug" ? "chat" : "debug");
            // The log is a list with nowhere to go — there is no folded form
            // of it, so asking for it asks for the room to read it in.
            if (view !== "debug") setOpen(true);
          }}
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
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-muted hover:text-text lg:hidden"
          aria-label={open ? t("collapse") : t("expand")}
          title={open ? t("collapse") : t("expand")}
        >
          <ChevronDown
            className={`size-4 transition-transform duration-300 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {/* The wrapper carries the id `aria-controls` points at, so it sits
          outside the branch: the launcher and the panel are two states of the
          same box. */}
      <div id={bodyId}>
        {view === "debug" ? (
          /* The debug list brings its own scroll and needs a bounded flex
             column to do it in — the same height the transcript has, so the
             bug icon does not resize the card under the reader. */
          <div className="flex h-[38svh] flex-col lg:h-[60svh]">
            <ChatDebug />
          </div>
        ) : (
          <>
            {!open && (
              <ChatLauncher
                chat={chat}
                send={send}
                onOther={() => {
                  focusOnOpen.current = true;
                  setOpen(true);
                }}
              />
            )}
            {/* Hidden rather than unmounted: `display: none` keeps the input —
                and the ref the "other" button focuses — in the tree, and keeps
                the panel the same element across the toggle. From `lg` the
                `max-lg:` variant never applies, so it is always the open panel
                there. */}
            <ChatPanel
              chat={{ ...chat, send }}
              className={open ? "" : "max-lg:hidden"}
              scrollClassName="h-[38svh] lg:h-[60svh]"
              inputRef={inputRef}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The folded phone card: the questions worth asking, and the way past them.
 *
 * A **wrapped block**, so the openers are read rather than swiped for — one
 * sideways-scrolling row fitted a single question on a 390px screen and hid
 * the other three behind a gesture nothing announced. Wrapping puts three to
 * five rows of them on screen at the cost of ~100px, which is the trade this
 * card is for: the panel it replaces is 380px and starts with none of them
 * visible at all.
 *
 * The chips are the follow-ups once there are any, and the openers before
 * that: folded is a state a reader comes back to mid-conversation, and "what
 * to ask next" is the honest content for it either way. "Other" is last, in
 * the same wrap and the same pill, because it is the same kind of thing — one
 * more way to start, for the question nobody offered.
 */
function ChatLauncher({
  chat,
  send,
  onOther,
}: {
  chat: ReturnType<typeof useAssistantChat>;
  send: (text: string) => void;
  onOther: () => void;
}) {
  const t = useTranslations("Chat");
  const { followUps, pending } = chat;
  const chips =
    followUps.length > 0 ? followUps : SUGGESTION_KEYS.map((key) => t(key));

  return (
    <div className="px-3.5 py-3 lg:hidden">
      <div
        /* role="group" is what makes the aria-label real: on a role-less div
           the label sits on an implicit "generic" role, where ARIA prohibits
           naming, and assistive tech ignores it. */
        role="group"
        aria-label={followUps.length > 0 ? t("followUpsLabel") : t("askLabel")}
        /* Three rows and a glimpse of the fourth, the rest by scrolling. Left
           to wrap freely the four German openers are seven rows and 312px of
           card — as much as the panel they stand in for, which defeats the
           whole arrangement. `38` is three rows at these sizes (one of them a
           wrapped two-liner) plus the top of what follows; that sliver and the
           fade over it are what say there is more, since a box cut exactly at
           a row boundary looks like the end of the list. */
        className="flex max-h-38 flex-wrap gap-2 overflow-y-auto mask-b-from-80%"
      >
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => send(chip)}
            /* A send is refused while one is in flight, so the chips say so
               rather than swallowing the tap. */
            disabled={pending}
            className={`${CHAT_PILL} max-w-full whitespace-normal`}
          >
            {chip}
          </button>
        ))}
      </div>
      {/* Outside the scroller on purpose: with the input folded away, a
          question nobody offered has no other way in, so the way to it must
          not be something you have to scroll a box to find. */}
      <button
        type="button"
        onClick={onOther}
        className={`${CHAT_PILL_SHAPE} mt-2 inline-flex items-center gap-1.5 border-transparent bg-accent-soft text-accent hover:bg-accent hover:text-white`}
      >
        <PenLine className="size-3.5" aria-hidden />
        {t("other")}
      </button>
    </div>
  );
}
