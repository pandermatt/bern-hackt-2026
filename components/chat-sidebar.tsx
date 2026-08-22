"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bug, MessageCircle, Send, Sparkles, X } from "lucide-react";

import { askAssistant } from "@/app/actions/chat";
import { ChatDebug } from "@/components/chat-debug";
import { ChatEChart } from "@/components/chat-echart";
import { ChatPie } from "@/components/chat-pie";
import type { ChartSpec, ChatRole } from "@/lib/assistant";

type Message = {
  role: ChatRole;
  content: string;
  chart?: ChartSpec;
  error?: boolean;
};

/**
 * These land in the empty state as one-tap starters, and each is phrased to
 * trip a different branch of `pickChart`, so the demo shows a chart early.
 */
const SUGGESTIONS = [
  "Where does my money go YTD?",
  "Who are my top merchants YTD?",
  "How much of my income is salary?",
  "How much did I save this year?",
];

/**
 * The one interactive island besides the filters. Deliberately a client
 * component: a chat cannot be anything else — but the finances themselves
 * stay server-side. The bundle holds no transaction rows; the only figures
 * that ever reach the browser are the ones a reply explicitly carries.
 */
export function ChatSidebar() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "debug">("chat");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest bubble in view — including the typing indicator.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || pending) return;

    const history = [...messages, { role: "user" as const, content }];
    setMessages(history);
    setFollowUps([]);
    setInput("");

    startTransition(async () => {
      try {
        // Charts are client-side decoration; the action only wants the words.
        const turn = await askAssistant(
          history.map(({ role, content }) => ({ role, content })),
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: turn.reply,
            chart: turn.chart,
            error: turn.error,
          },
        ]);
        setFollowUps(turn.followUps ?? []);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Something went wrong — try asking again.",
            error: true,
          },
        ]);
      }
    });
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-5 bottom-5 z-40 inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-accent text-white shadow-lg transition-all duration-200 animate-in fade-in zoom-in-75 hover:scale-105 hover:bg-accent-hover"
          aria-label="Ask the money assistant"
        >
          <MessageCircle className="size-5" />
        </button>
      )}

      {open && (
        <aside
          role="dialog"
          aria-label="Money assistant"
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-lg duration-300 animate-in fade-in slide-in-from-right sm:w-[400px]"
        >
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand">
              <Sparkles className="size-4 text-text" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14.5px] leading-tight font-semibold text-text">
                {view === "debug" ? "Request log" : "Money assistant"}
              </h2>
              <p className="text-[12px] text-text-muted">
                {view === "debug"
                  ? "What went over the wire"
                  : "Ask anything about your year"}
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
              aria-label="Toggle request log"
              title="Request log"
            >
              <Bug className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              aria-label="Close assistant"
            >
              <X className="size-4" />
            </button>
          </header>

          {view === "debug" ? (
            <ChatDebug />
          ) : (
            <>
            <div
              ref={scrollRef}
              className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            >
              {messages.length === 0 && (
                <div className="duration-500 animate-in fade-in">
                  <p className="text-[13.5px] text-text-muted">
                    I can summarise your spending, compare months, rank merchants
                    — and draw the picture where it helps.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => send(suggestion)}
                        className="cursor-pointer rounded-full border border-line bg-bg px-3 py-1.5 text-[12.5px] text-text transition-colors hover:border-accent hover:text-accent"
                      >
                        {suggestion}
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
                    {message.chart && message.chart.kind === "echarts" ? (
                      <div className="mt-2.5 rounded-lg border border-line bg-surface p-3">
                        <ChatEChart chart={message.chart} />
                      </div>
                    ) : message.chart && (
                      <div className="mt-2.5 rounded-lg border border-line bg-surface p-3">
                        <ChatPie chart={message.chart} />
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
                    aria-label="The assistant is thinking"
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
                  className="mb-2.5 flex gap-2 overflow-x-auto pb-0.5"
                  aria-label="Suggested follow-up questions"
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
                  placeholder="Ask about your finances…"
                  maxLength={2000}
                  className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-text placeholder:text-text-subtle focus:ring-1 focus:ring-accent focus:outline-none"
                  aria-label="Message the assistant"
                />
                <button
                  type="submit"
                  disabled={pending || input.trim() === ""}
                  className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Send message"
                >
                  <Send className="size-4" />
                </button>
              </div>
              <p className="mt-2 text-[11px] text-text-subtle">
                Answers come from Apertus over your imported statements. Charts
                are drawn from the real figures, not the model.
              </p>
            </form>
            </>
          )}
        </aside>
      )}
    </>
  );
}
