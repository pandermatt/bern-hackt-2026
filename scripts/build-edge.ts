/**
 * Assembles `edge/dist/` — everything the Cloudflare Worker serves while the
 * demo server does not exist. See `edge/worker.ts` and `docs/demo-runbook.md`.
 *
 * Run against a **running production server** (`next start`), because the
 * prerendered documents are curled out of it rather than generated a second
 * way. A separate renderer is a second implementation of the landing page, and
 * the copy the edge serves for three months at a stretch is precisely the one
 * that must not drift from the app.
 *
 *   npm run build && npx next start &
 *   npm run edge:build
 *
 * The bundle is this build's and only this build's: `_next/static` filenames
 * are content-hashed, so shipping the HTML without the matching assets is an
 * unstyled page. Never commit `edge/dist` — it is gitignored for that reason.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Mirrors `i18n/routing.ts`; see the note about that duplication in the worker. */
const LOCALES = ["de", "en"];

const BASE_URL = process.env.EDGE_BASE_URL ?? "http://localhost:3000";
const DIST = join(process.cwd(), "edge", "dist");

/** Mirrors `DEMO_ASLEEP_HEADER` in `lib/demo-asleep.ts`. */
const DEMO_ASLEEP_HEADER = "x-demo-asleep";

/**
 * The six documents, and which render each one is.
 *
 * The landing page is fetched twice at the *same* path — once plain, once with
 * the header — so both documents claim to be `/de` and neither hydrates
 * against a URL it was not served at. That is the whole reason the flag is a
 * header rather than a query string; see `lib/demo-asleep.ts`.
 */
const DOCUMENTS = [
  ...LOCALES.map((locale) => ({
    file: `landing-${locale}-asleep.html`,
    path: `/${locale}`,
    asleep: true,
  })),
  // Also the asleep render. This copy is only ever served because the box is
  // gone, and the default one tells the reader to check their connection —
  // a wrong answer they could waste real time on. The live origin still serves
  // the connection copy, which is what `public/sw.js` precaches during a demo.
  ...LOCALES.map((locale) => ({
    file: `offline-${locale}.html`,
    path: `/${locale}/offline`,
    asleep: true,
  })),
];

async function fetchDocument(path: string, asleep: boolean): Promise<string> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: asleep ? { [DEMO_ASLEEP_HEADER]: "1" } : {},
    // A redirect here means the page is not the one being asked for — a
    // signed-in render, or a locale bounce — and shipping it would put a
    // redirect in the edge bundle where a document belongs.
    redirect: "manual",
  });

  if (response.status !== 200) {
    throw new Error(
      `${path} answered ${response.status}, expected 200. The server must be ` +
        `a production build with no session cookie in play.`,
    );
  }

  const html = await response.text();
  if (!html.includes("<!DOCTYPE html>") && !html.includes("<!doctype html>")) {
    throw new Error(`${path} did not return an HTML document.`);
  }

  /*
   * `NEXT_PUBLIC_SITE_URL` is read at BUILD time and defaults to
   * `http://localhost:3000` (`lib/site.ts`), which the layout hands to
   * `metadataBase`. A build that forgot it produces pages whose `og:url` and
   * `og:image` name a machine nobody else can reach — and these documents are
   * the ones that sit on Cloudflare for a quarter, so every link preview of
   * the site is broken for as long as they do.
   *
   * The page renders perfectly and nothing else complains, which is exactly
   * why this is checked here rather than trusted to whoever ran the build.
   * The CI job sets the variable; a hand-run `npm run build` will not.
   */
  if (html.includes("localhost")) {
    throw new Error(
      `${path} contains a localhost URL — this build had no ` +
        `NEXT_PUBLIC_SITE_URL, so its Open Graph tags name your laptop.\n\n` +
        `  NEXT_PUBLIC_SITE_URL=https://beyond-money.ch npm run build\n\n` +
        `then restart the server and run this again.`,
    );
  }

  return html;
}

/**
 * The Open Graph card, which is a *dynamic route* — `app/[locale]/
 * opengraph-image.tsx` renders it per request. Every prerendered page points
 * `og:image` at it, so with the box destroyed the one image every link preview
 * of this site fetches is a 503. It is the asleep state that is shared, so it
 * is the asleep state whose card has to work.
 *
 * Public in `proxy.ts` (link crawlers carry no session), so the signed-out
 * render is what a plain fetch gets.
 */
async function fetchImage(path: string): Promise<Buffer> {
  const response = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${path} answered ${response.status}, expected 200.`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) {
    throw new Error(`${path} returned ${type || "no content-type"}, not an image.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  // A clean rebuild every time: a leftover asset from an earlier build is a
  // file nothing references, and a leftover *document* is last month's page.
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const { file, path, asleep } of DOCUMENTS) {
    const html = await fetchDocument(path, asleep);
    await writeFile(join(DIST, file), html, "utf8");
    console.log(`  ${file.padEnd(26)} ← ${path}${asleep ? "  (asleep)" : ""}`);
  }

  for (const locale of LOCALES) {
    const png = await fetchImage(`/${locale}/opengraph-image`);
    await writeFile(join(DIST, `og-${locale}.png`), png);
    console.log(
      `  ${`og-${locale}.png`.padEnd(26)} ← /${locale}/opengraph-image`,
    );
  }

  // `public/` at the root, exactly as Next serves it — this is where `sw.js`,
  // the icons, the fonts and the mascot come from.
  await cp(join(process.cwd(), "public"), DIST, { recursive: true });

  // The build's own chunks, CSS and fonts, at the path the documents reference.
  await cp(
    join(process.cwd(), ".next", "static"),
    join(DIST, "_next", "static"),
    { recursive: true },
  );

  console.log(`\nedge/dist assembled from ${BASE_URL}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
