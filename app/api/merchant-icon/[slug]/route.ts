import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getCurrentUser } from "@/lib/auth";
import { domainsForSlug, merchantSlug } from "@/lib/merchant-brands";
import { merchantOverridesFor, normalizeDomain } from "@/lib/merchant-overrides";

// A dynamic segment is never prerendered anyway; declaring it keeps the intent
// next to the handler, the same way app/api/health/route.ts does.
export const dynamic = "force-dynamic";

/**
 * Where a merchant's icon is cached. Next to the database and driven by the
 * same env var, so it lands in whatever persistent volume the host mounts —
 * `data/` survives redeploys, which is the whole reason this is a disk cache
 * and not a table.
 *
 * Files are named for the **domain**, not the merchant. Four Coop entries share
 * one mark, and — since `/account` lets a reader name a domain themselves — a
 * slug-named file would be one account's answer served to the next account that
 * asked about the same merchant. A domain is a public fact about a brand and
 * carries no such claim, so the cache is shared and correct at the same time.
 * (Files left over from the slug-named layout are orphans; `data/merchant-icons`
 * is safe to empty at any time.)
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
 * Collapses concurrent misses for the same domain onto one upstream fetch.
 * The first render of a cold dashboard asks for ~15 icons at once and React's
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
 * domain is not from a fixed list — an outside caller can invent as many as it
 * likes, and each one recorded on disk is an inode this route hands out to
 * anybody who asks. And a guess is about a domain that may simply not be
 * registered yet: `lib/merchant-brands.ts` has no entry to correct, and the
 * disk cache has no expiry, so "forever" would be literal for a merchant whose
 * site appears next month. Restarting the process is the retry.
 *
 * The cap is what makes it bounded; `Set` iteration is insertion-ordered, so
 * dropping the first key evicts the oldest.
 */
const guessMisses = (globalForIcons.__merchantIconGuessMisses ??= new Set());
const MAX_GUESS_MISSES = 500;

function rememberGuessMiss(domain: string) {
  if (guessMisses.size >= MAX_GUESS_MISSES) {
    for (const oldest of guessMisses) {
      guessMisses.delete(oldest);
      break;
    }
  }
  guessMisses.add(domain);
}

type CachedIcon = { body: Uint8Array; ext: string };

/** A hit, a recorded miss (`null`), or nothing cached yet (`undefined`). */
async function readCached(
  domain: string,
): Promise<CachedIcon | null | undefined> {
  if (guessMisses.has(domain)) return null;

  for (const ext of EXTENSIONS) {
    try {
      return { body: await readFile(join(CACHE_DIR, `${domain}.${ext}`)), ext };
    } catch {
      // Not this extension; fall through.
    }
  }
  try {
    await readFile(join(CACHE_DIR, `${domain}.miss`));
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
  domain: string,
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

  for (const url of UPSTREAMS) {
    try {
      const response = await fetch(url(domain), {
        // A slow icon service must never hold up a ledger row.
        signal: AbortSignal.timeout(5_000),
      });

      /*
       * A verdict on the domain, or on this moment? 404 is the first — the
       * service looked and has nothing. 5xx, 429 and 408 are the second: the
       * upstream is overloaded, rate-limiting us, or slow. Rate limiting is the
       * one that actually bites, because a cold dashboard asks for every icon
       * at once and a burst is exactly what earns a 429.
       */
      if (response.status >= 500 || TRANSIENT.has(response.status)) {
        answered = false;
        continue;
      }
      if (!response.ok) continue;

      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength < MIN_BYTES || body.byteLength > MAX_BYTES) continue;

      const ext = (response.headers.get("content-type") ?? "").includes("png")
        ? "png"
        : "ico";
      await writeAtomic(`${domain}.${ext}`, body);
      return { body, ext };
    } catch {
      // Timeout, DNS failure, connection reset — all transient.
      answered = false;
    }
  }

  /*
   * Record the miss, but only when the answer was real. Without this sentinel
   * every render of a row for a merchant neither service knows re-hits the
   * network. To retry a recorded miss, delete the file — `data/merchant-icons`
   * is safe to empty at any time, it rebuilds itself on the next request.
   */
  if (answered) {
    if (guessed) rememberGuessMiss(domain);
    else await writeAtomic(`${domain}.miss`, "");
  }
  return null;
}

/** The first of the candidates that has a mark, cache first, network second. */
async function resolveIcon(
  domains: string[],
  guessed: boolean,
): Promise<CachedIcon | null> {
  for (const domain of domains) {
    const cached = await readCached(domain);
    if (cached) return cached;
    // A recorded miss is an answer: skip to the next candidate without asking
    // the upstreams again.
    if (cached === null) continue;

    // Second lookup inside the same tick is deliberate: the dedupe map is what
    // makes the burst on a cold dashboard collapse to one fetch per domain.
    let pending = inFlight.get(domain);
    if (!pending) {
      pending = fetchAndCache(domain, guessed).finally(() =>
        inFlight.delete(domain),
      );
      inFlight.set(domain, pending);
    }
    const fetched = await pending;
    if (fetched) return fetched;
  }

  return null;
}

/**
 * What this account has said the merchant's mark is, if anything.
 *
 * Costs a session lookup and one indexed read per icon request, and it is worth
 * being clear about why that is paid *before* the shipped map rather than only
 * when the map comes up empty: a reader who names a domain is as often
 * correcting a wrong mark — the guess in `lib/merchant-brands.ts` can land on
 * somebody else's `.com` — as filling in a missing one. An override that only
 * won where nothing else answered would leave the wrong logo unfixable.
 *
 * The overrides are keyed by merchant name and this route is addressed by slug,
 * so the names are slugged here. `merchantSlug` is a pure function of the name
 * and the component derives the URL the same way, so the two agree by
 * construction — the same contract the shipped map's `BY_SLUG` relies on.
 */
async function overrideForSlug(slug: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const overrides = await merchantOverridesFor(user.id);
  for (const override of overrides.values()) {
    if (!override.domain || merchantSlug(override.merchant) !== slug) continue;
    // Normalised again on the way out: the column is text, and a value written
    // by an earlier build (or by hand) has no business becoming a filename
    // unchecked.
    return normalizeDomain(override.domain);
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
 * parameter. What a slug selects is *which domain they are asked about* — this
 * account's own override, else the shipped map, else a guess derived from the
 * slug — and a slug that yields no domain at all is a 404 before any fetch
 * happens.
 *
 * It reads the session only to find an override, and serves the result
 * `private` when it used one, because that response *is* this account's answer
 * rather than a public fact about a brand. Everything else stays public and
 * cacheable for a week, and unauthenticated callers keep working exactly as
 * before.
 *
 * A miss is `no-store` on purpose. Naming a domain on `/account` has to show up
 * on the next render, and a 404 the browser cached for a day would hold the old
 * blank tile long after the icon existed. The cost is one cheap 404 per
 * markless merchant per page load — answered from the miss cache, without
 * touching an upstream.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const override = await overrideForSlug(slug);
  const { domains, guessed } = override
    ? { domains: [override], guessed: false }
    : domainsForSlug(slug);

  const icon = domains.length > 0 ? await resolveIcon(domains, guessed) : null;

  if (!icon) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(icon.body as BodyInit, {
    headers: {
      "Content-Type": CONTENT_TYPES[icon.ext],
      /*
       * The disk is the real cache; this only stops the browser asking again
       * for a while. A day rather than the week it was: naming a domain on
       * `/account` replaces a mark that is already on screen, and a week-long
       * `immutable` would leave the old one there long after the decision.
       * `private` when an override chose it, because that response is this
       * account's answer rather than a public fact about a brand — and shorter
       * still, since it is the one that changes.
       */
      "Cache-Control": override
        ? "private, max-age=3600"
        : "public, max-age=86400",
    },
  });
}
