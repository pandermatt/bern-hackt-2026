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
- Facets and the monthly series are computed from the **unfiltered** rows: a
  dropdown that only offers surviving values is a dead end, and the year's
  shape is the point of the chart even when viewing one month. Totals,
  breakdowns and the ledger follow the filter.
- Filters are validated with zod and parsed with `safeParse(…).data ?? default`,
  so a junk query string renders defaults rather than throwing.

## Rendering

- **The dashboard is server-rendered.** `components/transaction-filters.tsx` is
  the **only** `"use client"` file in the app. Keep it that way: nothing else
  on this page is interactive, and it means no copy of anyone's finances ends
  up in a client bundle.
- **Filter state lives in the URL**, not in React state. A view is shareable,
  bookmarkable, and survives a reload. `TransactionFilters` calls
  `router.replace` inside a `useTransition`; because it reads `useSearchParams`
  it must stay wrapped in a `<Suspense>` boundary.
- **The chart is inline SVG in a server component, and must stay that way.**
  Every React charting library is client-only; one would ship a few hundred KB
  and a hydration boundary to draw twelve pairs of rectangles. Server SVG is in
  the HTML at first paint, works with JS off, and never shifts. Keep the
  `role="img"` + `<title>`/`<desc>` and the `sr-only` table of the same figures.
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

- Tokens live in `app/globals.css`: PostFinance deep teal `--accent` on
  teal-tinted neutrals, the brand yellow `--brand` reserved for the signet, a
  green `--positive` for money in and the existing `--danger` for money out,
  plus a `--chart-1..8` categorical ramp. Restyle by editing tokens, not by
  patching components — no component hardcodes a colour.
- **The brand yellow is an identity colour, not an interface one.** White text
  on `#FFCC00` fails contrast; the teal carries every interactive surface.
- The signet path lives once in `lib/signet.ts` and is consumed by
  `components/logo.tsx`, `app/opengraph-image.tsx` (as a data URI — Satori only
  renders SVG reliably through an `<img>`), and `app/icon.svg` (its own copy,
  being a static file).
- Committed **light theme**. There is no dark variant — don't add `.dark`
  blocks.
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
