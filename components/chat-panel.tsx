"use client";

import { Check, Loader2, PiggyBank, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { askAssistant } from "@/app/actions/chat";
import { applyAllocationAdds } from "@/app/actions/savings";
import {
  SUGGESTION_KEYS,
  type AllocationProposal,
  type ChatRole,
} from "@/lib/assistant";
import { formatMoney } from "@/lib/insights";

/**
 * The assistant's body, and the state behind it.
 *
 * `HomeChat` mounts it inline at the top of the entry page — the assistant's
 * one home, since the dashboard's slide-over was removed. It stays split as a
 * **hook plus a presentational component** rather than one component: the
 * shell owns the conversation, so a shell that hides the panel behind a toggle
 * (as `HomeChat` does with the debug view) keeps the transcript across it. A
 * single component owning that state would lose it on every toggle.
 *
 * So: the shell calls `useAssistantChat()` at its own top level and renders
 * `<ChatPanel>` wherever it likes. `components/echart.tsx` pairs a hook with a
 * component the same way.
 */

/** Not `ChatMessage` — `lib/assistant.ts` owns that name for the wire shape. */
export type PanelMessage = {
  role: ChatRole;
  content: string;
  /** A validated surplus split, rendered as a card with an Apply button. */
  proposal?: AllocationProposal;
  /** Apply state lives on the message, not the panel: the panel unmounts
   * when the shell toggles away from it, and an applied card has to stay
   * applied. */
  proposalApplied?: boolean;
  proposalError?: string;
  error?: boolean;
};

/*
 * The empty state's one-tap starters are the four advice features the
 * assistant leads with — saving potential, anomalies, subscriptions, and
 * allocating last month's surplus. Each is phrased to hit its tool's branch
 * in `routeTool`, so even a stalled model lands on the right data, and the
 * wording lives in the `Chat` namespace: the strings are sent verbatim to
 * the model, so a German reader asks in German and is answered in German.
 * The key list itself lives in `lib/assistant.ts`, because the action
 * re-offers the same questions as follow-up chips when the model proposed
 * none of its own.
 */

export type AssistantChat = {
  messages: PanelMessage[];
  input: string;
  setInput: (value: string) => void;
  followUps: string[];
  pending: boolean;
  send: (text: string) => void;
  /** Index of the message whose proposal is being applied, if any. */
  applying: number | null;
  applyProposal: (index: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Holds one conversation. Call it in the shell, not in the panel — see the
 * note above about why that placement is load-bearing.
 */
export function useAssistantChat(): AssistantChat {
  const t = useTranslations("Chat");
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || pending) return;

    const history = [...messages, { role: "user" as const, content }];
    setMessages(history);
    setFollowUps([]);
    setInput("");

    startTransition(async () => {
      try {
        // Cards are client-side decoration; the action only wants the words.
        const turn = await askAssistant(
          history.map(({ role, content }) => ({ role, content })),
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: turn.reply,
            proposal: turn.proposal,
            error: turn.error,
          },
        ]);
        setFollowUps(turn.followUps ?? []);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: t("failed"),
            error: true,
          },
        ]);
      }
    });
  };

  /**
   * Post one message's proposal as per-goal ADDS through
   * `applyAllocationAdds`, which resolves each pot's current month total at
   * apply time and re-checks the surplus ceiling server-side — a proposal
   * frozen as absolute totals would silently revert allocations made between
   * propose and Apply. The outcome lands on the message itself, so an applied
   * card stays applied across a toggle away from the panel and back.
   */
  const applyProposal = (index: number) => {
    const message = messages[index];
    if (!message?.proposal || message.proposalApplied || applying !== null) {
      return;
    }
    const { month, items } = message.proposal;
    setApplying(index);
    void (async () => {
      let applied = false;
      let error: string | undefined;
      try {
        const result = await applyAllocationAdds(
          month,
          items.map(({ goalId, addMinor }) => ({ goalId, addMinor })),
        );
        applied = result.ok;
        if (!result.ok) error = result.error;
      } catch {
        error = t("failed");
      }
      setMessages((prev) =>
        prev.map((entry, i) =>
          i === index
            ? { ...entry, proposalApplied: applied, proposalError: error }
            : entry,
        ),
      );
      setApplying(null);
      // The pots on the page behind the chat just changed.
      if (applied) router.refresh();
    })();
  };

  return {
    messages,
    input,
    setInput,
    followUps,
    pending,
    send,
    applying,
    applyProposal,
    scrollRef,
  };
}

export function ChatPanel({
  chat,
  className = "",
  /**
   * The transcript's own box — its height *and* its vertical padding, because
   * at the size `HomeChat` folds down to those 32px are a third of the panel
   * and the shell is the only thing that knows it. The inline panel pins the
   * height to a constant rather than letting it take the leftover space, so
   * the page below the chat does not shift on every reply.
   */
  scrollClassName = "flex-1 py-4",
  /**
   * The empty state's opening paragraph. A seam rather than a flag because the
   * shell is the only thing that knows how much room the transcript has: when
   * `HomeChat` runs its phone-sized panel collapsed, five lines of prose are
   * the whole box and the starter chips — the thing a first-time reader is
   * meant to tap — sit below the fold of a 96px scroller. The header's
   * subtitle already says what the assistant is for, so hiding it there costs
   * nothing and buys the chips.
   */
  introClassName = "",
  /**
   * Optional, and `HomeChat` — the only caller today — deliberately omits it:
   * focusing an input near the top of a mobile page raises the keyboard on
   * arrival and shoves away the content the reader came for. It is kept for a
   * shell that opens the chat on demand, where focusing it is the right move.
   */
  inputRef,
  "aria-label": ariaLabel,
}: {
  chat: AssistantChat;
  className?: string;
  scrollClassName?: string;
  introClassName?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  "aria-label"?: string;
}) {
  const t = useTranslations("Chat");
  const {
    messages,
    input,
    setInput,
    followUps,
    pending,
    send,
    applying,
    applyProposal,
    scrollRef,
  } = chat;

  // Keep the newest bubble in view — including the typing indicator. The
  // effect lives HERE, not in the hook: the hook survives in the shell while
  // this panel (and its scroll container) unmounts whenever the shell toggles
  // away from it, so a hook-side effect keyed on [messages, pending] never
  // re-fires on the way back and the transcript returned scrolled to the top.
  // Nothing to follow before the first turn, and following anyway is visible:
  // `HomeChat`'s collapsed panel is 96px of a taller empty state, so a mount
  // that jumps to the bottom opens the page on the *last* starter chip with
  // the one above it sliced in half.
  useEffect(() => {
    if (messages.length === 0 && !pending) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, scrollRef]);

  return (
    /* `min-h-0` is not optional. This root is a new flex item between the
       shell and the transcript, and it carries no `overflow`, so its
       `min-height: auto` resolves to `min-content` — a long conversation would
       grow the column and push the input form off the bottom of the screen. */
    <div
      className={`flex min-h-0 flex-col ${className}`}
      aria-label={ariaLabel}
      role={ariaLabel ? "region" : undefined}
    >
      <div
        ref={scrollRef}
        /* `overflow-y-auto` lives here rather than in `scrollClassName`: the
           auto-scroll effect writes `scrollTop` on this element, so a caller
           must not be able to take the scrolling away. */
        className={`space-y-3 overflow-y-auto px-4 ${scrollClassName}`}
      >
        {messages.length === 0 && (
          <div className="duration-500 animate-in fade-in">
            <p className={`text-[13.5px] text-text-muted ${introClassName}`}>
              {t("intro")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => send(t(key))}
                  className="cursor-pointer rounded-full border border-line bg-bg px-3 py-1.5 text-[12.5px] text-text transition-colors hover:border-accent hover:text-accent"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex duration-300 animate-in fade-in slide-in-from-bottom-2 ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] whitespace-pre-wrap ${
                message.role === "user"
                  ? "rounded-br-sm bg-accent text-white"
                  : message.error
                    ? "rounded-bl-sm bg-danger-soft text-danger-hover"
                    : "rounded-bl-sm border border-line bg-bg text-text"
              }`}
            >
              {message.content}
              {message.proposal && (
                <div className="mt-2.5 rounded-lg border border-line bg-surface p-3">
                  <p className="text-[12px] font-semibold text-text">
                    {t("proposalTitle")}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {message.proposal.items.map((item) => (
                      <li
                        key={item.goalId}
                        className="flex items-baseline justify-between gap-3 text-[12.5px]"
                      >
                        <span className="min-w-0 truncate text-text-muted">
                          {item.name}
                        </span>
                        <span className="font-mono text-text tabular-nums">
                          + {formatMoney(item.addMinor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-[12.5px]">
                    <span className="text-text-muted">{t("proposalTotal")}</span>
                    <span className="font-mono font-semibold text-text tabular-nums">
                      + {formatMoney(message.proposal.addTotalMinor)}
                    </span>
                  </div>
                  {/* One button through the whole lifecycle (idle → applying
                      → applied), aria-disabled rather than disabled: a native
                      disabled or a swapped-in <p> drops keyboard focus on the
                      floor mid-apply, and the name change announces the
                      outcome instead. The click handler is guarded in
                      applyProposal, so aria-disabled is honest. */}
                  <button
                    type="button"
                    onClick={() => applyProposal(index)}
                    aria-disabled={applying !== null || message.proposalApplied}
                    className={`mt-2.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
                      message.proposalApplied
                        ? "cursor-default bg-positive-soft text-positive"
                        : applying !== null
                          ? "cursor-default bg-accent text-white opacity-40"
                          : "cursor-pointer bg-accent text-white hover:bg-accent-hover"
                    }`}
                  >
                    {message.proposalApplied ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : applying === index ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <PiggyBank className="size-3.5" aria-hidden />
                    )}
                    {message.proposalApplied
                      ? t("proposalApplied")
                      : applying === index
                        ? t("proposalApplying")
                        : t("proposalApply")}
                  </button>
                  {!message.proposalApplied && message.proposalError && (
                    <p className="mt-1.5 text-[12px] text-danger" role="alert">
                      {message.proposalError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {pending && (
          <div className="flex justify-start duration-300 animate-in fade-in slide-in-from-bottom-2">
            <div
              className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-line bg-bg px-4 py-3"
              role="status"
              aria-label={t("thinking")}
            >
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-2 w-2 rounded-full bg-accent"
                  style={{
                    animation: "chat-dot 1.2s ease-in-out infinite",
                    animationDelay: `${dot * 0.18}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <form
        className="border-t border-line px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        {followUps.length > 0 && !pending && (
          <div
            /* role="group" is what makes the aria-label real: on a role-less
               div the label sits on an implicit "generic" role, where ARIA
               prohibits naming, and assistive tech ignores it. */
            role="group"
            className="mb-2.5 flex gap-2 overflow-x-auto pb-0.5"
            aria-label={t("followUpsLabel")}
          >
            {followUps.map((followUp, index) => (
              <button
                key={followUp}
                type="button"
                onClick={() => send(followUp)}
                className="shrink-0 cursor-pointer rounded-full border border-line bg-bg px-3 py-1.5 text-[12px] text-text-muted transition-colors duration-300 animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards hover:border-accent hover:bg-accent-soft hover:text-accent"
                style={{ animationDelay: `${index * 90}ms` }}
              >
                {followUp}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("inputPlaceholder")}
            maxLength={2000}
            className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-[16px] sm:text-[13.5px] text-text placeholder:text-text-subtle focus:ring-1 focus:ring-accent focus:outline-none"
            aria-label={t("inputLabel")}
          />
          <button
            type="submit"
            disabled={pending || input.trim() === ""}
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
            aria-label={t("send")}
          >
            <Send className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-[11px] text-text-subtle">{t("disclaimer")}</p>
      </form>
    </div>
  );
}
