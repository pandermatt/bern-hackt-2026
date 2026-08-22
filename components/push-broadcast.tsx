"use client";

import { Megaphone, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  broadcastAnomalyNotification,
  broadcastPushNotification,
  type BroadcastResult,
} from "@/app/actions/push";
import { FIELD } from "@/components/auth-form";
import { SettingsRow } from "@/components/settings-row";

/**
 * The two stage controls: one press that sends the app's own "found new
 * anomaly" notification to everyone, and a form for anything else.
 *
 * **Demo controls.** Both reach every subscribed device on the deployment, not
 * just this account's, and both are gated on `PUSH_BROADCAST_ENABLED=1` on the
 * server — with the flag unset the account page does not render them *and* the
 * actions refuse, because a `"use server"` export is reachable by POST whether
 * or not a button points at it.
 *
 * Kept in its own file rather than folded into `push-notifications.tsx` for
 * the same reason: after the presentation this component, its two actions and
 * the flag come out together, and nothing else has to be untangled.
 *
 * Neither has the test send's twenty-second delay. On stage the phones should
 * go off while you are still talking.
 */

const BUTTON =
  "flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-md bg-accent px-4 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60";

export function PushBroadcast() {
  const t = useTranslations("PushBroadcast");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");

  /*
   * One transition per button, not one shared: pressing the anomaly button
   * must not grey out the form the presenter is still typing into.
   */
  const [anomalyPending, startAnomaly] = useTransition();
  const [customPending, startCustom] = useTransition();

  /** Both buttons report the same two ways, so they announce the same way. */
  function announce(result: BroadcastResult, onSent?: () => void) {
    if (!result.ok) {
      // The actions answer with a code, not a sentence — see their notes.
      toast.error(t(`error_${result.error}`));
      return;
    }
    toast.success(t("sent", { devices: result.devices }));
    onSent?.();
  }

  function sendAnomaly() {
    startAnomaly(async () => announce(await broadcastAnomalyNotification()));
  }

  function sendCustom() {
    if (!title.trim()) return;

    startCustom(async () =>
      announce(await broadcastPushNotification({ title, body, url }), () => {
        setTitle("");
        setBody("");
        setUrl("");
      }),
    );
  }

  return (
    <>
      <SettingsRow label={t("anomalyTitle")} note={t("anomalyNote")}>
        <button
          type="button"
          onClick={sendAnomaly}
          disabled={anomalyPending}
          className={`${BUTTON} max-sm:w-full`}
        >
          <TriangleAlert className="size-3.5" aria-hidden />
          {anomalyPending ? t("sending") : t("anomalyAction")}
        </button>
      </SettingsRow>

      <SettingsRow
        label={t("title")}
        note={t("note")}
        labelFor="broadcast-title"
        /* Three fields will not sit beside a label on a phone, so they span
           the row underneath it — which is what `detail` is for. */
        detail={
          <div className="mt-3 flex flex-col gap-2">
            <input
              id="broadcast-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder={t("placeholderTitle")}
              aria-label={t("labelTitle")}
              className={`${FIELD} w-full`}
            />
            <input
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={240}
              placeholder={t("placeholderBody")}
              aria-label={t("labelBody")}
              className={`${FIELD} w-full`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                // Enter sends from the last field, so the whole thing is
                // typeable without reaching for the mouse.
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendCustom();
                }}
                maxLength={500}
                placeholder={t("placeholderUrl")}
                aria-label={t("labelUrl")}
                className={`${FIELD} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={sendCustom}
                disabled={customPending || !title.trim()}
                className={`${BUTTON} max-sm:w-full`}
              >
                <Megaphone className="size-3.5" aria-hidden />
                {customPending ? t("sending") : t("action")}
              </button>
            </div>
          </div>
        }
      />
    </>
  );
}
