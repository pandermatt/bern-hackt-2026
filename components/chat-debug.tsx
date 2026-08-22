"use client";

import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";

import { clearAssistantLogAction, getAssistantLog } from "@/app/actions/chat";
// Type-only import — the module itself is `server-only`, but types are erased.
import type { AssistantLogView } from "@/lib/assistant-log";

/**
 * The sidebar's debug menu: every call the assistant made to the model
 * endpoint, newest first, with the exact request and response payloads on
 * demand. Entries live in server memory (a restart empties the list) and are
 * always scoped to the signed-in account.
 */
export function ChatDebug() {
  const t = useTranslations("ChatDebug");
  const [entries, setEntries] = useState<AssistantLogView[] | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      setEntries(await getAssistantLog());
    });
  }, [startTransition]);

  const clear = () => {
    startTransition(async () => {
      await clearAssistantLogAction();
      setEntries(await getAssistantLog());
    });
  };

  // Load once on mount; after that the toolbar's refresh is explicit.
  useEffect(() => refresh(), [refresh]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-text-muted">
          {t("intro")}
        </p>
        <div className="ml-3 flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-muted hover:text-text disabled:opacity-40"
            aria-label={t("refresh")}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={pending || !entries?.length}
            className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
            aria-label={t("clear")}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {entries !== null && entries.length === 0 && (
        <p className="mt-4 text-[13px] text-text-muted">
          {t("empty")}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {entries?.map((entry) => (
          <li
            key={entry.id}
            className="rounded-lg border border-line bg-bg duration-300 animate-in fade-in"
          >
            <div className="flex items-center gap-2 px-3 pt-2.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  entry.status === "ok"
                    ? "bg-positive-soft text-positive"
                    : "bg-danger-soft text-danger"
                }`}
              >
                {entry.status === "ok" ? t("ok") : t("error")}
                {entry.httpStatus !== undefined && ` · ${entry.httpStatus}`}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-text-subtle">
                {new Date(entry.at).toLocaleTimeString()}
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-text-subtle">
                {entry.durationMs}
                {t("milliseconds")}
              </span>
            </div>

            <p
              className="truncate px-3 pt-1.5 text-[12.5px] text-text"
              title={entry.question}
            >
              {entry.question}
            </p>

            <p className="px-3 pt-0.5 text-[11px] text-text-subtle">
              {entry.note && (
                <span className="font-medium text-accent">{entry.note} · </span>
              )}
              {entry.model} {t("max")} {entry.maxTokens} {t("tokens")}
              {entry.usage &&
                ` · ${entry.usage.promptTokens ?? "?"} in / ${entry.usage.completionTokens ?? "?"} out`}
              {entry.messageCount > 0 &&
                ` · ${t("messages", { count: entry.messageCount })}`}
            </p>

            {entry.error && (
              <p className="px-3 pt-1 text-[12px] text-danger">{entry.error}</p>
            )}

            {(entry.request || entry.response) && (
              <details className="group mt-1.5 border-t border-line">
                <summary className="cursor-pointer list-none px-3 py-1.5 text-[11.5px] font-medium text-accent select-none hover:underline">
                  <span className="group-open:hidden">{t("showPayloads")}</span>
                  <span className="hidden group-open:inline">{t("hidePayloads")}</span>
                </summary>
                <div className="space-y-2 px-3 pb-2.5">
                  {entry.request && (
                    <div>
                      <p className="text-[10.5px] font-semibold tracking-wide text-text-subtle uppercase">
                        {t("request")}
                      </p>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-text-muted">
                        {entry.request}
                      </pre>
                    </div>
                  )}
                  {entry.response && (
                    <div>
                      <p className="text-[10.5px] font-semibold tracking-wide text-text-subtle uppercase">
                        {t("response")}
                      </p>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-text-muted">
                        {entry.response}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
