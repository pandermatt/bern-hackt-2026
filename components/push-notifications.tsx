"use client";

import { Bell, BellOff, Check, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import {
  deletePushSubscription,
  savePushSubscription,
  sendTestPushNotification,
} from "@/app/actions/push";
import { SettingsRow } from "@/components/settings-row";
import { TEST_PUSH_DELAY_SECONDS } from "@/lib/push-config";
import { urlBase64ToUint8Array } from "@/lib/push-key";
import { useHydrated } from "@/lib/use-hydrated";
import { CONTROL, useIosSafari, useStandalone } from "@/lib/use-install-state";

/**
 * The account page's notification rows, in the Preferences group — a push
 * subscription belongs to *this browser* on *this device*, the same as the
 * theme, the language and installing that it sits with.
 *
 * Two rows rather than one. The first is the setting: on, off, or a sentence
 * saying why neither is on offer here. The second is the test send, which only
 * exists once there is somewhere to send to — a button that can only fail is
 * worse than no button, which is the same argument `install-app.tsx` makes
 * about `beforeinstallprompt`.
 *
 * The states the first row can be in, and why each has no button:
 *
 * - **Not configured.** No VAPID keypair on the server, so `publicKey` arrives
 *   null and nothing can be subscribed. Push is optional; the app runs without
 *   it and says so rather than offering a control that throws.
 * - **Unsupported.** No `PushManager`, or no `Notification`. Firefox on iOS,
 *   older browsers, and anything with notifications disabled at the OS level.
 * - **iOS, not installed.** Safari implements push only inside a home-screen
 *   app, and `requestPermission()` from a tab there does nothing at all. The
 *   note points at the install row directly above.
 * - **Denied.** A permission prompt is one-shot; once refused, only the
 *   browser's own site settings can undo it, and calling `requestPermission()`
 *   again resolves "denied" without showing anything. Say where to go instead.
 */

/** Whether this browser can do Web Push at all. Browser-only, hence the store. */
const subscribeNothing = () => () => {};

function usePushSupported(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () =>
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    () => false,
  );
}

/** `Notification.permission`, or "default" where the API does not exist. */
function usePermission(): NotificationPermission {
  return useSyncExternalStore(
    subscribeNothing,
    () => ("Notification" in window ? Notification.permission : "default"),
    () => "default" as NotificationPermission,
  );
}

export function PushNotifications({ publicKey }: { publicKey: string | null }) {
  const t = useTranslations("PushNotifications");
  const hydrated = useHydrated();

  const supported = usePushSupported();
  const initialPermission = usePermission();
  const standalone = useStandalone();
  const ios = useIosSafari();

  /*
   * The permission after we have asked for it. `usePermission` reads a value
   * that does not change under a mounted component *unless this row changes
   * it*, so the live answer is the store's until the button overrides it.
   */
  const [granted, setGranted] = useState<NotificationPermission | null>(null);
  const permission = granted ?? initialPermission;

  /** The endpoint of this browser's subscription, or null. `undefined` = still looking. */
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  /*
   * Whether this browser is already subscribed is a genuinely async question —
   * it needs the worker to be ready and then a promise from the push manager.
   * The `cancelled` ref plus a `void`-ed async function inside the effect is
   * the shape `anomaly-scan-controls.tsx` already uses for the same problem;
   * the setState lands after an await, not in the effect body.
   */
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    async function read() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled.current) setEndpoint(null);
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!cancelled.current) setEndpoint(subscription?.endpoint ?? null);
      } catch {
        // No worker, or the browser refused: either way, nothing is subscribed.
        if (!cancelled.current) setEndpoint(null);
      }
    }

    void read();

    return () => {
      cancelled.current = true;
    };
  }, []);

  const subscribed = endpoint !== null && endpoint !== undefined;

  function enable() {
    if (!publicKey) return;

    startTransition(async () => {
      try {
        const answer = await Notification.requestPermission();
        setGranted(answer);
        if (answer !== "granted") return;

        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          // Required, and true is the only value a browser accepts: every
          // push this app sends shows a notification.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        const result = await savePushSubscription(subscription.toJSON());
        if (!result.ok) {
          // The server would not keep it, so neither should the browser —
          // otherwise the row reads "on" and nothing can ever be delivered.
          await subscription.unsubscribe();
          toast.error(t(`error_${result.error}`));
          return;
        }

        setEndpoint(subscription.endpoint);
        toast.success(t("enabledToast"));
      } catch {
        toast.error(t("error_subscribeFailed"));
      }
    });
  }

  function disable() {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
          await subscription.unsubscribe();
          await deletePushSubscription(subscription.endpoint);
        }

        setEndpoint(null);
      } catch {
        toast.error(t("error_subscribeFailed"));
      }
    });
  }

  function sendTest() {
    startTransition(async () => {
      const result = await sendTestPushNotification();
      if (!result.ok) {
        // The action answers with a code, not a sentence — see its note.
        toast.error(t(`error_${result.error}`));
        return;
      }
      toast.success(t("testQueued", { seconds: TEST_PUSH_DELAY_SECONDS }));
    });
  }

  // Which of the states above applies is only knowable in the browser, so
  // before hydration the row is the neutral note and no control at all —
  // guessing would flash the wrong one.
  const blocked = !publicKey
    ? "notConfigured"
    : !supported
      ? "unsupported"
      : ios && !standalone
        ? "iosInstall"
        : permission === "denied"
          ? "denied"
          : null;

  const note = !hydrated
    ? t("note")
    : blocked === "notConfigured"
      ? t("notConfiguredNote")
      : blocked === "unsupported"
        ? t("unsupportedNote")
        : blocked === "iosInstall"
          ? t("iosInstallNote")
          : blocked === "denied"
            ? t("blockedNote")
            : subscribed
              ? t("enabledNote")
              : t("note");

  return (
    <>
      <SettingsRow label={t("title")} note={note}>
        {hydrated && !blocked && subscribed && (
          <div className="flex shrink-0 items-center gap-2">
            <p className="flex items-center gap-2 rounded-full bg-accent-soft px-4 py-2 text-[13px] font-medium text-accent sm:py-1.5">
              <Check className="size-3.5" aria-hidden />
              {t("enabled")}
            </p>
            <button
              type="button"
              onClick={disable}
              disabled={pending}
              className={CONTROL}
            >
              <BellOff className="size-3.5 text-text-subtle" aria-hidden />
              {t("disable")}
            </button>
          </div>
        )}

        {/* `endpoint === undefined` means the lookup has not answered yet.
            Offering "Enable" to a browser that is already subscribed, for the
            half-second that takes, is how you get a second permission prompt. */}
        {hydrated && !blocked && endpoint === null && (
          <button
            type="button"
            onClick={enable}
            disabled={pending}
            className={CONTROL}
          >
            <Bell className="size-3.5 text-text-subtle" aria-hidden />
            {t("enable")}
          </button>
        )}
      </SettingsRow>

      {hydrated && !blocked && subscribed && (
        <SettingsRow
          label={t("testTitle")}
          note={t("testNote", { seconds: TEST_PUSH_DELAY_SECONDS })}
        >
          <button
            type="button"
            onClick={sendTest}
            disabled={pending}
            className={CONTROL}
          >
            <Send className="size-3.5 text-text-subtle" aria-hidden />
            {t("testAction")}
          </button>
        </SettingsRow>
      )}
    </>
  );
}
