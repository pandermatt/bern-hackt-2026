/**
 * Regenerates the product shots on the landing page.
 *
 * The landing shows the *real* app rather than a hand-built mock, which means
 * these files go stale the moment a page changes. Run this after any visible
 * change to home, dashboard, budget or anomalies:
 *
 *     npm run dev                      # in another shell, seeded and signed-in-able
 *     npx playwright install chromium  # first time only
 *     node scripts/screenshots.mjs
 *
 * Playwright is deliberately **not** a dependency of this project: it is a
 * browser download for a task that runs a few times a year. `npx` fetches it
 * on demand.
 *
 * Both themes are captured because the landing follows the reader's, and a
 * light screenshot on a dark page is a glaring white slab. They are wired up
 * through `--shot-*` tokens in `app/globals.css`.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SEED_EMAIL ?? "jeanine@example.com";
const PASSWORD = process.env.SEED_PASSWORD ?? "beyond-money-demo";
const OUT = join(process.cwd(), "public", "preview");
const TMP = join(process.cwd(), ".screenshots-tmp");

/* Captured wide and then downscaled: a 2× shot resized to 1600 is sharper on a
   retina screen than a 1600 capture, and still lands under 60 KB as webp.
   Each page gets its own height, because they are not the same shape — the
   entry page is short and a tall window just photographs its background
   gradient. Change a height here and change the matching `aspect-[…]` in
   `components/landing.tsx`, or the shot letterboxes. */
const WIDTH = 1280;
const SHOTS = [
  ["home", "/de/home", 700],
  ["dashboard", "/de/dashboard", 840],
  ["budget", "/de/budget?month=2025-09", 840],
  ["anomalies", "/de/anomalies", 840],
];

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 840 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript(
    (t) => { try { localStorage.setItem("theme", t); } catch {} },
    theme,
  );
  const page = await context.newPage();

  await page.goto(`${BASE}/de/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.locator("form button[type=submit]").first().click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 30_000 });

  for (const [name, path, height] of SHOTS) {
    await page.setViewportSize({ width: WIDTH, height });
    await page.goto(`${BASE}${path}`);
    // The charts are canvases that size themselves after mount; a fixed wait
    // is cruder than a selector but there is no single element that means
    // "every ECharts instance has drawn".
    await page.waitForTimeout(3500);
    const png = join(TMP, `${name}-${theme}.png`);
    await page.screenshot({ path: png });
    execFileSync("cwebp", ["-quiet", "-q", "80", "-resize", "1600", "0", png,
      "-o", join(OUT, `${name}-${theme}.webp`)]);
    console.log(`  ${name}-${theme}.webp`);
  }
  await context.close();
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });
console.log("done");
