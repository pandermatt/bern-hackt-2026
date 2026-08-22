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

class FakeEvent {
  waited: Promise<unknown> | null = null;
  responded: Promise<Response> | null = null;

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
}

/**
 * Evaluates `public/sw.js` against stubs. `new Function` rather than an import
 * because the worker has no exports and expects a `self` that Node does not
 * provide — everything it reaches for is either `self.x` or a global passed in
 * here.
 */
function loadWorker(precacheStatus = 200): WorkerHarness {
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
  };

  const self = {
    location: { origin: "https://beyond.test" },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: async () => undefined,
    clients: {
      claim: async () => {
        harness.claimed = true;
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
