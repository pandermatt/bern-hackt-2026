---
name: beyond-money
description: House rules for this Next.js + Drizzle + better-sqlite3 personal-finance app ("Beyond Money"). Load before changing the database schema, touching the statement importer or the data layer, adding a query or an aggregate, running the dev server, or extending the design system.
---

# Beyond Money — working rules

A multi-user personal-finance dashboard over imported bank statements.
Next.js 16 App Router, Drizzle ORM over better-sqlite3, shadcn/ui on the
PostFinance palette. Read-only: transactions arrive through `npm run seed`,
never through the UI.

## Database

- **Schema changes go through `npm run db:push` only** (`drizzle-kit push`).
  Never hand-write SQL migrations and never create a `drizzle/` migrations
  folder — this project deliberately has no migration history.
- The database is `./data/app.db` in **WAL** mode. `data/` is gitignored.
- `db/index.ts` is the only module inside the Next app allowed to import
  `better-sqlite3`. (`scripts/seed.ts` opens its own handle — it runs outside
  Next and cannot import a `server-only` module.) It
  is marked `server-only`, creates the `data/` directory before opening
  (better-sqlite3 throws on a missing parent directory), sets the WAL and
  foreign-key pragmas, and caches the connection on `globalThis` so dev HMR
  does not leak file handles. Don't bypass it.
- `better-sqlite3` is declared in `serverExternalPackages` in
  `next.config.ts`. Leave it there.
- **`transactions.userId` is nullable on purpose.** Production boots with
  `drizzle-kit push` and no `--force`; adding a NOT NULL column to a populated
  table is a data-loss statement that fails the deploy with
  `Interactive prompts require a TTY terminal`. Ownership is enforced in the
  application layer instead. Rows with a NULL owner match nobody. **Do not
  "tighten" this to NOT NULL** without a deliberate migration plan — and for
  the same reason, do not add a NOT NULL column to `transactions` once it has
  rows.
- **`budgets` is the one writable table.** `transactions` is read-only in the
  UI; budget limits are not. Its `userId` is **NOT NULL**, unlike
  `transactions.userId` — that column is nullable because it was added to a
  populated table and `drizzle-kit push` deploys without `--force`, whereas
  `budgets` is created empty, so the constraint costs nothing. The unique index
  on `(user_id, category)` is what makes saving an upsert rather than a
  read-then-write race.
- **An unset limit is `null`, and zero is a real budget of nothing.** Clearing
  a field deletes the row; it does not store 0. Don't collapse the two — a
  category budgeted at nothing and a category with no budget render, sort and
  warn differently.
- **Money is signed integer minor units** (`amount_minor`, rappen), never
  `real`. The EUR lines in the source arrive as `46.96976052505031`, and
  summing a few hundred IEEE-754 doubles drifts. Income is positive, expenses
  and transfers negative, so a plain sum is the net.
- **Dates are `YYYY-MM-DD` text**, not unix timestamps. A booking date is a
  date, not an instant: as a timestamp, `2025-01-01` renders as 31 December for
  anyone west of UTC. Text also makes the month key a `slice(0, 7)` and range
  filters plain string comparisons. `lib/insights.ts` never constructs a `Date`.

## Auth

Unchanged from the template this app grew out of, and still exactly true.

- Passwords: scrypt via `node:crypto`, per-user random salt, stored as
  `scrypt:<salt>:<hash>` and verified with `timingSafeEqual`. No plaintext,
  ever, and no third-party auth dependency.
- Sessions are **server-side** rows in `sessions`. The cookie carries a random
  token; the table stores only its SHA-256 hash, so a leaked database yields no
  usable sessions. Cookie is `httpOnly`, `sameSite=lax`, and `secure` in
  production.
- `proxy.ts` (Next 16 renamed `middleware` → `proxy`; the exported function
  must be named `proxy`) does an **optimistic cookie-presence check only** — it
  runs on the edge runtime and cannot reach SQLite. It is not a security
  boundary. The authoritative check is `getCurrentUser()` in `lib/auth.ts`,
  called by `app/page.tsx` and by **every** server action.
- **`/` is public and polymorphic**: `app/page.tsx` renders `<Landing />` when
  signed out and the dashboard when signed in. It must stay in the proxy's
  public list, or signed-out visitors get bounced to `/login` and the landing
  page becomes unreachable. Anything added under a new protected route is
  guarded by default — the proxy's public list is an allowlist.
- `login` verifies a dummy hash when the email is unknown, so a wrong email and
  a wrong password take similar time and return the same generic message.
- Registration is **open** — anyone who can reach the site can create an
  account.

## Data access

- Every read lives in `app/actions/transactions.ts` behind `"use server"`.
  Client components import from there or from `lib/insights.ts`; they never
  import `@/db`.
- **Every transaction query is scoped by `userId`**
  (`eq(transactions.userId, user.id)`). Never write one without that filter.
- **Reads return data directly, not `{ ok }`.** That envelope exists so a
  client can raise a `sonner` toast on a failed *mutation*, and there are no
  transaction mutations. `app/actions/auth.ts` still uses `ActionResult`; keep
  that contract there.
- **One fetch, then aggregate in JavaScript.** `getDashboard` pulls the
  account's rows once and hands them to `lib/insights.ts`. A year of statements
  is ~500 rows through a synchronous in-process driver — a full scan is under a
  millisecond, and cheaper than five `GROUP BY` round trips that would each
  re-resolve the session. Integer amounts make JS addition exact where
  drizzle's SQLite `sum()` is typed `string | null`.
  **This stops being the right call somewhere around 50k rows per account.**
  Past that, push the aggregates into SQL.
- **`lib/insights.ts` is pure and has no database import.** The schema type is
  imported with `import type` — a value import would pull drizzle into the
  client bundle the moment `transaction-filters.tsx` reaches for `formatMoney`,
  and only `npm run build` catches that.
- Facets, the monthly series and the category stack are computed from the
  **unfiltered** rows: a dropdown that only offers surviving values is a dead
  end, and the year's shape is the point of the charts even when viewing one
  month. The pie is explicitly "the whole year" for the same reason. This is
  also what makes the colour slots stable — see the design-system notes. Totals,
  breakdowns and the ledger follow the filter.
- Filters are validated with zod and parsed with `safeParse(…).data ?? default`,
  so a junk query string renders defaults rather than throwing. `?month=` on
  the budget page is checked against the months that exist and falls back to
  the default rather than rendering an empty page.
- **`saveBudgets` is the app's only data mutation, and it uses the `{ ok }`
  envelope** — that is what the envelope was always for. It runs its deletes
  and upserts inside one `db.transaction`, so a half-saved budget is not a
  state the page can land in. Reads on that page still return data directly.

## Rendering

- **The dashboard is server-rendered apart from the filter bar, the two
  charts, and the theme switch.** Everything else stays on the server. The
  charts are the deliberate exception described below; the rule they came from
  — no copy of anyone's finances in a client bundle — still holds, because what
  crosses is the *aggregate* (nine numbers a month) and never the ledger.
  `components/transaction-list.tsx` must stay server-side.
- **Filter state lives in the URL**, not in React state. A view is shareable,
  bookmarkable, and survives a reload. `TransactionFilters` calls
  `router.replace` inside a `useTransition`; because it reads `useSearchParams`
  it must stay wrapped in a `<Suspense>` boundary.
- **The charts are Apache ECharts, behind one boundary.** `components/echart.tsx`
  is the only module that imports from `echarts`; it registers the pieces the
  charts use (`BarChart`, `PieChart`, graphic, grid, tooltip, legend, canvas
  renderer)
  at module scope and owns init / resize / dispose. Import charts and
  components from `echarts/charts` and `echarts/components`, never the `echarts`
  barrel — the barrel is the whole library and roughly triples the bundle.
  This replaced a hand-rolled server SVG. That was the right call for twelve
  pairs of rectangles and the wrong one for a nine-band stack, but the
  accessibility contract it came with **did not lapse**: every chart
  still ships an `aria-label` and an `sr-only` `<table>` carrying the identical
  figures, rendered server-side, and that table is also the "relief" the
  palette's sub-3:1 fills are conditional on. A chart without its table is not
  finished.
- **Canvas cannot resolve `var(--chart-1)`.** `useChartTokens()` reads the
  tokens out of the cascade with `getComputedStyle` and re-reads them when the
  theme changes; it returns `null` until mounted, so the first frame is already
  in the right palette. Don't duplicate the palette into TypeScript — that is
  what breaks "restyle by editing tokens".
- **The budget radar's rim is framed on the budgets, not on the spending.**
  The rings are francs on one shared scale, and the rim sits at `HEADROOM` ×
  the largest limit on the dial. Fitting it to the largest *amount spent* was
  tried twice and fails the same way both times: one runaway category — CHF
  6'800 against limits averaging CHF 770 — pushes every dashed ring into a
  knot at the hub, which is the one thing the chart exists to show. Anything
  past the rim clamps to it, the max tick grows a `+`, and the real figure is
  printed under the category name, in the tooltip, and in the `sr-only` table.
  A percent-of-budget scale fixes the framing but was rejected: the axis has
  to read in francs.
- **Every category name carries its share of budget underneath it.** A franc
  scale cannot separate "half the budget" from "twice it" for a small category
  near the hub, so the shape carries magnitude and the printed percentage
  carries the verdict. Neither alone is the chart; don't drop one for tidiness.
- **The percentage under each axis name is `--positive`/`--danger`, not the
  chart fills.** They are 13px glyphs. `--chart-2` (#a5c400) is 2:1 on white
  and unreadable as text; the fill it labels is fine because a 2.5px stroke
  with a translucent area is not text.
- **The two charts answer different questions, and neither should grow into
  the other.** "Month by month" is money **in against out** over time — two
  overlaid areas, no category breakdown. The donut and "Where it goes" carry
  the category story. A category breakdown was tried in the trend chart and
  drowned the in-versus-out reading in nine bands; if you want detail there,
  add a second chart rather than another dimension to this one.
- **Reserve chart height in `app/loading.tsx`.** A canvas sizes itself from its
  container and cannot reserve its own space, so the skeleton has to carry the
  same pixel heights the components do.
- **Never animate the page shell in.** Motion applies `initial` styles during
  SSR, so an entrance animation on a container ships it at `opacity: 0` and the
  page stays blank until hydration — or forever, if JS fails. `animate-pulse` in
  `app/loading.tsx` is fine: it animates between visible states.
- `app/loading.tsx` mirrors the dashboard's footprint, chart height included, so
  a filter change does not make the page jump.

## Seed data

- `npm run seed` reads every `.csv` in `SEED_DIR` (default
  `scripts/seed-data/`) and imports it into the **demo account**, creating that
  account if it is missing. `npm run start` runs it on every boot, so a deploy
  needs no manual step. Both halves are idempotent — the account is matched by
  email, the rows are replaced — so a redeploy is a no-op.
- **The demo credentials are hardcoded in `scripts/seed.ts`** (`SEED_EMAIL` /
  `SEED_PASSWORD` override them). This is a deliberate exception to the rule the
  template started with, taken because the statements are synthetic and the app
  is a demo. Anyone who can read the repository can sign into that account on a
  deployment. **If real financial data ever lands in this database, delete the
  account-creation block** and go back to seeding an account that already exists.
- An explicit `SEED_EMAIL` naming a missing account is an **error**, not a
  request to create it — the script must never hand an account somebody
  registered a password they did not choose.
- The password is hashed through `lib/password.ts`, the same module
  `lib/auth.ts` verifies with. Don't reimplement the `scrypt:<salt>:<hash>`
  format in the script: a change to the format would break the demo login
  silently instead of failing a build.
- `scripts/seed.ts` runs its work inside an `async function main()`. A
  top-level `await` makes the module async, which tsx's CJS transform rejects
  with `ERR_REQUIRE_ASYNC_MODULE`. Keep the wrapper.
- **`naturalKey` — `date|type|source|target|amount|name` — is what makes the
  import idempotent.** A credit-card payment appears in *both* account exports,
  once per side; without the dedupe those 12 lines count twice. 525 raw lines →
  513 rows. `transactions.externalId` stores the key, unique per user.
- **`MERCHANTS` in `scripts/lib/statement.ts` is the single source of both the
  category and the canonical merchant name.** The exports spell the same
  merchant several ways; grouping on the raw label silently splits the ranking.
  Add new merchants there, not at read time — categories are assigned once, at
  import.
- **A refund is not income.** 35 of the 48 lines typed `income` are merchant
  credits. They get the `Refund` category and their own tile; folding them into
  salary overstates the year by CHF 4,590.
- **EUR lines are not converted.** All 13 carry `exchange_rate = 1.0` and
  `base_amount == amount`, so the source asserts 1 EUR = 1 CHF. Store what the
  file says; keep `currency` and `originalAmountMinor` so a real rate can be
  applied later. Do not invent one.
- The CSV reader in `scripts/lib/csv.ts` is hand-rolled on purpose —
  `split(",")` breaks on the four lines with a comma inside a quoted field, and
  a 30-line RFC 4180 reader beats a dependency for one build-time script.
- `tests/seed-rules.test.ts` asserts all of the above against the shipped
  files. If you change the merchant table or swap the exports, that is the test
  that will tell you what broke.

## Design system

- The palette is PostFinance's five brand colours, in `app/globals.css`:

  | | | Contrast on white |
  | --- | --- | --- |
  | Supernova | `#FFCC00` | 1.5:1 |
  | Pistachio | `#A5C400` | 2.0:1 |
  | Blue Stone | `#005B61` | 7.9:1 |
  | Concrete | `#F2F2F2` | ground |
  | White | `#FFFFFF` | surface |

  Every other token is derived from one of those five, and every derived tone
  clears WCAG AA. Restyle by editing tokens, not by patching components — no
  component hardcodes a colour.
- **Only Blue Stone works as text.** It is `--accent` and carries every
  interactive surface, in both directions (white-on-teal buttons included).
  Supernova and Pistachio are under 2:1 on white and are **fills only** —
  `--brand` is the signet tile in `components/logo.tsx`. Never set type in
  either. (On the dark ground both clear AA, which is why `--positive` is
  Pistachio itself there rather than the darkened step.)
- **A Pistachio fill needs `--pistachio-edge` as a stroke.** At 2:1 the fill
  alone does not make a shape perceptible against white; the edge brings it to
  3.4:1. `--pistachio` and `--pistachio-edge` currently have **no consumer** —
  they belonged to the paired-bar chart's inflow bars and its legend swatch,
  both of which the ECharts rewrite removed. They are kept because they are two
  of the five brand colours, not because something is drawing with them; if you
  reach for Pistachio as a fill again, bring the edge with it. Note the edge has
  to be *lighter* than the fill in `.dark`, not darker — its job is to separate
  the fill from the ground, and the ground moved.
- `--positive` (`#5F7000`) is Pistachio darkened to 5.5:1 for amounts set as
  **text**. Don't use the bright Pistachio for a figure, and don't use
  `--positive` where the brand colour should show.
- `--danger` red is a system colour, not a brand one — brand palettes rarely
  cover error states. Money out and destructive actions share it.
- **The ramp's hexes are given; its slot *order* is derived.** `--chart-1` …
  `--chart-10` are ten supplied brand colours, used verbatim and identical in
  both themes. The order is not the order they were supplied in, because a
  palette listed by role groups its families together — three teals, then two
  limes, then two yellows — and adjacent slots are exactly what touch in a
  stacked bar and a pie. As listed, Brand yellow beside Soft lime was
  protanopic ΔE 2.9 and Soft yellow beside Brand yellow was 7.4 under *normal*
  vision: two categories, one apparent colour. Re-ordering fixed it without
  moving a hex (now ΔE 17.2 protan / 25.1 normal). **If you add or move a slot,
  re-run the validator** (`dataviz` skill → `scripts/validate_palette.js`, once
  per mode with that mode's surface) and re-derive the order rather than
  appending.
- **Six of the ten fills are under 3:1 on white** (Soft yellow is 1.26:1), and
  Primary teal is 2.17:1 on the dark surface. That is a property of the
  supplied palette, not something the order can fix, and it is why the
  percentage labels, the legend and the `sr-only` tables are load-bearing
  rather than decorative — they are the relief those fills are conditional on.
- **`--flow-in` / `--flow-out` are direction, not identity.** Money in and
  money out are a two-state encoding, so they get their own pair — the
  palette's "positive / growth" lime and its contrasting coral — and never
  borrow a categorical slot. Keep them out of `--chart-N`: a series colour
  means "which category", and reusing one for "which direction" makes both
  meanings weaker.
- **A colour identifies a category, never its rank.** Slots come from
  `slotsOf(stack)`, computed on the whole-range ranking, and the pie, the
  stacked bars and the "Where it goes" list all read from that one map. A list
  coloured by array index repaints its survivors every time a filter reorders
  it, which makes the colour a lie. The merchant list is the one place index
  colouring survives — it has no chart counterpart, so there is nothing for it
  to disagree with.
- **A constant ground needs constant ink — use `.on-brand`.** Supernova is the
  brand colour, not a surface, so the landing's yellow CTA band keeps `#ffcc00`
  in both themes. Theme-following ink on it is near-white on yellow (1.3:1).
  `.on-brand` in `app/globals.css` re-points `--text`, `--bg` and `--surface`
  locally, so every `text-text` / `bg-text` / `text-bg` inside the band
  resolves to fixed values. This works because `@theme inline` emits
  `var(--text)` at the use site rather than a resolved colour — which is also
  why the `inline` there is load-bearing. Reach for this pattern instead of
  hardcoding a hex per element whenever a section's background does not follow
  the theme.
- **No component hardcodes a colour**, and that includes marketing pages.
  `landing.tsx` arrived from a redesign carrying ~100 `neutral-*` / `bg-white`
  literals and a copy of the *old* chart ramp inlined in its mock preview; both
  were converted to tokens. If a preview advertises the dashboard, point it at
  `var(--chart-N)` so it cannot drift from the real thing.
- **Never generate an eleventh hue.** Ten slots, then `--chart-other`.
  `stackByCategory` folds the tail — and the literal "Other" category, which
  never competes for a slot — into it. `CATEGORY_SLOTS` in `lib/insights.ts` is
  the single source of that number; `components/breakdown-list.tsx` has its own
  modulo for the merchant list, so grep for it if the ramp is resized again.
- **`--chart-other` and `--chart-ink` swap between themes; the ten hues do
  not.** The palette supplies one light neutral (Concrete) and one dark
  neutral, and each is used on the ground it can actually be seen against —
  Dark neutral on white, Concrete on the dark surface. `--chart-ink` is the
  diagrams' text, connectors and outlines.
- Neutrals are **untinted**. Concrete is a pure neutral (HSL 0, 0, 95) and a
  teal-tinted grey scale fights it.
- The signet path lives once in `lib/signet.ts` and is consumed by
  `components/logo.tsx`, `app/opengraph-image.tsx` (as a data URI — Satori only
  renders SVG reliably through an `<img>`), and `app/icon.svg` (its own copy,
  being a static file).
- **Two themes.** `:root` is light, `.dark` is dark, and `next-themes` puts the
  class on `<html>` — which is why `<html>` needs `suppressHydrationWarning`
  and why `color-scheme` is set alongside each (without it, a native
  `<input type="date">` renders a light calendar icon on a dark field). The
  dark steps are **chosen, not inverted**: Blue Stone is 7.9:1 on white and
  1.6:1 on `#1c1c1c`, so `--accent` becomes `#4cc3cc` and `--primary-foreground`
  flips to a dark ink. Neutrals stay untinted in both. Add a token to `:root`
  and you must add it to `.dark` too.
- Nunito for UI, IBM Plex Mono for money, dates and counts. **Every amount is
  `font-mono` and `tabular-nums`** so columns of figures line up.
- `formatMoney` is unsigned (`signDisplay: "never"`): de-CH renders a negative
  as `CHF-92’969.40` and `-0` as `CHF-0.00`. The caller renders a real minus
  glyph (U+2212) and a colour.
- Month labels are the hardcoded `MONTH_LABELS` array, not
  `Intl.DateTimeFormat` — `en-GB` returns `"Sept"`, four characters where every
  other month has three, which breaks the chart's column rhythm.
- **shadcn `asChild` gotcha**: `AlertDialogAction`/`AlertDialogCancel` wrap a
  `Button`, so the Button's variant classes land on the same element and
  `cn()` cannot merge them. Overrides there need Tailwind v4's trailing
  important modifier (`bg-danger!`), not a leading `!`.

## Deployment

- Coolify on Hetzner behind Cloudflare.
- `data/` is gitignored, so a fresh container has no tables. `npm run start`
  runs `npm run db:push && next start` for exactly this reason — don't reduce
  it back to `next start`, or the site 500s with `no such table`. `db:push`
  creates the database's parent directory first, because `drizzle-kit` will
  not.
- `drizzle-kit` **and `tsx`** are dependencies, not devDependencies, so they
  survive `npm prune --production`. `start` runs both (`db:push`, then `seed`).
  Keep them that way.
- The host must mount a **persistent volume** for the database and point
  `DATABASE_PATH` at it (e.g. `DATABASE_PATH=/data/app.db` with a volume at
  `/data`). Without it, accounts and statements vanish on every redeploy.
- No auth secrets are needed: session tokens are random and stored hashed.

## Running it

- Start the dev server through `.claude/launch.json` (config
  `beyond-money-dev`, port 3000).
- After renaming or deleting files, Turbopack's dev cache can serve a stale
  module graph — stop the server, `rm -rf .next`, restart.
- `npx tsc --noEmit` fails with `Cannot find name 'LayoutProps'` if `.next` was
  just deleted; those route types are generated by `next build`. Run
  `npm run build` instead — it is the typecheck.
- Regenerating icons needs `librsvg2-bin` and `imagemagick`; the recipe is in
  the README.
