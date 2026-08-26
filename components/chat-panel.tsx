"use client";

import { BellOff, Check, Loader2, PiggyBank, Send, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { applyBudgetFix } from "@/app/actions/budget";
import { applyAllocationAdds } from "@/app/actions/savings";
import { ChatEChart } from "@/components/chat-echart";
import { ChatPie } from "@/components/chat-pie";
import {
  SUGGESTION_KEYS,
  type AllocationProposal,
  type AssistantTurn,
  type BudgetFix,
  type ChartSpec,
  type ChatRole,
  type ToolName,
} from "@/lib/assistant";
import type { TurnEvent } from "@/lib/assistant-turn";
import { formatMoney } from "@/lib/insights";
import { DRAGON_SRC, type DragonMood } from "@/lib/nudges";

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

/**
 * The app's own pill, minus its colours: the shape
 * `components/app-header.tsx` gives its account buttons, down to the hairline
 * shadow and the press. The chat used to draw its own — a `--bg` fill, which
 * is white on white in light mode, hovering to the accent — so the one card on
 * `/home` that offers things looked unlike everything else the app offers.
 */
export const CHAT_PILL_SHAPE =
  "max-w-full cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] font-medium shadow-2xs transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-40";

/** The shape in its default colours. A pill that wants other ones takes the
 * shape and brings its own, rather than appending a second `bg-*` and hoping
 * the cascade lands the right way round. */
export const CHAT_PILL = `${CHAT_PILL_SHAPE} border-line bg-surface text-text hover:border-line-strong hover:bg-surface-muted`;

/** What the panel says while a turn runs. */
export type TurnStatus = { tools: ToolName[]; period?: string };

/**
 * One turn, read as it arrives.
 *
 * `/api/assistant` answers with NDJSON — one `TurnEvent` per line — so the
 * status can change several times before the answer lands. Throws only when
 * the stream itself fails; a turn that went wrong server-side arrives as an
 * ordinary event carrying its own sentence.
 */
async function readTurn(
  history: { role: ChatRole; content: string }[],
  locale: string,
  onStatus?: (status: TurnStatus) => void,
): Promise<AssistantTurn> {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, locale }),
  });
  if (!response.ok || !response.body) throw new Error("stream failed to open");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let turn: AssistantTurn | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // A chunk can split a line, so the tail is kept back until it is whole.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as TurnEvent;
      if (event.type === "status") onStatus?.({ tools: event.tools, period: event.period });
      else turn = event.turn;
    }
  }

  if (!turn) throw new Error("stream ended without an answer");
  return turn;
}

/** Not `ChatMessage` — `lib/assistant.ts` owns that name for the wire shape. */
export type PanelMessage = {
  role: ChatRole;
  content: string;
  /** The chart under the bubble, when the turn produced one. */
  chart?: ChartSpec;
  /** A validated surplus split, rendered as a card with an Apply button. */
  proposal?: AllocationProposal;
  /**
   * The face this reply came back wearing. Kept on the message rather than on
   * the panel for the same reason `proposalApplied` is: the panel unmounts
   * when the shell toggles away from it, and a transcript scrolled back
   * through has to still show what each answer looked like.
   */
  mood?: DragonMood;
  /** Apply state lives on the message, not the panel: the panel unmounts
   * when the shell toggles away from it, and an applied card has to stay
   * applied. */
  proposalApplied?: boolean;
  proposalError?: string;
  /** The broken budgets this answer came with, as a card of two-button rows. */
  budget?: BudgetFix;
  /** What has been done to each category on that card, kept on the message for
   *  the same reason `proposalApplied` is. */
  budgetDone?: Record<string, "raise" | "mute">;
  budgetError?: string;
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
  /** What the turn is doing right now, while `pending`. Empty `tools` means
   * the model is still deciding. */
  status: TurnStatus | null;
  send: (text: string) => void;
  /** Index of the message whose proposal is being applied, if any. */
  applying: number | null;
  applyProposal: (index: number) => void;
  /** `<message index>:<category>` while one budget row is being written. */
  fixing: string | null;
  applyBudget: (index: number, category: string, action: "raise" | "mute") => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Holds one conversation. Call it in the shell, not in the panel — see the
 * note above about why that placement is load-bearing.
 */
export function useAssistantChat(): AssistantChat {
  const t = useTranslations("Chat");
  const locale = useLocale();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  // Plain state, not `useTransition`. A transition commits its updates once,
  // when it settles — so the status set before the first await rendered and
  // every later one was swallowed, leaving "Batzi is thinking" on screen for
  // the whole turn. The point of the stream is the updates in between.
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<TurnStatus | null>(null);
  const [applying, setApplying] = useState<number | null>(null);
  /** `<message index>:<category>` while one budget row is being written. */
  const [fixing, setFixing] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || pending) return;

    const history = [...messages, { role: "user" as const, content }];
    setMessages(history);
    setFollowUps([]);
    setInput("");

    void (async () => {
      setPending(true);
      setStatus({ tools: [] });
      let turn: AssistantTurn | undefined;
      try {
        // Streamed, not awaited in one piece: a charted answer is three round
        // trips of the model thinking for ten to fifteen seconds apiece, and a
        // row of dots for all of it says nothing. Each event names what the
        // turn is doing; the last one carries the answer.
        turn = await readTurn(
          // Cards are client-side decoration; the server only wants the words.
          history.map(({ role, content }) => ({ role, content })),
          locale,
          setStatus,
        );
      } catch {
        // A dropped stream or an unreachable server. The turn's own failures
        // arrive as a normal `turn` event with `error` set, and read as the
        // sentence they carry rather than this one.
      }
      setStatus(null);
      setMessages((prev) => [
        ...prev,
        turn
          ? {
              role: "assistant",
              content: turn.reply,
              chart: turn.chart,
              proposal: turn.proposal,
              budget: turn.budget,
              mood: turn.mood,
              error: turn.error,
            }
          : { role: "assistant", content: t("failed"), mood: "sad", error: true },
      ]);
      setFollowUps(turn?.followUps ?? []);
      setPending(false);
    })();
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

  /**
   * One row of the broken-budget card: raise this category's limit to what was
   * spent, or stop warning about it.
   *
   * The client sends the category and which of the two, never a figure — the
   * action resolves what "raise" means from the same overview the card was
   * built from, exactly as `applyAllocationAdds` recomputes the surplus
   * ceiling. The outcome lands on the message, so a card acted on stays acted
   * on across a toggle away from the panel and back.
   */
  const applyBudget = (index: number, category: string, action: "raise" | "mute") => {
    const message = messages[index];
    if (!message?.budget || message.budgetDone?.[category] || fixing !== null) return;

    setFixing(`${index}:${category}`);
    void (async () => {
      let done = false;
      let error: string | undefined;
      try {
        const result = await applyBudgetFix({ category, action });
        done = result.ok;
        if (!result.ok) error = result.error;
      } catch {
        error = t("failed");
      }
      setMessages((prev) =>
        prev.map((entry, i) =>
          i === index
            ? {
                ...entry,
                budgetDone: done
                  ? { ...entry.budgetDone, [category]: action }
                  : entry.budgetDone,
                budgetError: error,
              }
            : entry,
        ),
      );
      setFixing(null);
      // The budget page and the entry page's deck both just changed.
      if (done) router.refresh();
    })();
  };

  return {
    messages,
    input,
    setInput,
    followUps,
    pending,
    status,
    send,
    applying,
    applyProposal,
    fixing,
    applyBudget,
    scrollRef,
  };
}

export function ChatPanel({
  chat,
  className = "",
  /**
   * The transcript's own box. The inline panel pins it to a constant height
   * rather than letting it take the leftover space, so the page below the chat
   * does not shift on every reply.
   */
  scrollClassName = "flex-1",
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
    status,
    send,
    applying,
    applyProposal,
    fixing,
    applyBudget,
    scrollRef,
  } = chat;

  /**
   * What the turn is doing, in this reader's language. A tool with no phrase
   * of its own falls back to the generic line rather than throwing — next-intl
   * treats a missing key as an error, and a tool added later must not be able
   * to take the panel down. Several tools in one round are joined, since the
   * model does sometimes ask for two at once.
   */
  // The pictures' own namespace. Read here rather than passed in, because the
  // string describes the *drawing* — see `components/dragon-buddy.tsx`.
  const tDragon = useTranslations("Dragon");

  const statusLabel = (() => {
    if (!status || status.tools.length === 0) return t("thinking");
    const named = status.tools
      .map((tool) => (t.has(`status.${tool}`) ? t(`status.${tool}`) : undefined))
      .filter((phrase): phrase is string => Boolean(phrase));
    return named.length > 0 ? named.join(" · ") : t("thinking");
  })();

  // Keep the newest bubble in view — including the typing indicator. The
  // effect lives HERE, not in the hook: the hook survives in the shell while
  // this panel (and its scroll container) unmounts whenever the shell toggles
  // away from it, so a hook-side effect keyed on [messages, pending] never
  // re-fires on the way back and the transcript returned scrolled to the top.
  // Nothing to follow before the first turn, and following anyway is visible
  // wherever the empty state is taller than its box: the panel opens on the
  // *last* starter chip with the one above it sliced in half.
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
        className={`space-y-3 overflow-y-auto px-3.5 py-3.5 ${scrollClassName}`}
      >
        {messages.length === 0 && (
          <div className="duration-500 animate-in fade-in">
            <p className="text-[13.5px] text-text-muted">{t("intro")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => send(t(key))}
                  className={CHAT_PILL}
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
            className={`flex items-end gap-2 duration-300 animate-in fade-in slide-in-from-bottom-2 ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {/* Batzi, wearing the face the *model* picked for this answer —
                see `MOOD_INSTRUCTION` in `lib/assistant.ts`. The assistant is
                him, so a transcript of bare bubbles was the one place in the
                app where he was being quoted without being shown.

                A message with no mood still gets a face: `sad` on an error
                (the turn never reached the model, or came back broken) and the
                neutral one otherwise, which is also what an older transcript
                restored from before this existed renders as.

                A plain `<img>`, like `merchant-avatar.tsx` — a small asset on
                our own origin. `items-end` sits it on the bubble's baseline,
                so it stays put as the bubble grows a chart underneath it. */}
            {message.role === "assistant" && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={DRAGON_SRC[message.mood ?? (message.error ? "sad" : "happy")]}
                alt={tDragon(message.mood ?? (message.error ? "sad" : "happy"))}
                width={512}
                height={512}
                className="size-9 shrink-0 drop-shadow-sm"
              />
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] whitespace-pre-wrap ${
                message.role === "user"
                  ? "rounded-br-sm bg-accent text-white"
                  : message.error
                    ? "rounded-bl-sm bg-danger-soft text-danger-hover"
                    : /* `--bg` is white in light mode, so this bubble used to
                         be a white box on a white card held together by its
                         border. The app's own filled ground reads as a bubble
                         without one, and darkens correctly in `.dark`. */
                      "rounded-bl-sm bg-surface-muted text-text"
              }`}
            >
              {message.content}
              {message.chart && (
                <div className="mt-2.5 rounded-lg border border-line bg-surface p-3">
                  {message.chart.kind === "echarts" ? (
                    <ChatEChart chart={message.chart} />
                  ) : (
                    <ChatPie chart={message.chart} />
                  )}
                </div>
              )}
              {message.budget && (
                /* The sibling of the allocation card, and the same contract:
                   the app assembled it from its own figures, and nothing has
                   changed until one of these buttons is pressed. Two per row,
                   because there are exactly two honest answers to a broken
                   budget — the limit was wrong, or the warning is. */
                <div className="mt-2.5 rounded-lg border border-line bg-surface p-3">
                  <p className="text-[12px] font-semibold text-text">
                    {t("budgetFixTitle")}
                  </p>
                  <ul className="mt-2 space-y-2.5">
                    {message.budget.rows.map((budgetRow) => {
                      const done = message.budgetDone?.[budgetRow.category];
                      const busy = fixing === `${index}:${budgetRow.category}`;
                      return (
                        <li key={budgetRow.category}>
                          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                            <span className="min-w-0 truncate font-medium text-text">
                              {budgetRow.category}
                            </span>
                            <span className="shrink-0 font-mono text-danger tabular-nums">
                              {/* Only the overspend: the Raise button beside
                                  it already names the limit it would become,
                                  and printing the old one next to the gap read
                                  as one figure compared with another. */}
                              {t("budgetFixOver", {
                                amount: formatMoney(budgetRow.overMinor),
                              })}
                            </span>
                          </div>
                          {/* `aria-disabled` rather than `disabled`, the same
                              choice the Apply button documents: a native
                              disabled drops keyboard focus mid-write, and the
                              name change is what announces the outcome. The
                              handlers are guarded in `applyBudget`. */}
                          <div className="mt-1.5 flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                applyBudget(index, budgetRow.category, "raise")
                              }
                              aria-disabled={done !== undefined || fixing !== null}
                              className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium transition-colors ${
                                done === "raise"
                                  ? "cursor-default bg-positive-soft text-positive"
                                  : done !== undefined || fixing !== null
                                    ? "cursor-default bg-accent text-white opacity-40"
                                    : "cursor-pointer bg-accent text-white hover:bg-accent-hover"
                              }`}
                            >
                              {done === "raise" ? (
                                <Check className="size-3.5" aria-hidden />
                              ) : busy ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              ) : (
                                <TrendingUp className="size-3.5" aria-hidden />
                              )}
                              {done === "raise"
                                ? t("budgetFixRaised")
                                : t("budgetFixRaise", {
                                    amount: formatMoney(budgetRow.usedMinor),
                                  })}
                            </button>

                            {/* Only where there is a warning left to switch
                                off. A category already silenced has one honest
                                offer, not two. */}
                            {(budgetRow.warns || done === "mute") && (
                              <button
                                type="button"
                                onClick={() =>
                                  applyBudget(index, budgetRow.category, "mute")
                                }
                                aria-disabled={done !== undefined || fixing !== null}
                                className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors ${
                                  done === "mute"
                                    ? "cursor-default border-line bg-positive-soft text-positive"
                                    : done !== undefined || fixing !== null
                                      ? "cursor-default border-line text-text-subtle opacity-40"
                                      : "cursor-pointer border-line-strong text-text hover:bg-surface-hover"
                                }`}
                              >
                                {done === "mute" ? (
                                  <Check className="size-3.5" aria-hidden />
                                ) : (
                                  <BellOff className="size-3.5" aria-hidden />
                                )}
                                {done === "mute" ? t("budgetFixMuted") : t("budgetFixMute")}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {message.budgetError && (
                    <p className="mt-1.5 text-[12px] text-danger" role="alert">
                      {message.budgetError}
                    </p>
                  )}
                </div>
              )}
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
          <div className="flex flex-col items-start gap-1.5 duration-300 animate-in fade-in slide-in-from-bottom-2">
            {/* What the wait is for. The tool names are the model's own
                choices, so this is a report rather than a guess — and on a
                charted answer it changes two or three times before the words
                arrive. */}
            <p
              className="px-1 text-[12px] text-text-muted"
              role="status"
              aria-live="polite"
            >
              {statusLabel}
            </p>
            {/* The one face the app chooses rather than the model — it has not
                answered yet, so there is nothing for it to have an expression
                about. `aria-hidden` on the whole row: the status line above
                already names what is happening, and the dots and the mascot
                are two more ways of saying it. */}
            <div className="flex items-end gap-2" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={DRAGON_SRC.typing}
                alt=""
                width={512}
                height={512}
                className="size-9 shrink-0 drop-shadow-sm"
              />
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-surface-muted px-4 py-3">
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
          </div>
        )}
      </div>

      <form
        className="border-t border-line px-3.5 py-3"
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
                /* This row scrolls sideways, so its pills keep their width
                   and their single line — the opposite of the wrapped ones
                   above, which is why neither belongs in the shared class. */
                className={`${CHAT_PILL} shrink-0 whitespace-nowrap duration-300 animate-in fade-in slide-in-from-bottom-1 fill-mode-backwards`}
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
