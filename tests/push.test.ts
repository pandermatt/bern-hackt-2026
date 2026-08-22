import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { pushSubscriptions, users, type User } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { TEST_PUSH_DELAY_MS } from "@/lib/push-config";

import de from "../messages/de.json";
import en from "../messages/en.json";

/*
 * The push layer, from the browser handing over a subscription to a payload
 * leaving for a push service twenty seconds later.
 *
 * `web-push` is the one thing stubbed outright — it opens a socket to Google
 * or Mozilla, which a test must not — and the stub is what makes the two
 * behaviours worth asserting testable at all: that a device answering "gone"
 * is pruned, and that each device is sent the language it subscribed in.
 */

const signedIn = vi.hoisted(() => ({ user: null as User | null }));
const locale = vi.hoisted(() => ({ current: "de" }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: async () => signedIn.user,
}));

/*
 * Both catalogs, not just English: the point of `pushSubscriptions.locale` is
 * that two devices on one account get different words, and a stub that only
 * knows one language cannot fail when that breaks.
 */
vi.mock("next-intl/server", () => {
  const catalogs: Record<string, Record<string, Record<string, string>>> = {
    de: de as never,
    en: en as never,
  };

  return {
    getLocale: async () => locale.current,
    getTranslations: async (
      arg: string | { locale?: string; namespace: string },
    ) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      const which = typeof arg === "string" ? "en" : (arg.locale ?? "en");
      return (key: string) => catalogs[which][namespace][key] ?? key;
    },
  };
});

/** One recorded `sendNotification` call. */
type Sent = { endpoint: string; payload: { title: string; url: string } };

const push = vi.hoisted(() => ({
  sent: [] as { endpoint: string; payload: string }[],
  /** Endpoints the fake push service reports as expired. */
  gone: new Set<string>(),
  vapid: [] as string[],
}));

vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(public statusCode: number) {
      super(`push failed: ${statusCode}`);
    }
  }

  return {
    WebPushError,
    setVapidDetails: (subject: string) => push.vapid.push(subject),
    sendNotification: async (
      subscription: { endpoint: string },
      payload: string,
    ) => {
      if (push.gone.has(subscription.endpoint)) throw new WebPushError(410);
      push.sent.push({ endpoint: subscription.endpoint, payload });
      return { statusCode: 201 };
    },
    generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
  };
});

const {
  broadcastPushNotification,
  deletePushSubscription,
  savePushSubscription,
  sendTestPushNotification,
} = await import("@/app/actions/push");
const { sendPushToUser } = await import("@/lib/push");

/** What `PushSubscription.toJSON()` hands back in the browser. */
function subscriptionJson(endpoint: string) {
  return { endpoint, keys: { p256dh: `p256dh-${endpoint}`, auth: `auth-${endpoint}` } };
}

function sentPayloads(): Sent[] {
  return push.sent.map(({ endpoint, payload }) => ({
    endpoint,
    payload: JSON.parse(payload),
  }));
}

/* Hashed once. scrypt is deliberately slow, and nothing here logs in. */
const passwordHash = await hashPassword("correct horse");

async function createUser(email: string): Promise<User> {
  const [user] = await db.insert(users).values({ email, passwordHash }).returning();
  return user;
}

beforeEach(async () => {
  await db.delete(pushSubscriptions);
  await db.delete(users);

  push.sent = [];
  push.gone = new Set();
  push.vapid = [];

  locale.current = "de";
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  delete process.env.PUSH_BROADCAST_ENABLED;

  signedIn.user = await createUser("jeanine@example.com");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("savePushSubscription", () => {
  it("stores the endpoint, its keys and the locale of the request", async () => {
    locale.current = "en";
    expect(await savePushSubscription(subscriptionJson("https://push.test/a"))).toEqual({
      ok: true,
    });

    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: signedIn.user!.id,
      endpoint: "https://push.test/a",
      p256dh: "p256dh-https://push.test/a",
      locale: "en",
    });
  });

  it("upserts on the endpoint rather than piling up rows", async () => {
    // A browser hands back the same endpoint every time it is asked, so
    // re-enabling on a device that already had it must move the row.
    await savePushSubscription(subscriptionJson("https://push.test/a"));
    locale.current = "en";
    await savePushSubscription(subscriptionJson("https://push.test/a"));

    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0].locale).toBe("en");
  });

  it("moves a device to whoever is signed in on it now", async () => {
    await savePushSubscription(subscriptionJson("https://push.test/shared"));

    const other = await createUser("someone@example.com");
    signedIn.user = other;
    await savePushSubscription(subscriptionJson("https://push.test/shared"));

    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(other.id);
  });

  it("refuses a signed-out caller and a subscription it cannot read", async () => {
    signedIn.user = null;
    expect(await savePushSubscription(subscriptionJson("https://push.test/a"))).toEqual({
      ok: false,
      error: "sessionExpired",
    });

    signedIn.user = await createUser("back@example.com");
    expect(await savePushSubscription({ endpoint: "not-a-url" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe("deletePushSubscription", () => {
  it("forgets this browser's subscription", async () => {
    await savePushSubscription(subscriptionJson("https://push.test/a"));

    expect(await deletePushSubscription("https://push.test/a")).toEqual({ ok: true });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("cannot unsubscribe somebody else's device", async () => {
    // The endpoint comes from the client, because only the browser knows it —
    // so the delete has to be scoped by owner as well.
    const other = await createUser("someone@example.com");
    await db.insert(pushSubscriptions).values({
      userId: other.id,
      endpoint: "https://push.test/theirs",
      p256dh: "x",
      auth: "y",
      locale: "de",
    });

    expect(await deletePushSubscription("https://push.test/theirs")).toEqual({
      ok: true,
    });

    const survived = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, other.id));
    expect(survived).toHaveLength(1);
  });
});

describe("sendTestPushNotification", () => {
  it("sends nothing until the delay has passed, then sends", async () => {
    // The delay is the feature: the notification has to arrive after there has
    // been time to close the app, not while the button is still under a thumb.
    vi.useFakeTimers();
    await savePushSubscription(subscriptionJson("https://push.test/a"));

    expect(await sendTestPushNotification()).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(TEST_PUSH_DELAY_MS - 1000);
    expect(push.sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(push.sent).toHaveLength(1);
  });

  it("says 'found new anomaly' and links at the anomalies page", async () => {
    vi.useFakeTimers();
    locale.current = "en";
    await savePushSubscription(subscriptionJson("https://push.test/a"));
    await sendTestPushNotification();
    await vi.advanceTimersByTimeAsync(TEST_PUSH_DELAY_MS);

    const [{ payload }] = sentPayloads();
    expect(payload.title).toBe(en.Push.anomalyTitle);
    expect(payload.url).toBe("/en/anomalies");
  });

  it("sends each device the language it subscribed in", async () => {
    vi.useFakeTimers();
    locale.current = "de";
    await savePushSubscription(subscriptionJson("https://push.test/phone"));
    locale.current = "en";
    await savePushSubscription(subscriptionJson("https://push.test/laptop"));

    await sendTestPushNotification();
    await vi.advanceTimersByTimeAsync(TEST_PUSH_DELAY_MS);

    const byEndpoint = new Map(sentPayloads().map((s) => [s.endpoint, s.payload]));
    expect(byEndpoint.get("https://push.test/phone")).toMatchObject({
      title: de.Push.anomalyTitle,
      url: "/de/anomalies",
    });
    expect(byEndpoint.get("https://push.test/laptop")).toMatchObject({
      title: en.Push.anomalyTitle,
      url: "/en/anomalies",
    });
  });

  it("refuses when there is nothing to send to, or no keypair", async () => {
    expect(await sendTestPushNotification()).toEqual({
      ok: false,
      error: "noSubscription",
    });

    await savePushSubscription(subscriptionJson("https://push.test/a"));
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await sendTestPushNotification()).toEqual({
      ok: false,
      error: "notConfigured",
    });

    signedIn.user = null;
    expect(await sendTestPushNotification()).toEqual({
      ok: false,
      error: "sessionExpired",
    });
  });
});

describe("sendPushToUser", () => {
  const payload = { title: "t", body: "b", url: "/de/anomalies" };

  it("drops a subscription the push service reports as gone", async () => {
    // The only signal a browser ever gives that its subscription expired. A
    // table that ignores it grows a graveyard every later send pays for.
    await savePushSubscription(subscriptionJson("https://push.test/live"));
    await savePushSubscription(subscriptionJson("https://push.test/dead"));
    push.gone.add("https://push.test/dead");

    await sendPushToUser(signedIn.user!.id, payload);

    const rows = await db.select().from(pushSubscriptions);
    expect(rows.map((row) => row.endpoint)).toEqual(["https://push.test/live"]);
    expect(push.sent.map((s) => s.endpoint)).toEqual(["https://push.test/live"]);
  });

  it("does nothing without a keypair, and never configures one", async () => {
    await savePushSubscription(subscriptionJson("https://push.test/a"));
    delete process.env.VAPID_PUBLIC_KEY;

    await sendPushToUser(signedIn.user!.id, payload);

    expect(push.sent).toHaveLength(0);
    expect(push.vapid).toHaveLength(0);
  });
});
describe("broadcastPushNotification", () => {
  /** A second account with a device of its own, to prove the reach. */
  async function otherDevice(endpoint: string) {
    const other = await createUser("someone@example.com");
    await db.insert(pushSubscriptions).values({
      userId: other.id,
      endpoint,
      p256dh: "x",
      auth: "y",
      locale: "en",
    });
  }

  it("refuses unless the server flag is set, however it is called", async () => {
    // The gate has to live in the action, not only in the page: a "use server"
    // export is reachable by POST whether or not a button points at it.
    await savePushSubscription(subscriptionJson("https://push.test/a"));

    expect(await broadcastPushNotification("hello")).toEqual({
      ok: false,
      error: "notAllowed",
    });
    expect(push.sent).toHaveLength(0);

    process.env.PUSH_BROADCAST_ENABLED = "0";
    expect(await broadcastPushNotification("hello")).toEqual({
      ok: false,
      error: "notAllowed",
    });
  });

  it("reaches every account's devices, not just the sender's", async () => {
    process.env.PUSH_BROADCAST_ENABLED = "1";
    await savePushSubscription(subscriptionJson("https://push.test/mine"));
    await otherDevice("https://push.test/theirs");

    expect(await broadcastPushNotification("Look at your phone")).toEqual({
      ok: true,
      devices: 2,
    });
    expect(push.sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push.test/mine",
      "https://push.test/theirs",
    ]);
  });

  it("puts the typed line in the title, where a lock screen sets it bold", async () => {
    process.env.PUSH_BROADCAST_ENABLED = "1";
    await savePushSubscription(subscriptionJson("https://push.test/a"));

    await broadcastPushNotification("  Look at your phone  ");

    const [{ payload }] = sentPayloads();
    // Trimmed, so stray whitespace does not ship as part of the message.
    expect(payload.title).toBe("Look at your phone");
    // Its own tag, or a broadcast would collapse into an anomaly push.
    expect(payload).toMatchObject({ tag: "broadcast", url: "/de/home" });
  });

  it("sends at once rather than on the test send's delay", async () => {
    // The point on stage: the phones go off while you are still talking.
    vi.useFakeTimers();
    process.env.PUSH_BROADCAST_ENABLED = "1";
    await savePushSubscription(subscriptionJson("https://push.test/a"));

    await broadcastPushNotification("now");
    expect(push.sent).toHaveLength(1);
  });

  it("refuses an empty message and one past the length cap", async () => {
    process.env.PUSH_BROADCAST_ENABLED = "1";
    await savePushSubscription(subscriptionJson("https://push.test/a"));

    expect(await broadcastPushNotification("   ")).toEqual({
      ok: false,
      error: "empty",
    });
    expect(await broadcastPushNotification("x".repeat(121))).toEqual({
      ok: false,
      error: "empty",
    });
    expect(push.sent).toHaveLength(0);
  });

  it("reports only the devices it actually reached", async () => {
    process.env.PUSH_BROADCAST_ENABLED = "1";
    await savePushSubscription(subscriptionJson("https://push.test/live"));
    await otherDevice("https://push.test/dead");
    push.gone.add("https://push.test/dead");

    expect(await broadcastPushNotification("hello")).toEqual({ ok: true, devices: 1 });
    // Pruned on the way, like any other send.
    const rows = await db.select().from(pushSubscriptions);
    expect(rows.map((row) => row.endpoint)).toEqual(["https://push.test/live"]);
  });

  it("refuses a signed-out caller even with the flag on", async () => {
    process.env.PUSH_BROADCAST_ENABLED = "1";
    signedIn.user = null;
    expect(await broadcastPushNotification("hello")).toEqual({
      ok: false,
      error: "sessionExpired",
    });
  });
});
