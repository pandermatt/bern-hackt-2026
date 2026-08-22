"use client";

import { Megaphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { broadcastPushNotification } from "@/app/actions/push";
import { FIELD } from "@/components/auth-form";
import { SettingsRow } from "@/components/settings-row";

/**
 * Sends a typed message to every subscribed device on the deployment.
 *
 * **A demo control.** It exists so a presenter can make a room full of phones
 * buzz on cue, and it is gated on `PUSH_BROADCAST_ENABLED=1` on the server —
 * with the flag unset the account page does not render it *and*
 * `broadcastPushNotification` refuses, because a `"use server"` export is
 * reachable by POST whether or not a button points at it.
 *
 * Kept in its own file rather than folded into `push-notifications.tsx` for
 * the same reason: after the presentation this component, its action and the
 * flag come out together, and nothing else has to be untangled.
 *
 * No delay here, unlike the test send. On stage the phones should go off while
 * you are still talking.
 */
export function PushBroadcast() {
  const t = useTranslations("PushBroadcast");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const trimmed = message.trim();

  function send() {
    if (!trimmed) return;

    startTransition(async () => {
      const result = await broadcastPushNotification(trimmed);
      if (!result.ok) {
        // The action answers with a code, not a sentence — see its note.
        toast.error(t(`error_${result.error}`));
        return;
      }
      toast.success(t("sent", { devices: result.devices }));
      setMessage("");
    });
  }

  return (
    <SettingsRow label={t("title")} note={t("note")} labelFor="broadcast-message">
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full">
        <input
          id="broadcast-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          // Enter sends: on stage nobody wants to find the button by mouse.
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          maxLength={120}
          placeholder={t("placeholder")}
          className={`${FIELD} min-w-0 flex-1 sm:w-64`}
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !trimmed}
          className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-md bg-accent px-4 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
        >
          <Megaphone className="size-3.5" aria-hidden />
          {pending ? t("sending") : t("action")}
        </button>
      </div>
    </SettingsRow>
  );
}
