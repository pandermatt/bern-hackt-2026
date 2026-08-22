# Beyond Money

A personal-finance dashboard built on bank statement exports: email/password
accounts, and each account sees only its own transactions. A year of statements
becomes income and spending per month, a category breakdown, a merchant
ranking, and a filterable ledger.

Built for **Bern hackt 2026** on the PostFinance challenge data and brand kit.

Next.js 16 (App Router) · Drizzle ORM · better-sqlite3 · shadcn/ui · Tailwind v4

> The statements in `scripts/seed-data/` are **synthetic** — a fictional
> account holder supplied with the challenge. They are not anyone's real
> financial data.

## Getting started

The SQLite file lives at `./data/app.db` and is **not** committed, so a fresh
clone needs the schema pushed before the app will run:

```bash
npm install
npm run db:push   # creates ./data/app.db and its tables
npm run dev
```

Then open http://localhost:3000 and create an account at `/register`.

Then load the statements, once an account exists:

```bash
npm run seed
```

`seed` creates the **demo account** if it is missing and imports every `.csv`
in `scripts/seed-data/` into it. It is safe to re-run: the account is matched by
email and rows are keyed by statement line, so a second import replaces rather
than duplicates.

`npm run start` runs it automatically **on an empty database only** (it passes
`--if-empty`), so a fresh deploy comes up with a populated dashboard and no
manual step, while a restart onto a volume that already holds data leaves that
data alone.

| | |
| --- | --- |
| Email | `jeanine@example.com` — override with `SEED_EMAIL` |
| Password | `beyond-money-demo` — override with `SEED_PASSWORD` |

> ⚠️ **The demo password is in the repository.** Anyone who can read the source
> can sign into that account on any deployment. That is a deliberate tradeoff:
> the statements are synthetic and this is a demo. Set `SEED_PASSWORD` on the
> host to change it. If real financial data ever lands in this database, remove
> the account-creation block from `scripts/seed.ts` and go back to seeding an
> account you registered yourself.

Pointing `SEED_EMAIL` at an account that does not exist is an **error**, not a
signal to create it — the script will not hand an account you registered a
password you did not choose.

Expect `Imported 513 transactions from 2 statements (12 duplicate transfer
lines skipped)`. See [Statement import](#statement-import) for what those
numbers mean.

> `better-sqlite3` compiles a native binding on install. Under npm 11 the
> install script is gated — if it was skipped, run
> `npm install-scripts approve better-sqlite3` and reinstall.

## Using this as a template

Everything that names the app lives in `lib/site.ts`. To rebrand a clone:

1. **`lib/site.ts`** — `name`, `slug`, `tagline`, `description`. The slug also
   forms the session cookie name, so changing it signs out existing sessions
   once.
2. **`package.json`** — the `name` field.
3. **`public/icon.svg`** — then regenerate `app/favicon.ico`,
   `public/apple-icon.png` and the three `public/icon-*.png` files from it (see
   Icons below).
4. **`LICENSE`** — the copyright holder.
5. `components/landing.tsx` — the three selling points are still hardcoded.
6. `lib/signet.ts` and `app/globals.css` — the logo artwork and the palette.
   `lib/signet.ts` is generated from `res/logos/beyond-money-icon.svg`: replace
   that file, re-derive the paths, and update `SIGNET_FLAME_ORDER` to the new
   drawing's colours. The palette is the `:root` tokens; no component hardcodes
   one of *those* — the mark's own hexes are artwork and deliberately do not
   follow the theme, which is why it sits on the fixed `--logo-tile` white.

### Palette

The five PostFinance brand colours, and what each one is allowed to do:

| Hex | Name | Used for |
| --- | --- | --- |
| `#005B61` | Blue Stone | `--accent` — every interactive surface, links, focus rings. The only brand colour that passes a text contrast threshold (7.9:1 on white) |
| `#FFCC00` | Supernova | `--brand` — the landing's CTA band, the `warning` anomaly badges, the assistant's tile. A fill, never type: 1.5:1 on white |
| `#A5C400` | Pistachio | `--pistachio` — inflow bars, always with a `--pistachio-edge` stroke |
| `#F2F2F2` | Concrete | `--bg`, the page ground |
| `#FFFFFF` | White | `--surface`, cards |

Supernova and Pistachio sit at 1.5:1 and 2.0:1 against white, so they are fills
only — never type. `--positive` (`#5F7000`) is Pistachio darkened to 5.5:1 for
amounts set as text, and `--danger` red is a system colour rather than a brand
one. Every derived tone in `app/globals.css` was checked against WCAG AA.

There are **two themes**. `:root` is light; `.dark` re-derives the same five
brand colours against a dark ground, and it is a set of chosen steps rather
than an inversion — Blue Stone at 7.9:1 on white is 1.6:1 on `#1c1c1c`, so it
is lightened to `#4cc3cc` and takes dark ink on top instead of white. The
neutrals stay untinted in both. `next-themes` writes the class onto `<html>`,
which is why `<html>` carries `suppressHydrationWarning`, and `color-scheme`
follows so native date pickers and scrollbars match.

The categorical ramp (`--chart-1` … `--chart-10`, plus a neutral
`--chart-other`) is the charts' identity channel: one fixed slot per category,
assigned from the whole-range ranking so a filter can never repaint the
survivors, and never cycled — the eleventh category and beyond fold into
"Other" rather than getting a generated hue.

The ten hexes are supplied brand colours, used verbatim and identical in both
themes. Their **slot order** is derived, not given: a palette listed by role
groups its families together, and adjacent slots are what touch in a stacked
bar and a pie. In the supplied order two pairs collapsed — Brand yellow beside
Soft lime at protanopic ΔE 2.9, Soft yellow beside Brand yellow at 7.4 under
normal vision. Re-ordering fixed both without moving a hex. Re-run the
adjacency check after touching a slot; the list is in `app/globals.css` with
the current worst-pair numbers in the comment above it.

Nothing else hardcodes the product name.

### Icons

`public/icon.svg` is the source of truth; everything else is rasterized from it.
It holds its own copy of the mark — the one place that duplicates
`lib/signet.ts`, because a static file cannot import anything — over a **white**
rounded tile rather than a coloured one: the dragon is multicolour, and a
Supernova tile swallowed its whole yellow half.

All of these are **root paths under `public/`**, and have to be. Next's metadata
file convention emits an icon's `<link>` relative to the segment the file sits
in, so an `icon.svg` under `app/[locale]/` is only ever served at `/de/icon.svg`
— and `app/manifest.ts` is locale-independent and cannot name a path like that.
The layout declares both files explicitly in `generateMetadata` instead.
`app/favicon.ico` is the one that stays on a convention: it is already at the
`app/` root.

```bash
rsvg-convert -w 32 -h 32 public/icon.svg -o /tmp/i32.png   # also 16, 48
magick /tmp/i16.png /tmp/i32.png /tmp/i48.png app/favicon.ico
sed 's/ rx="7"//' public/icon.svg | rsvg-convert -w 180 -h 180 -o public/apple-icon.png
rsvg-convert -w 192 -h 192 public/icon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 public/icon.svg -o public/icon-512.png
rsvg-convert -w 512 -h 512 /tmp/maskable.svg -o public/icon-maskable-512.png
```

`apple-icon.png` drops the rounded corners because iOS applies its own mask.
`public/icon-maskable-512.png` is square-cornered *and* scales the mark to 78%,
keeping it inside the circular safe zone Android crops to — at full size the
coil grazes the edge. Build its source SVG by taking `public/icon.svg`, dropping
the `rx`, and re-fitting the group: the `translate` centres the artwork's
bounding box (x 59–433, y 35–455 of its own 512 box) at the new scale, so
multiplying the `scale` alone leaves the drawing off-centre.

Rasterizing needs `librsvg2-bin` and `imagemagick`:

```bash
apt-get install -y librsvg2-bin imagemagick
```

### Merchant logos

Rows in the ledger and the "Top merchants" list carry the merchant's own brand
mark. There is no URL anywhere in a statement, so the chain is **canonical name
→ domain → icon**, and the middle step is a hand-checked table in
`lib/merchant-brands.ts`. A name mapped to `null` there is a decision, not a
gap — an abstract line (`Rent`, `Krankenkasse`), a local business with no
findable mark, or a domain neither icon service has.

Those fall back in two steps. A line with no merchant behind it at all gets a
Lucide glyph from `ABSTRACT_GLYPHS` in `components/merchant-avatar.tsx` — a
house for rent, a banknote for salary — because initials say nothing about it.
Everything else keeps its initials, which is the point: five restaurants sharing
one fork glyph would repeat the category chip already in the row and lose the
one thing a monogram is good at, telling Molino from Luce. A test asserts every
glyph belongs to a merchant with no logo, so one can never become dead code.
`tests/merchant-brands.test.ts` fails if a merchant the importer can emit has no
entry at all, so adding one to `scripts/lib/statement.ts` and forgetting the
brand map is caught rather than silently blank.

`app/api/merchant-icon/[slug]/route.ts` fetches each mark once and caches it in
**`data/merchant-icons/`**, next to the database and driven by the same
`DATABASE_PATH` — so on a container host it belongs on the persistent volume,
or every redeploy re-fetches. 57 icons, about 680 KB. The directory is safe to
delete at any time; it rebuilds itself on the next page load. Do that to retry a
merchant recorded as a miss.

The route takes a **slug, never a domain**, and resolves it against the table.
`proxy.ts` excludes `/api` from its matcher, so the handler runs without the
cookie check — accepting a hostname from the URL would make it an open proxy
pointed at the server.

Two upstreams are tried in order: DuckDuckGo's `ip3` service, then Google's.
DuckDuckGo covers 47 of the 56 mapped merchants and Google 6 of the 9 it misses,
including SBB. A 404 is cached as a miss; a timeout, a 5xx or a 429 is not —
a cold dashboard asks for every icon at once, and treating that burst's
rate-limit replies as "no icon exists" would cache the wrong answer for good.

The marks belong to their owners and are used nominatively, to label the
merchant a transaction was with.

## Statement import

`npm run seed` reads every `.csv` in `scripts/seed-data/` and writes normalized
rows into `transactions`. The shape it expects is one line per statement entry
with `name, type, source_id, source_label, target_id, target_label,
transaction_date, amount, currency, base_amount, …`.

Four things the importer does that are not obvious, and that the tests in
`tests/seed-rules.test.ts` hold in place:

1. **It deduplicates on a natural key.** A credit-card payment appears in
   *both* account exports — once from the paying side, once from the receiving
   side. The key is `date|type|source|target|amount|name`; without it those 12
   payments count twice. 525 raw lines become 513 rows.
2. **It derives direction from `type`, not the amount.** Every amount in the
   export is positive. Income is stored positive, expenses and transfers
   negative, so a plain `SUM(amount_minor)` is the net.
3. **It separates refunds from salary.** 35 of the 48 lines typed `income` are
   merchant credits, not earnings — reporting them as income would overstate the
   year by CHF 4,590. They land in a `Refund` category and get their own tile.
4. **It canonicalises merchant names.** The exports spell the same merchant
   several ways (`Orell Fuessli` / `Orell Füssli`, `Swiss Intl. Airlines` /
   `SWISS International Airlines`, `Digitec Galaxus` / `Galaxus AG`). The table
   in `scripts/lib/statement.ts` maps the stable slug to one display name *and*
   a category; without it the merchant ranking silently splits.

Amounts are stored as **signed integer minor units** (rappen), never floats:
the EUR lines in the source arrive as `46.96976052505031`, and summing a few
hundred doubles drifts.

**The EUR lines are not converted.** All 13 of them carry `exchange_rate = 1.0`
and `base_amount == amount`, so the source asserts 1 EUR = 1 CHF. The importer
stores what the file says and keeps `currency` and `original_amount_minor`, so
a real conversion can be added later without re-importing. About CHF 1,450 of
the year is affected.

`npm run start` runs the import as `npm run seed -- --if-empty`, which imports
only when the database holds no transactions at all. A first boot on a fresh
volume seeds; every boot after that skips, so anything added since — including
transactions generated from `/account` — survives a restart. Run `npm run seed`
by hand to re-import: it is idempotent on its own, because the demo account is
matched by email and its rows are replaced rather than appended, so a manual
re-run also leaves one account and the same set of rows.

`--if-empty` asks whether the database has transactions, not whether `data/`
exists: `db:push` runs first and creates both the directory and the file, so by
the time the seed opens it the folder is never missing.

To import a different export, drop the `.csv` files in `scripts/seed-data/`
(or point `SEED_DIR` elsewhere) and re-run. Any merchant the table does not
know falls through a keyword rule to `Other`, and the script names it on
stderr so the gap is visible rather than silent.

## Anomaly detection

Findings are **precomputed and stored**, not derived while rendering.

Run a scan from **Account & Settings → Anomaly detection → Run scan**. It works
through your whole history, saves what it finds to the `anomalies` table, and
shows a progress bar while it goes. The dashboard then reads those rows back for
the transactions on the page. Re-running replaces the previous results.

This used to run inside the dashboard request, over every transaction, on every
page view. That did not survive a large account: the engine was superlinear, and
at 25 000 transactions a single page load took minutes of blocking CPU and hung
the server for everyone. Two changes fixed it — the engine itself is now
near-linear (memoised date parsing and per-group baseline statistics), and the
work moved out of the render path entirely.

| | 25 000 transactions |
| --- | --- |
| Dashboard load, before | minutes (server unresponsive) |
| Dashboard load, now | ~250 ms |
| Full scan | ~1 s, in the background |

If the dashboard shows no anomaly badges, no scan has run yet — that is expected
on a fresh database, and the settings card says so.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run start` | Pushes the schema, seeds the demo account **if the database is empty**, then serves the production build |
| `npm run build` | Production build — also the check that no server-only import leaked into a client component |
| `npm run db:push` | Apply `db/schema.ts` to the database (`drizzle-kit push`) |
| `npm run db:studio` | Drizzle Studio against the same file |
| `npm run db:backup` | Snapshot the database into `data/backups/` (`VACUUM INTO`) |
| `npm run seed` | Import `scripts/seed-data/*.csv` into an existing account. `-- --if-empty` skips when the database already holds transactions |
| `npm test` | Vitest: CSV parsing, aggregation, import rules, auth, and per-account scoping |

## Environment

Copy `.env.example` to `.env.local` if you want to override anything. Every
variable has a working default, so local development needs none of them.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/app.db` | On a container host, must point into a persistent volume |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Public origin for Open Graph tags. Read at **build** time — changing it needs a rebuild |
| `SEED_EMAIL` | `jeanine@example.com` | Which account `npm run seed` imports into. Must already exist if you change it |
| `SEED_PASSWORD` | `beyond-money-demo` | Password given to the demo account when the seed creates it |
| `SEED_DIR` | `scripts/seed-data` | Where `npm run seed` looks for `.csv` exports |
| `BACKUP_DIR` | `backups/` beside the database | Where `npm run db:backup` writes |

## Tests

`npm test` runs Vitest against a throwaway SQLite file created by
`drizzle-kit push` in `tests/global-setup.ts`, so the tests use the real schema
and never touch `./data/app.db`. They cover the scrypt round-trip, session
creation and expiry, that one account cannot read another's transactions, and —
as a regression guard on the import — that the shipped statements still produce
exactly 513 rows with every merchant categorised.

`tests/csv.test.ts` and `tests/insights.test.ts` need no database at all: the
parser and the aggregation functions are pure, which is the point of keeping
`lib/insights.ts` free of any `@/db` import.

Two project-specific wrinkles are handled in `vitest.config.mts`: `server-only`
is aliased to a stub (it throws outside Next's `react-server` condition), and
`fileParallelism` is off because every test file shares one database file and
truncates tables between tests.

## Installable app (PWA)

`app/manifest.ts` plus `public/sw.js` make the app installable to a home screen
or dock. The worker is registered by `components/sw-register.tsx` **in
production only** — in development it would sit in front of HMR and serve stale
modules. That gating is why the whole feature, install control included, only
comes alive against `npm run build && npm start`; there is no
`beforeinstallprompt` without a registered worker.

What the worker does, and deliberately does not do:

- **Never caches page responses.** The dashboard is per-account HTML; keeping it
  in Cache Storage would leave one person's finances readable on a shared device
  after sign-out. Navigations go to the network, and fall back to the precached
  offline page only when that fails.
- Caches `/_next/static/` (content-hashed, so it can never go stale).
- Precaches the offline page with `credentials: "omit"`, so the stored copy is
  always the signed-out render.

`/sw.js` and `/offline` are both in the proxy's public allowlist — the worker
registers before anyone signs in. `next.config.ts` sends `no-store` for
`/sw.js`, so a stale worker can't outlive a deploy. Bump the `CACHE` constant
in `public/sw.js` whenever you change it.

Offline means *the shell and a useful message*, not a working dashboard —
transactions live server-side, and caching them would defeat the point of not
caching page responses.

### The offline page is precached per locale

`localePrefix` is `"always"`, so there is no `/offline` — only `/de/offline` and
`/en/offline`. Precaching the bare path broke that twice over, and the worker now
fetches both prefixed URLs by name:

- Omitting credentials means no `NEXT_LOCALE` cookie, so the redirect always
  landed on the **default** locale and English visitors got a German offline page.
- The stored response carried `redirected: true`. A navigation request uses
  `redirect: "manual"`, and the browser refuses to satisfy one with a redirected
  response — so the fallback failed and Chrome showed its own error page instead,
  which is the exact thing the offline page exists to replace. `cachePut` in
  `public/sw.js` rebuilds each response before storing it, which drops the flag.

The locale list in `public/sw.js` mirrors `i18n/routing.ts` and has to be updated
alongside it. A worker is a plain script served from `public/`, outside the module
graph, so it cannot import the real one.

### Installing from inside the app

`components/install-app.tsx` renders a row on `/account` with three mutually
exclusive states, because no single control works everywhere:

- **Chromium** fires `beforeinstallprompt`. The event is captured when it fires
  (it cannot be requested later), held in state, and spent by the button.
- **iOS Safari** has no such API — installing is Share → Add to Home Screen, by
  hand — so the button opens a dialog with the steps. `appleWebApp` in the
  layout's `generateMetadata` is what makes the resulting icon open standalone.
- **Anything else** gets a sentence pointing at the browser's own menu and no
  button, rather than a control that cannot do anything.

The manifest carries an explicit `id` and `scope`. `start_url` stays `"/"`
even though that path is never a rendered page: the launch navigation carries the
`NEXT_LOCALE` cookie, so the proxy routes each install to its own locale, and `/`
forwards a signed-in visitor to `/home` once `getCurrentUser` confirms the
session. A hardcoded `/de` would launch every English install in German.

## Authentication

- Passwords are hashed with **scrypt** (`node:crypto`) using a per-user random
  salt and compared with `timingSafeEqual`. Nothing is stored in plaintext and
  there is no third-party auth dependency.
- Sessions are server-side rows. The cookie holds a random token; the database
  stores only its SHA-256 hash, so a database leak yields no usable sessions.
  The cookie is `httpOnly`, `sameSite=lax`, and `secure` in production.
- `proxy.ts` redirects unauthenticated requests, but it is an **optimistic
  check only** — it runs on the edge runtime and cannot read the database. The
  real check is `getCurrentUser()`, called by the page and by every server
  action, and every transaction query is scoped by `userId`.
- **Registration is open.** Anyone who can reach the deployment can create an
  account. If that isn't what you want, gate `/register` or add an invite code.

No auth-related environment variables are required.

## Routes

Every page route is locale-prefixed (`/de/…`, `/en/…`); the table drops the
prefix for readability.

| Route | Signed out | Signed in |
| --- | --- | --- |
| `/home` | Redirect to `/login` | The entry page — assistant, nudges, mascot |
| `/` | Landing page | Your dashboard |
| `/budget`, `/anomalies` | Redirect to `/login` | Budget and savings; anomaly findings |
| `/login`, `/register` | Auth forms | Redirect to `/home` |
| `/api/health`, `/opengraph-image`, `/manifest.webmanifest` | Public | Public |

`/home` is where signing in lands. It is deliberately short — the assistant
open and ready, at most three things worth acting on, and the dragon. `/`
stays the polymorphic public route: the landing page signed out, the full
dashboard signed in.

The three public non-page routes are requested by things that never carry a
session — healthchecks, link crawlers, the install prompt — so they are in the
proxy's allowlist. **Anything added that must answer an anonymous request has to
go in that list too**, or it silently 307s to `/login`.

`/` is public and serves both, so bookmarks to it keep working either way.
Every other route requires a session.

## How it fits together

- `app/layout.tsx` — renders the **shared shell**: `AppHeader` (which shows
  account controls or a sign-in link depending on the session) and `AppFooter`,
  so every route inherits the same chrome. It resolves `getCurrentUser()` for
  the header, which is why every route renders dynamically; `getCurrentUser` is
  wrapped in React's `cache` so the layout and the page share one query.
- `lib/site.ts` — the app's name and copy, plus the session cookie name. Free of
  `server-only` and of any database import, because `proxy.ts` (edge runtime)
  imports the cookie constant from it.
- `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` — the floor under
  a crash. Deliberately static markup: an error page with an entrance animation
  is one you might never see.
- `app/api/health/route.ts` — `{ ok, version }`, touching the database. Point the
  host's healthcheck here.
- `db/schema.ts` — `users`, `sessions`, `transactions`, and `budgets`.
- `db/index.ts` — the **only** module that imports `better-sqlite3`. Marked
  `server-only`; creates `data/` before opening, enables WAL, and caches the
  connection on `globalThis` so dev HMR doesn't leak file handles.
- `app/actions/` — every read and write, behind `"use server"`.
- `lib/insights.ts` — every aggregate the dashboard shows, as **pure
  functions**. No database import, and the schema type is imported
  `import type`, so `formatMoney` is safe to call from client code.
- `components/transaction-filters.tsx` — the filter bar. Filter state lives in
  the URL rather than React state, so a view is shareable and survives a
  reload, and the transaction list never leaves the server.
- `components/echart.tsx` — the app's single ECharts boundary: module-level
  chart registration, the palette read out of the CSS custom properties, and
  the init / resize / dispose lifecycle. The two charts import from here.
- `components/monthly-trend.tsx` and `components/category-pie.tsx` — an
  in-versus-out area chart, and a `padAngle` donut of the category split. Both
  are client
  components; both also render the identical figures as a `<table>` that ships
  in the server HTML, which is what a screen reader, a JS-off browser, or a
  failed chunk actually gets.
- `components/theme-provider.tsx`, `components/theme-setting.tsx` — the
  light/dark switch, on `next-themes`. The control lives on `/account` under
  Appearance rather than in the header; the provider still defaults to the
  system setting, so a first visit follows the OS until someone picks a side.
- `app/budget/page.tsx` — per-category monthly limits, suggested from the
  account's own averages, with a radar of the month against them. The rings are
  francs; the limits are a dashed outline and what was spent is a translucent
  fill, so anything poking outside the outline is over budget. Each category
  name carries its share of that limit as a percentage. Below it, **Sparziele**:
  savings goals drawn as pots that fill, funded by allocating what a finished
  month had left over — a month still running has no final surplus to offer.
- `lib/goal-icon.ts` — which lucide glyph a savings goal wears, guessed from its
  name in German and English. `GOAL_ICONS` is both the render table and the
  allowlist `lib/llm/suggest-goal-icon.ts` offers Apertus, which is asked only
  for a name the keyword rules cannot place and whose answer is stored in
  `savings_goals.icon`.
- `lib/clock.ts` — the only module that asks what today is. `lib/insights.ts`
  never constructs a `Date`, so "is this month over" lives here.
- `app/globals.css` — the design tokens, mapped onto shadcn's token names.

Schema changes go through `npm run db:push`. There is no migrations folder and
none should be added.

Note that `transactions.userId` is nullable at the database level on purpose —
see Deploying below. Ownership is enforced in the application layer, where every
query filters on it.

## Deploying (Coolify / any container host)

`data/` is gitignored, so a deployed container starts with **no database and no
tables**. `start` therefore runs `db:push` and then `seed` before `next start`:
the first creates the schema on boot and keeps it current on later deploys, the
second creates the demo account and imports the statements. Both are idempotent,
so redeploys are a no-op rather than a duplication.

Because `seed` is on the deploy path, **`tsx` is a runtime dependency**, not a
devDependency — same reasoning as `drizzle-kit`. Don't move it back.

Two things the host must provide:

1. **A persistent volume for the database**, with `DATABASE_PATH` pointing into
   it — for example a volume mounted at `/data` and
   `DATABASE_PATH=/data/app.db`. SQLite lives on disk; without a volume, every
   redeploy silently starts empty and all accounts are lost. An absolute
   `DATABASE_PATH` is safer than relying on the container's working directory.
2. **A real `npm install` in the image.** `better-sqlite3` compiles a native
   binding for the container's own platform; never copy a `node_modules` built
   elsewhere.

Two optional but worthwhile settings:

- **`NEXT_PUBLIC_SITE_URL`** — the deployment's public origin (e.g.
  `https://beyond-money.example.com`). Without it, `metadataBase` falls back to
  `http://localhost:3000` and every Open Graph tag points at localhost, so
  shared links render without a preview.
- **Healthcheck path `/api/health`** — returns 503 rather than 200 if the
  database is unreachable, which catches a missing volume on deploy.

`drizzle-kit` is a runtime **dependency**, not a devDependency, so it survives
`npm prune --production` and is present when `start` runs.

`start` runs `db:push` — which is `drizzle-kit push` *without* `--force` — so a
destructive schema change fails the deploy rather than silently dropping data.
This is why `transactions.userId` is nullable: making it NOT NULL on a table
that already has rows is exactly such a statement, and would break the deploy.

`db:push` creates the database's parent directory first, because `drizzle-kit`
(unlike `db/index.ts`) will not, and a fresh container has no `data/`.
