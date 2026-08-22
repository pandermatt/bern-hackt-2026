import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";

/*
 * The regression guard on `public/sw.js`.
 *
 * A service worker is a plain script served from `public/`, outside the module
 * graph — it cannot import `i18n/routing.ts`, so it keeps its own copy of the
 * locale list. These assertions are what catch that copy drifting, and what
 * catch the two bugs the offline page shipped with: it was cached from a
 * redirect (so the browser refused to serve it to a navigation) and it was
 * always the default locale's render.
 */

const SOURCE = readFileSync(resolve("public/sw.js"), "utf8");

/** Reads a top-level `const NAME = …;` literal back out of the worker source. */
function literal(name: string): string {
  const match = SOURCE.match(new RegExp(`const ${name} = ([^;]+);`));
  if (!match) throw new Error(`${name} is not declared in public/sw.js`);
  return match[1];
}

// ---------------------------------------------------------------------------
// A service-worker global, reduced to the parts the worker actually touches.
// ---------------------------------------------------------------------------

type Handler = (event: FakeEvent) => void;

class FakeCache {
  readonly entries = new Map<string, Response>();

  async put(url: string, response: Response) {
    this.entries.set(url, response);
  }

  async match(request: string | { url: string }) {
    const key = typeof request === "string" ? request : new URL(request.url).pathname;
    return this.entries.get(key);
  }
}

/** What `event.notification` is, reduced to what the click handler touches. */
class FakeNotification {
  closed = false;

  constructor(public readonly data: unknown) {}

  close() {
    this.closed = true;
  }
}

class FakeEvent {
  waited: Promise<unknown> | null = null;
  responded: Promise<Response> | null = null;
  /** Set on a push event. `json()` throws for the unparseable case. */
  data?: { json: () => unknown };
  /** Set on a notificationclick event. */
  notification?: FakeNotification;

  constructor(public readonly request?: { method: string; mode: string; url: string }) {}

  waitUntil(promise: Promise<unknown>) {
    this.waited = promise;
  }

  respondWith(promise: Promise<Response>) {
    this.responded = promise;
  }
}

interface WorkerHarness {
  handlers: Map<string, Handler>;
  caches: Map<string, FakeCache>;
  /** Every URL the install handler fetched, in call order. */
  fetched: string[];
  /** The exact Response objects handed to `fetch`, by URL. */
  served: Map<string, Response>;
  claimed: boolean;
  /** Flip to make every subsequent `fetch` reject, as a dead network does. */
  offline: boolean;
  /** Everything `registration.showNotification` was asked to display. */
  notifications: { title: string; options: Record<string, unknown> }[];
  /** Open windows `clients.matchAll` will report, and what happened to them. */
  windows: FakeWindowClient[];
  /** URLs `clients.openWindow` was called with. */
  opened: string[];
}

/** One entry from `clients.matchAll`, recording what the handler did to it. */
class FakeWindowClient {
  navigated: string | null = null;
  focused = false;

  constructor(public url: string) {}

  async navigate(url: string) {
    this.navigated = url;
    this.url = url;
    return this;
  }

  async focus() {
    this.focused = true;
    return this;
  }
}

/**
 * Evaluates `public/sw.js` against stubs. `new Function` rather than an import
 * because the worker has no exports and expects a `self` that Node does not
 * provide — everything it reaches for is either `self.x` or a global passed in
 * here.
 */
function loadWorker(precacheStatus = 200, dev = false): WorkerHarness {
  const handlers = new Map<string, Handler>();
  const cacheStore = new Map<string, FakeCache>();
  const fetched: string[] = [];
  const served = new Map<string, Response>();
  const harness: WorkerHarness = {
    handlers,
    caches: cacheStore,
    fetched,
    served,
    claimed: false,
    offline: false,
    notifications: [],
    windows: [],
    opened: [],
  };

  const self = {
    location: {
      origin: "https://beyond.test",
      // `href` carries the registration's query string, which is the worker's
      // only channel for a build-time fact — see DEV in public/sw.js.
      href: dev ? "https://beyond.test/sw.js?dev=1" : "https://beyond.test/sw.js",
    },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        harness.notifications.push({ title, options });
      },
    },
    clients: {
      claim: async () => {
        harness.claimed = true;
      },
      matchAll: async () => harness.windows,
      openWindow: async (url: string) => {
        harness.opened.push(url);
        return new FakeWindowClient(url);
      },
    },
  };

  const caches = {
    open: async (name: string) => {
      let cache = cacheStore.get(name);
      if (!cache) cacheStore.set(name, (cache = new FakeCache()));
      return cache;
    },
    keys: async () => [...cacheStore.keys()],
    delete: async (name: string) => cacheStore.delete(name),
  };

  // Each precached URL gets a body naming itself, so the fetch assertions below
  // can tell which locale's page came back.
  const fakeFetch = async (target: string | { url: string }) => {
    if (harness.offline) throw new TypeError("Failed to fetch");

    const url = typeof target === "string" ? target : target.url;
    fetched.push(url);
    const response = new Response(`body of ${url}`, {
      status: precacheStatus,
      statusText: precacheStatus === 200 ? "OK" : "Not Found",
      headers: { "content-type": "text/html" },
    });
    served.set(url, response);
    return response;
  };

  new Function("self", "caches", "fetch", "Response", "URL", SOURCE)(
    self,
    caches,
    fakeFetch,
    Response,
    URL,
  );

  return harness;
}

/** Runs the install handler to completion and hands back the populated cache. */
async function install(harness: WorkerHarness): Promise<FakeCache> {
  const event = new FakeEvent();
  harness.handlers.get("install")!(event);
  await event.waited;
  return [...harness.caches.values()][0];
}

/** Drives a navigation through the fetch handler with the network down. */
async function navigateOffline(harness: WorkerHarness, path: string): Promise<Response> {
  harness.offline = true;
  const event = new FakeEvent({
    method: "GET",
    mode: "navigate",
    url: `https://beyond.test${path}`,
  });
  harness.handlers.get("fetch")!(event);
  return event.responded!;
}

/** Drives an asset request through the fetch handler. */
function requestAsset(harness: WorkerHarness, path: string): FakeEvent {
  const event = new FakeEvent({
    method: "GET",
    mode: "no-cors",
    url: `https://beyond.test${path}`,
  });
  harness.handlers.get("fetch")!(event);
  return event;
}

/** Delivers a push. `payload === undefined` stands for a push with no body. */
async function push(harness: WorkerHarness, payload: unknown): Promise<void> {
  const event = new FakeEvent();
  if (payload !== undefined) {
    event.data = {
      json: () => {
        if (payload === "unparseable") throw new SyntaxError("not JSON");
        return payload;
      },
    };
  }
  harness.handlers.get("push")!(event);
  await event.waited;
}

/** Taps a notification carrying `data`. */
async function clickNotification(
  harness: WorkerHarness,
  data: unknown,
): Promise<FakeNotification> {
  const event = new FakeEvent();
  event.notification = new FakeNotification(data);
  harness.handlers.get("notificationclick")!(event);
  await event.waited;
  return event.notification;
}

// ---------------------------------------------------------------------------

describe("the worker's locale list", () => {
  it("matches i18n/routing.ts", () => {
    // The whole point of this file: sw.js cannot import routing, so the copy
    // has to be checked rather than shared.
    expect(JSON.parse(literal("LOCALES").replace(/'/g, '"'))).toEqual([
      ...routing.locales,
    ]);
    expect(literal("DEFAULT_LOCALE").replace(/"/g, "")).toBe(routing.defaultLocale);
  });
});

describe("install", () => {
  let harness: WorkerHarness;
  let cache: FakeCache;

  beforeEach(async () => {
    harness = loadWorker();
    cache = await install(harness);
  });

  it("precaches an offline page per locale, already prefixed", () => {
    // Prefixed, so nothing follows a redirect. Fetching the bare "/offline"
    // is what used to land every locale on the default one's render.
    for (const locale of routing.locales) {
      expect(harness.fetched).toContain(`/${locale}/offline`);
      expect(cache.entries.has(`/${locale}/offline`)).toBe(true);
    }
    expect(harness.fetched).not.toContain("/offline");
  });

  it("precaches the icons the manifest names", () => {
    expect(cache.entries.has("/icon.svg")).toBe(true);
    expect(cache.entries.has("/icon-192.png")).toBe(true);
  });

  it("stores a rebuilt response, not the one it fetched", async () => {
    /*
     * The `redirected` flag cannot be set on a hand-made Response, so this
     * asserts the mechanism instead: a rebuilt response is a different object
     * and therefore carries none of the original's flags. Storing the original
     * is what made the offline page unusable for a navigation, whose
     * `redirect: "manual"` mode rejects a redirected response outright.
     */
    const stored = cache.entries.get("/de/offline")!;
    expect(stored).not.toBe(harness.served.get("/de/offline"));
    expect(stored.status).toBe(200);
    expect(stored.headers.get("content-type")).toBe("text/html");
    expect(await stored.text()).toBe("body of /de/offline");
  });

  it("caches nothing when the precache fetch 404s", async () => {
    // A missing asset must not be stored as if it were the page — this is the
    // `response.ok` guard, and it is why the old `/icon.svg` 404 was silent.
    const cache404 = await install(loadWorker(404));
    expect(cache404.entries.size).toBe(0);
  });
});

describe("a navigation that fails", () => {
  it("answers in the locale of the page that was requested", async () => {
    const harness = loadWorker();
    await install(harness);

    expect(await (await navigateOffline(harness, "/en/dashboard")).text()).toBe(
      "body of /en/offline",
    );
    expect(await (await navigateOffline(harness, "/de/budget")).text()).toBe(
      "body of /de/offline",
    );
  });

  it("falls back to the default locale for an unprefixed path", async () => {
    const harness = loadWorker();
    await install(harness);

    expect(await (await navigateOffline(harness, "/")).text()).toBe(
      `body of /${routing.defaultLocale}/offline`,
    );
  });
});

describe("the dev registration", () => {
  it("keeps cache-first off /_next/static/, where dev chunks are not hashed", () => {
    // The whole reason the worker may now register outside production. A
    // cached dev chunk is yesterday's module served over today's HMR.
    const event = requestAsset(loadWorker(200, true), "/_next/static/chunks/main.js");
    expect(event.responded).toBeNull();
  });

  it("still caches build output when registered without ?dev=1", () => {
    const event = requestAsset(loadWorker(), "/_next/static/chunks/main.js");
    expect(event.responded).not.toBeNull();
  });
});

describe("push", () => {
  it("shows the payload it was sent", async () => {
    const harness = loadWorker();
    await push(harness, {
      title: "Found new anomaly",
      body: "Something is worth a look.",
      url: "/en/anomalies",
      tag: "anomaly",
    });

    expect(harness.notifications).toHaveLength(1);
    const [{ title, options }] = harness.notifications;
    expect(title).toBe("Found new anomaly");
    expect(options.body).toBe("Something is worth a look.");
    expect(options.tag).toBe("anomaly");
    // The click handler reads the URL back off here, so it has to survive.
    expect(options.data).toEqual({ url: "/en/anomalies" });
  });

  it("shows something for a push with no body", async () => {
    // A push that displays nothing is what Chrome counts against the origin
    // before revoking the permission outright, so there is no silent path.
    const harness = loadWorker();
    await push(harness, undefined);

    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0].title).toBeTruthy();
  });

  it("shows something for a payload that is not our JSON", async () => {
    const harness = loadWorker();
    await push(harness, "unparseable");

    expect(harness.notifications).toHaveLength(1);
    expect(harness.notifications[0].title).toBeTruthy();
  });
});

describe("notificationclick", () => {
  it("opens the payload's URL when nothing is open", async () => {
    const harness = loadWorker();
    const notification = await clickNotification(harness, { url: "/de/anomalies" });

    expect(harness.opened).toEqual(["/de/anomalies"]);
    // Left on screen, it would still be there after the page had opened.
    expect(notification.closed).toBe(true);
  });

  it("navigates and focuses an open window rather than opening a second", async () => {
    // An installed PWA has exactly one window, and openWindow on top of it is
    // how you end up with two.
    const harness = loadWorker();
    const open = new FakeWindowClient("https://beyond.test/de/dashboard");
    harness.windows.push(open);

    await clickNotification(harness, { url: "/de/anomalies" });

    expect(open.navigated).toBe("/de/anomalies");
    expect(open.focused).toBe(true);
    expect(harness.opened).toEqual([]);
  });

  it("ignores a window from another origin", async () => {
    const harness = loadWorker();
    const foreign = new FakeWindowClient("https://elsewhere.test/");
    harness.windows.push(foreign);

    await clickNotification(harness, { url: "/de/anomalies" });

    expect(foreign.focused).toBe(false);
    expect(harness.opened).toEqual(["/de/anomalies"]);
  });

  it("falls back to the root for a notification carrying no URL", async () => {
    const harness = loadWorker();
    await clickNotification(harness, undefined);

    expect(harness.opened).toEqual(["/"]);
  });
});
