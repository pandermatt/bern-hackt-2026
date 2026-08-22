import "server-only";

import { eq, inArray } from "drizzle-orm";
import {
  sendNotification,
  setVapidDetails,
  WebPushError,
} from "web-push";

import { db } from "@/db";
import { pushSubscriptions, type PushSubscriptionRow } from "@/db/schema";
import { site } from "@/lib/site";

/**
 * The send half of Web Push: VAPID configuration, and delivery to every device
 * an account has subscribed.
 *
 * Nothing here reads a request. A push is composed from a row in
 * `push_subscriptions` — including the language it should speak — precisely so
 * it can be sent from somewhere no request exists: a `setTimeout` twenty
 * seconds after a button was pressed, or the completion of a background scan.
 * The caller resolves the text while it still has a request scope and hands
 * the finished payload here.
 */

/** What the service worker's `push` handler expects to find in `event.data`. */
export type PushPayload = {
  title: string;
  body: string;
  /** Absolute path, locale prefix included — `notificationclick` opens it. */
  url: string;
  /**
   * Collapse key. Two pushes sharing a tag replace one another rather than
   * stacking, which is what stops a chatty scan from filling a lock screen.
   */
  tag?: string;
};

/**
 * Push is optional. Without a keypair the app runs exactly as before — the
 * settings row says so and offers no button — so every entry point here checks
 * rather than assuming, and nothing throws at import time.
 */
export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** The public key the browser needs to subscribe, or null when unconfigured. */
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/*
 * Configured on first send rather than at module load: the keys are read at
 * run time on the host (they are deliberately not NEXT_PUBLIC_ and so are not
 * baked into the build), and a deploy without them must still be able to
 * import this module.
 */
let configured = false;

function applyVapidDetails() {
  if (configured) return;

  setVapidDetails(
    // web-push requires a contact the push service can complain to. A URL is
    // as valid as a mailto:, and the site's own is the honest default.
    process.env.VAPID_SUBJECT || site.url,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

/** Every device this account has subscribed, newest last. */
export async function getPushSubscriptions(
  userId: number,
): Promise<PushSubscriptionRow[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

/**
 * Delivers one payload to one device.
 *
 * Returns the endpoint if the push service says the subscription is gone, so
 * the caller can prune it in a single statement — a `404` or `410` is the only
 * signal a browser ever gives that its subscription has expired, and a table
 * that ignores them turns into a graveyard that every later send pays for.
 * Every other failure is swallowed: one unreachable device must not stop the
 * others from ringing.
 */
async function deliver(
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): Promise<string | null> {
  try {
    await sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return null;
  } catch (error) {
    const status =
      error instanceof WebPushError ? error.statusCode : undefined;
    return status === 404 || status === 410 ? subscription.endpoint : null;
  }
}

/**
 * Sends to every device the account has, and drops the ones that answer gone.
 *
 * `payloadFor` is a function rather than a value because the text depends on
 * the subscription: each device stores the language it chose, and the whole
 * reason that column exists is that this function has no request to ask.
 */
export async function sendPushToUser(
  userId: number,
  payloadFor: PushPayload | ((subscription: PushSubscriptionRow) => PushPayload),
): Promise<void> {
  if (!pushConfigured()) return;

  const subscriptions = await getPushSubscriptions(userId);
  if (subscriptions.length === 0) return;

  applyVapidDetails();

  const resolve =
    typeof payloadFor === "function" ? payloadFor : () => payloadFor;

  const results = await Promise.all(
    subscriptions.map((subscription) => deliver(subscription, resolve(subscription))),
  );

  const gone = results.filter((endpoint): endpoint is string => endpoint !== null);
  if (gone.length > 0) {
    await db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.endpoint, gone));
  }
}
