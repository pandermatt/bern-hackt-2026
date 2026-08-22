"use client";

import { Bug, MessageCircle, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatDebug } from "@/components/chat-debug";
import { ChatPanel, useAssistantChat } from "@/components/chat-panel";

/**
 * The one interactive island besides the filters. Deliberately a client
 * component: a chat cannot be anything else — but the finances themselves
 * stay server-side. The bundle holds no transaction rows; the only figures
 * that ever reach the browser are the ones a reply explicitly carries.
 *
 * This is the *shell*: a launcher, a resizable slide-over, and the chat/debug
 * toggle. The conversation itself lives in `components/chat-panel.tsx`, which
 * the entry page mounts inline instead.
 *
 * **`useAssistantChat()` is called here, above the `open &&` branch, and that
 * placement is load-bearing.** This component never unmounts — it renders the
 * launcher when closed — so holding the transcript at this level is what makes
 * it survive closing and reopening the panel. Move the hook inside the branch
 * and every close silently discards the conversation.
 */
/** The drag-resizable panel width, in pixels, clamped to sane bounds. */
const MIN_WIDTH = 340;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 400;
const WIDTH_KEY = "beyond-money:assistant-width";

function clampWidth(value: number): number {
  // Never wider than the viewport minus a sliver, so the page stays reachable.
  const ceiling = Math.min(MAX_WIDTH, window.innerWidth - 80);
  return Math.max(MIN_WIDTH, Math.min(ceiling, value));
}

export function ChatSidebar() {
  const t = useTranslations("Chat");
  const chat = useAssistantChat();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "debug">("chat");
  // Below the `sm` breakpoint the panel is full-width and resizing is off; on
  // wider screens the width is a drag-set, persisted pixel value. Read from
  // localStorage in a lazy initializer (not an effect): it is SSR-safe via the
  // window guard, and the width-bearing panel isn't rendered until the user
  // opens it — a client interaction — so there is no hydration mismatch.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : DEFAULT_WIDTH;
  });
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    setDragging(true);
    const move = (e: PointerEvent) => {
      // The panel is anchored to the right edge, so its width is the distance
      // from the pointer to that edge.
      setWidth(clampWidth(window.innerWidth - e.clientX));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidth((current) => {
        window.localStorage.setItem(WIDTH_KEY, String(current));
        return current;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  // Opening focuses the field and arms Escape. The focus lands on the panel's
  // input through the ref below — the effect still runs after the commit that
  // mounted it, so the timing is what it always was.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-5 bottom-5 z-40 inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-accent text-white shadow-lg transition-all duration-200 animate-in fade-in zoom-in-75 hover:scale-105 hover:bg-accent-hover"
          aria-label={t("openLabel")}
        >
          <MessageCircle className="size-5" />
        </button>
      )}

      {open && (
        <>
        {/* Transparent, viewport-filling capture layer during a drag, so the
            pointer stream isn't lost the moment it crosses the chart canvas. */}
        {dragging && (
          <div className="fixed inset-0 z-50 cursor-col-resize" aria-hidden />
        )}
        <aside
          role="dialog"
          aria-label={t("panelLabel")}
          className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-lg animate-in fade-in slide-in-from-right sm:w-(--assistant-width) ${
            dragging ? "" : "duration-300"
          }`}
          style={{ "--assistant-width": `${width}px` } as React.CSSProperties}
        >
          {/* Drag handle: a hairline that widens the hit target beyond it, and
              only exists at the sm breakpoint where the panel isn't full-width.
              While dragging, an overlay (below) captures the pointer. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resizeLabel")}
            onPointerDown={startResize}
            className="absolute inset-y-0 left-0 hidden w-1.5 -translate-x-1/2 cursor-col-resize touch-none sm:block"
          >
            <div
              className={`h-full w-px transition-colors ${
                dragging ? "bg-accent" : "bg-transparent hover:bg-line-strong"
              }`}
            />
          </div>

          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand">
              <Sparkles className="size-4 text-text" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14.5px] leading-tight font-semibold text-text">
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
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              aria-label={t("close")}
            >
              <X className="size-4" />
            </button>
          </header>

          {/* A sibling of the panel, not a child: it needs its own `flex-1`
              against the aside. */}
          {view === "debug" ? (
            <ChatDebug />
          ) : (
            <ChatPanel chat={chat} inputRef={inputRef} className="flex-1" />
          )}
        </aside>
        </>
      )}
    </>
  );
}
