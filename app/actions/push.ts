"use server";

import { and, eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { defaultLocale, isAppLocale, locales, type AppLocale } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth";
import {
  broadcastPush,
  getPushSubscriptions,
  pushBroadcastEnabled,
  pushConfigured,
  sendPushToUser,
  type PushPayload,
} from "@/lib/push";
import { TEST_PUSH_DELAY_MS } from "@/lib/push-config";

/**
 * The subscribe / unsubscribe / test-send half of Web Push.
 *
 * Every export of a `"use server"` module is an endpoint the browser can call
 * with arguments it chooses, so the account is always resolved from the
 * session and never from a parameter — the same rule
 * `getStoredAnomaliesForPage` documents. The endpoint string *is* taken from
 * the client, because only the browser knows it, which is why the delete is
 * scoped by `userId` as well: the string alone would let anyone unsubscribe
 * anyone's device by pasting theirs.
 *
 * Errors come back as codes rather than sentences, like `app/actions/anomalies.ts`
 * — the client turns them into a `sonner` toast through its own translations.
 */

export type PushError =
  | "sessionExpired"
  | "notConfigured"
  | "noSubscription"
  | "notAllowed"
  | "empty"
  | "invalid";

export type PushResult = { ok: true } | { ok: false; error: PushError };

/** A broadcast reports how many devices it reached — see `broadcastPush`. */
export type BroadcastResult =
  | { ok: true; devices: number }
  | { ok: false; error: PushError };

/** Exactly the shape `PushSubscription.toJSON()` produces in the browser. */
const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/**
 * Records this browser's subscription against the signed-in account.
 *
 * An upsert on `endpoint`, not an insert: a browser hands back the same
 * endpoint every time it is asked, so re-enabling notifications on a device
 * that already had them — or signing in as somebody else on it — has to move
 * the row rather than add one. That is also what makes the unique index on
 * `endpoint` the right key.
 */
export async function savePushSubscription(subscription: unknown): Promise<PushResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "sessionExpired" };

  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const requested = await getLocale();
  const locale = isAppLocale(requested) ? requested : defaultLocale;

  const values = {
    userId: user.id,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    locale,
  };

  await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: values.userId,
        p256dh: values.p256dh,
        auth: values.auth,
        locale: values.locale,
      },
    });

  return { ok: true };
}

/** Forgets this browser's subscription. Scoped by owner as well as endpoint. */
export async function deletePushSubscription(endpoint: string): Promise<PushResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "sessionExpired" };

  const parsed = z.string().url().safeParse(endpoint);
  if (!parsed.success) return { ok: false, error: "invalid" };

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, parsed.data),
        eq(pushSubscriptions.userId, user.id),
      ),
    );

  return { ok: true };
}

/**
 * The text of one "found new anomaly" push, in every locale the app has.
 *
 * Resolved up front rather than at send time because `getTranslations` reads
 * the request, and the send happens twenty seconds after the request has
 * returned. Composed for *all* locales rather than for the caller's, so a
 * device that chose the other language still gets its own — see the note on
 * `pushSubscriptions.locale`.
 */
async function anomalyPayloads(): Promise<Record<AppLocale, PushPayload>> {
  const entries = await Promise.all(
    locales.map(async (locale) => {
      const t = await getTranslations({ locale, namespace: "Push" });
      return [
        locale,
        {
          title: t("anomalyTitle"),
          body: t("anomalyBody"),
          url: `/${locale}/anomalies`,
          tag: "anomaly",
        } satisfies PushPayload,
      ] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<AppLocale, PushPayload>;
}

/**
 * Sends the test notification — twenty seconds from now, not now.
 *
 * The delay is the feature: a notification that pops up while you are still
 * looking at the button proves only that the page can draw one. Waiting long
 * enough to close the app and lock the phone is what shows a real push
 * arriving on a sleeping device, and it is why this is a server-held timer
 * rather than a `setTimeout` in the page — a page timer is frozen the moment
 * the tab goes to the background, which is exactly when it would need to run.
 *
 * Everything request-derived is resolved *before* the timer is armed. Inside
 * the callback there is no request: `cookies()`, `getLocale()` and
 * `getTranslations()` all have nothing to read.
 */
export async function sendTestPushNotification(): Promise<PushResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "sessionExpired" };
  if (!pushConfigured()) return { ok: false, error: "notConfigured" };

  const subscriptions = await getPushSubscriptions(user.id);
  if (subscriptions.length === 0) return { ok: false, error: "noSubscription" };

  const payloads = await anomalyPayloads();
  const userId = user.id;

  // Deliberately floating, like `startAnomalyScan`'s background work: the
  // action answers immediately so the button can settle, and the send catches
  // its own errors so nothing can reject unhandled twenty seconds later. An
  // in-process timer does not survive a restart, which is the right trade for
  // a test button and explicitly not how a real scan should notify.
  setTimeout(() => {
    void sendPushToUser(userId, (subscription) =>
      payloads[isAppLocale(subscription.locale) ? subscription.locale : defaultLocale],
    ).catch(() => {});
  }, TEST_PUSH_DELAY_MS);

  return { ok: true };
}
/** Room enough for a sentence on a lock screen, and no room for an essay. */
const MESSAGE_MAX = 120;

/**
 * Sends a typed message to every subscribed device on the deployment, now.
 *
 * A demo control, gated on `PUSH_BROADCAST_ENABLED` — with the flag unset this
 * refuses regardless of who is calling, which matters because a `"use server"`
 * export is reachable by POST whether or not the UI renders a button for it.
 * The flag is checked here rather than only in the page for exactly that
 * reason.
 *
 * No delay, unlike the test send: on stage the point is that the phones buzz
 * while you are still talking, and the presenter owns the timing. It is
 * awaited rather than floated so the button can report the number of devices
 * reached instead of leaving that to guesswork.
 */
export async function broadcastPushNotification(
  message: string,
): Promise<BroadcastResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "sessionExpired" };
  if (!pushConfigured()) return { ok: false, error: "notConfigured" };
  if (!pushBroadcastEnabled()) return { ok: false, error: "notAllowed" };

  const parsed = z.string().trim().min(1).max(MESSAGE_MAX).safeParse(message);
  if (!parsed.success) return { ok: false, error: "empty" };

  // The typed line is the *title*: that is the part a lock screen sets in
  // bold, and a broadcast is one sentence. The body carries the app's name so
  // a notification with no context still says where it came from.
  const bodies = await Promise.all(
    locales.map(async (locale) => {
      const t = await getTranslations({ locale, namespace: "Push" });
      return [locale, t("broadcastBody")] as const;
    }),
  );
  const bodyFor = Object.fromEntries(bodies) as Record<AppLocale, string>;

  const devices = await broadcastPush((subscription) => {
    const locale = isAppLocale(subscription.locale)
      ? subscription.locale
      : defaultLocale;
    return {
      title: parsed.data,
      body: bodyFor[locale],
      url: `/${locale}/home`,
      // Its own tag, so a broadcast never collapses into an anomaly push.
      tag: "broadcast",
    };
  });

  if (devices === 0) return { ok: false, error: "noSubscription" };
  return { ok: true, devices };
}
