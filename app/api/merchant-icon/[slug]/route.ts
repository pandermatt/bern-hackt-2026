import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { domainsForSlug } from "@/lib/merchant-brands";

// A dynamic segment is never prerendered anyway; declaring it keeps the intent
// next to the handler, the same way app/api/health/route.ts does.
export const dynamic = "force-dynamic";

/**
 * Where a merchant's icon is cached. Next to the database and driven by the
 * same env var, so it lands in whatever persistent volume the host mounts —
 * `data/` survives redeploys, which is the whole reason this is a disk cache
 * and not a table.
 */
const CACHE_DIR = join(
  dirname(process.env.DATABASE_PATH ?? "./data/app.db"),
  "merchant-icons",
);

/**
 * Two upstreams, tried in order. DuckDuckGo covers 47 of the 56 merchants in
 * the shipped statements; Google's service covers 6 of the 9 it misses,
 * including SBB, which is one of the most frequent lines in the ledger.
 *
 * DuckDuckGo answers a miss with a clean 404. Google sometimes does, and
 * sometimes returns 200 with a tiny generic globe instead — which is what the
 * size floor below is really for.
 */
const UPSTREAMS = [
  (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  (domain: string) =>
    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
];

/**
 * Statuses that say nothing about the domain. 429 matters most: the first
 * render of a cold dashboard asks for every merchant at once, and treating that
 * burst's rate-limit replies as "no icon exists" would cache the wrong answer
 * permanently.
 */
const TRANSIENT = new Set([408, 425, 429]);

/**
 * Below this an "icon" is a placeholder, not a mark — Google hands back a 128 B
 * generic globe for some domains rather than admitting it has nothing.
 */
const MIN_BYTES = 200;
/** Above this something is wrong; a favicon is never this large. */
const MAX_BYTES = 256 * 1024;

const EXTENSIONS = ["png", "ico"] as const;
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  ico: "image/x-icon",
};

/**
 * Collapses concurrent misses for the same merchant onto one upstream fetch.
 * The first render of the dashboard asks for ~15 icons at once and React's
 * strict mode doubles that in development, so without this the service sees a
 * burst of duplicate requests for every cold merchant.
 *
 * Parked on `globalThis` for the same reason the drizzle handle is: a
 * module-level Map is re-created on every HMR reload, which quietly defeats it.
 */
const globalForIcons = globalThis as unknown as {
  __merchantIconFetches?: Map<string, Promise<CachedIcon | null>>;
  __merchantIconGuessMisses?: Set<string>;
};
const inFlight = (globalForIcons.__merchantIconFetches ??= new Map());

/**
 * Misses for a *guessed* domain, remembered in memory rather than on disk.
 *
 * Two reasons, and both are about the guess rather than the miss. A guessed
 * slug is not from a fixed list — an outside caller can invent as many as it
 * likes, and each one recorded on disk is an inode this route hands out to
 * anybody who asks. And a guess is about a domain that may simply not be
 * registered yet: `lib/merchant-brands.ts` has no entry to correct, and the
 * disk cache has no expiry, so "forever" would be literal for a merchant whose
 * site appears next month. Restarting the process is the retry.
 *
 * The cap is what makes it bounded; `Map`/`Set` iteration is insertion-ordered,
 * so dropping the first key evicts the oldest.
 */
const guessMisses = (globalForIcons.__merchantIconGuessMisses ??= new Set());
const MAX_GUESS_MISSES = 500;

function rememberGuessMiss(slug: string) {
  if (guessMisses.size >= MAX_GUESS_MISSES) {
    for (const oldest of guessMisses) {
      guessMisses.delete(oldest);
      break;
    }
  }
  guessMisses.add(slug);
}

type CachedIcon = { body: Uint8Array; ext: string };

/** A hit, a recorded miss (`null`), or nothing cached yet (`undefined`). */
async function readCached(slug: string): Promise<CachedIcon | null | undefined> {
  for (const ext of EXTENSIONS) {
    try {
      return { body: await readFile(join(CACHE_DIR, `${slug}.${ext}`)), ext };
    } catch {
      // Not this extension; fall through.
    }
  }
  try {
    await readFile(join(CACHE_DIR, `${slug}.miss`));
    return null;
  } catch {
    return undefined;
  }
}

/** Written via a temp file so a torn write is never served as an icon. */
async function writeAtomic(name: string, body: Uint8Array | string) {
  await mkdir(CACHE_DIR, { recursive: true });
  const target = join(CACHE_DIR, name);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, target);
}

async function fetchAndCache(
  slug: string,
  domains: string[],
  guessed: boolean,
): Promise<CachedIcon | null> {
  /*
   * Whether every upstream gave us a real answer. A 404 is a fact about the
   * domain and worth remembering; a timeout or a DNS failure is a fact about
   * this moment and must not be. Recording the second kind would let one blip
   * during a cold dashboard load blacklist a perfectly good merchant for the
   * life of the volume — the cache has no expiry, so "forever" is literal.
   */
  let answered = true;

  /*
   * Candidates outside, upstreams inside: a guessed merchant offers `.com` and
   * `.ch` (see `guessDomains`), and the first *icon* wins rather than the first
   * domain that answers. Asking both services about `aliexpress.com` before
   * touching `aliexpress.ch` is what keeps a mapped merchant — one candidate —
   * behaving exactly as it did.
   */
  for (const domain of domains) {
    for (const url of UPSTREAMS) {
      try {
        const response = await fetch(url(domain), {
          // A slow icon service must never hold up a ledger row.
          signal: AbortSignal.timeout(5_000),
        });

        /*
         * A verdict on the domain, or on this moment? 404 is the first — the
         * service looked and has nothing. 5xx, 429 and 408 are the second: the
         * upstream is overloaded, rate-limiting us, or slow. Rate limiting is
         * the one that actually bites, because a cold dashboard asks for every
         * icon at once and a burst is exactly what earns a 429.
         */
        if (response.status >= 500 || TRANSIENT.has(response.status)) {
          answered = false;
          continue;
        }
        if (!response.ok) continue;

        const body = new Uint8Array(await response.arrayBuffer());
        if (body.byteLength < MIN_BYTES || body.byteLength > MAX_BYTES)
          continue;

        const ext = (response.headers.get("content-type") ?? "").includes("png")
          ? "png"
          : "ico";
        await writeAtomic(`${slug}.${ext}`, body);
        return { body, ext };
      } catch {
        // Timeout, DNS failure, connection reset — all transient.
        answered = false;
      }
    }
  }

  /*
   * Record the miss, but only when the answer was real. Without this sentinel
   * every render of a row for a merchant neither service knows re-hits the
   * network. To retry a recorded miss, delete the file — `data/merchant-icons`
   * is safe to empty at any time, it rebuilds itself on the next request.
   */
  if (answered) {
    if (guessed) rememberGuessMiss(slug);
    else await writeAtomic(`${slug}.miss`, "");
  }
  return null;
}

/**
 * A merchant's brand mark, fetched once and then served from disk.
 *
 * **Takes a slug, never a domain.** `proxy.ts` excludes `/api` from its
 * matcher, so this handler runs without the cookie check — a route that fetched
 * whatever host the URL named would be an open proxy pointed at our server.
 * That is still off the table, and not because of the map: the only hosts this
 * ever contacts are the two in `UPSTREAMS`, and a slug reaches them as a query
 * parameter. `domainsForSlug` decides *what they are asked about* — a mapped
 * merchant's own domain, or, for a merchant nobody mapped, a guess derived from
 * the slug — and a slug it cannot make a domain out of is a 404 before any
 * fetch happens.
 *
 * Unauthenticated on purpose, which is the one place this departs from the rule
 * that every endpoint resolves its account from the session: it serves public
 * brand logos and reads nothing belonging to a user. Adding a session lookup
 * would cost a query per icon and protect nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const { domains, guessed } = domainsForSlug(slug);
  if (domains.length === 0) return new Response(null, { status: 404 });

  let icon = await readCached(slug);
  // A guessed miss lives in memory, not on disk — see `guessMisses`.
  if (icon === undefined && guessMisses.has(slug)) icon = null;

  if (icon === undefined) {
    // Second lookup inside the same tick is deliberate: the dedupe map is what
    // makes the burst on a cold dashboard collapse to one fetch per merchant.
    let pending = inFlight.get(slug);
    if (!pending) {
      pending = fetchAndCache(slug, domains, guessed).finally(() =>
        inFlight.delete(slug),
      );
      inFlight.set(slug, pending);
    }
    icon = await pending;
  }

  if (!icon) return new Response(null, { status: 404 });

  return new Response(icon.body as BodyInit, {
    headers: {
      "Content-Type": CONTENT_TYPES[icon.ext],
      // The disk is the real cache; this stops the browser asking again for a
      // week. Safe to mark public — a brand logo is not user data.
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
