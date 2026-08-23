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
- **`budgets`, `savings_goals`, `savings_allocations` and `merchant_overrides`
  are the writable tables.** `transactions` is read-only in the
  UI; budget limits are not. Its `userId` is **NOT NULL**, unlike
  `transactions.userId` — that column is nullable because it was added to a
  populated table and `drizzle-kit push` deploys without `--force`, whereas
  `budgets` is created empty, so the constraint costs nothing. The unique index
  on `(user_id, category)` is what makes saving an upsert rather than a
  read-then-write race. The two savings tables are created empty for the same
  reason and follow the same shape.
- **`merchant_overrides` is applied on read and never written into
  `transactions`.** It holds what the account holder decided about a merchant —
  the category its lines belong to, and the domain its logo comes from — set on
  `/account` and keyed on the merchant *name*, like `MERCHANT_BRANDS`. The
  statements stay exactly as they were imported, so a decision can be changed
  or withdrawn without a re-import and covers lines that arrive later under the
  same name for free. `applyMerchantOverrides` in `lib/merchant-overrides.ts` is
  the only implementation of that swap, and **every read that cares about a
  category has to go through it** — `ownedRows` in `app/actions/transactions.ts`
  and in `app/actions/budget.ts`, and the row read in `runScan`. Miss one and
  the donut, the budget and the ledger disagree about the same franc. A row with
  neither a category nor a domain is deleted rather than stored: no opinion is
  the absence of a row.
- **An allocation is keyed by `(goal_id, month)`, not appended as a log.** The
  page's question is "how much of March have I already put away", and with a
  log that answer changes meaning the moment someone revises an allocation.
  One row per goal per month makes revising an upsert and keeps the month's
  remaining balance a subtraction rather than a reconciliation.
- **`updateSavingsGoal` changes the target and nothing else.** The name picks
  the pot's glyph, so renaming would silently repaint the card — and where the
  model named that glyph, it named it for a goal that no longer exists under
  that name. Delete and re-add is the honest way to change what a goal *is*. A
  target below what is already saved is allowed — the pot reads over 100%,
  which is true; money is never discarded to make a number fit.
- **Deleting a goal releases its money rather than destroying it.** A month's
  surplus is a property of the statements, so cascading the allocations away
  makes those francs allocatable again. The confirm dialog says so, because it
  is the opposite of what "delete" usually means.
- **An unset limit is `null`, and zero is a real budget of nothing.** Clearing
  a field deletes the row; it does not store 0. Don't collapse the two — a
  category budgeted at nothing and a category with no budget render, sort and
  warn differently. **Savings allocations are the opposite**: putting zero
  francs in a pot and putting nothing in it are the same event, so there both
  blank and `0` delete the row. The distinction is about whether the value
  carries meaning, not about house style.
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
- **Signing in is switched off, and signing up may be gated.** Both switches
  live in `lib/auth-gate.ts`. `LOGIN_DISABLED` is a constant, not an env flag —
  it is a decision about this branch, so `/login` renders a notice instead of
  the form and `login` refuses before the lookup, because a `"use server"`
  export is an endpoint whatever the page renders. `LOGIN_KEY` (env, unset by
  default) gates registration: set it and the sign-up form asks for a key,
  checked in `register` **before** the email lookup — `emailTaken` is a
  different answer than a rejected key, and answering it first would make the
  open form an oracle for which addresses hold an account. The module is
  `server-only` and the pages pass the *question* (`loginKeyRequired()`) to the
  client form as a boolean; `LOGIN_KEY` carries no `NEXT_PUBLIC_` prefix, so a
  client import would read `undefined` and decide registration is open.
- Registration is otherwise **open** — with no `LOGIN_KEY` set, anyone who can
  reach the site can create an account.
- **`users.name` is nullable, and optional at sign-up**, for the same reason
  `transactions.userId` is: `drizzle-kit push` runs without `--force` in
  production and a NOT NULL column on a populated table fails the deploy.
  Nothing reads it raw — `displayName` in `lib/user.ts` falls back to the
  email's local part, so the greeting and the header pill work for every
  account that predates the column. `updateProfile` in `app/actions/auth.ts`
  resolves the account from the session, never from an argument, and
  `revalidatePath("/")` is not optional there: the header renders from the root
  layout and `getCurrentUser` is React-`cache`d per request.
- The result type in `app/actions/auth.ts` is `AuthState`
  (`{ error?, saved? } | undefined`), which `useActionState` consumes directly.
  The `{ ok }` envelope lives in `app/actions/anomalies.ts` and a third shape,
  `ActionState`, in `app/actions/demo-data.ts`. Match the file you are in.

## Data access

- **A `"use server"` module may only export async functions.** A plain `const`
  there fails the build, which is why `UNFILED` sits in
  `lib/merchant-overrides.ts` and reaches the mapper form as a field of the
  payload — that module imports `@/db`, so a client component cannot import it
  either.
- Every read lives in `app/actions/transactions.ts` behind `"use server"`.
  Client components import from there or from `lib/insights.ts`; they never
  import `@/db`.
- **Every transaction query is scoped by `userId`**
  (`eq(transactions.userId, user.id)`). Never write one without that filter.
- **Reads return data directly, not `{ ok }`.** That envelope exists so a
  client can raise a `sonner` toast on a failed *mutation*, and there are no
  transaction mutations. `app/actions/auth.ts` has its own contract
  (`AuthState`); keep it there.
- **One fetch, then aggregate in JavaScript.** `getDashboard` pulls the
  account's rows once and hands them to `lib/insights.ts`. Twenty months of
  statements is ~930 rows through a synchronous in-process driver — a full scan is under a
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
- **Mutations use the `{ ok }` envelope; reads return data directly.**
  `saveBudgets`, the three actions in `app/actions/savings.ts` and
  `setAnomalyResolved` are the app's only mutations — that envelope is what the
  client raises a `sonner` toast off. Each runs its deletes and upserts inside
  one `db.transaction`, so a half-saved budget, a half-allocated month or a
  finding resolved without its natural key is not a state the page can land in.
  **That callback is synchronous** — better-sqlite3 is a sync driver, so the
  statements inside end in `.run()` / `.all()` and an `async` callback silently
  breaks the transaction.
- **`allocateSurplus` recomputes the month's surplus server-side.** It is the
  one number that bounds the whole operation, and a client that posts its own
  ceiling has no ceiling. The action also intersects the posted goal ids with
  the ones this account owns, so a guessed id cannot fund someone else's pot.
  The running total in `SavingsAllocator` is a convenience, not the check —
  verified by replaying the action's own POST with a tampered amount.

## Rendering

- **A pot is inline SVG in a server component, not a chart.** It is one number
  between 0 and 1; putting the ECharts boundary and a canvas around a rectangle
  buys nothing. The jar is a `clipPath` and the money is a rect whose top edge
  moves, so it renders in the server HTML and needs no hydration. `potFill`
  clamps at 1 — over-funding a goal is allowed, but a 130% fill paints outside
  the jar.
- **The pot is one cylinder drawn from one viewing angle.** `RY` is the
  perspective squash, and the *same* ellipse is reused for the mouth, the
  liquid's surface and the base. Change it in one place or the vessel stops
  being a solid. The body is `--surface-muted`, not `--surface`: on a card that
  is already `--surface` the walls would vanish in both themes.
- **The pot always ships a progress bar underneath it.** A cylinder is a poor
  instrument for reading a proportion — the eye compares lengths on a shared
  baseline far better than areas in a jar — so the pot carries the identity and
  the bar carries the precision. Don't drop it for tidiness; it is the same
  "relief" argument as the charts' `sr-only` tables.
- **Goal glyphs are lucide, like every other icon in the app.** This was Font
  Awesome for one component, which is a whole dependency and a second drawing
  convention so that one picture could look unlike every other picture in the
  product. `lib/goal-icon.ts` guesses from the goal's name in German and
  English; there is still no picker, because it is a second field to fill in for
  something the name already says.
- **`GOAL_ICONS` is the render table *and* the model's allowlist**, and that is
  the point of it. `lib/llm/suggest-goal-icon.ts` asks Apertus only for a name
  the keyword rules cannot place, offers it the map's own keys, and drops
  anything else rather than repairing it — the same two-key discipline as
  `canEscalateToAlert`. The answer is stored in `savings_goals.icon` (nullable,
  validated on read), so it costs one request per goal, never one per render. No
  key, a timeout or an invented word all mean the same thing: a piggy bank.
- **The 8B model needs the list one name per line.** Run together as prose it
  answered "Kite" for a kitesurf board and "Coat" for a winter jacket. As a
  scannable list with worked examples of picking the nearest *listed* thing, 15
  of 16 Swiss-German goal names came back usable. Keep the shape if you touch
  that prompt.
- **A lucide glyph is a nested `<svg>`, not a pasted path.** It carries its own
  `viewBox="0 0 24 24"`, so `x`/`y`/`size` place it in the pot's coordinates and
  every icon is square — the `max(width, height)` fitting this used to need went
  with Font Awesome, whose boxes are not (`fa-laptop` is 640×512). A `clipPath`
  resolves in the user space of the element that references it, so the clip must
  sit on the **group around** the glyph or the waterline scales with it.
- **The glyph is drawn twice, clipped at the waterline: `--accent` above,
  `--chart-ink` below.** It sits on the wall, so the level rises past it as the
  goal fills, and it has to stay legible on whichever of the ten hues it ends
  up under. Don't use the accent for the submerged half — the brand colour is a
  teal and three of the fills are teals, so the glyph vanished into its own
  liquid. Ink only ever darkens (or, in `.dark`, only ever lightens) whatever
  it lands on. The submerged copy sits heavier than the dry one (0.6 against
  0.9): a stroked glyph has far less ink to lose to opacity than the filled
  silhouette this used to be.
- **`potFill` clamps and `potPercent` does not, on purpose.** The jar has a
  rim, so the drawing stops at 1; the label must not, or a pot holding CHF 300
  against a CHF 200 goal reads a flat, useless 100%. Both come off the same two
  amounts — `potPercent` is the one that gets printed, and the progress bar
  (being a track) uses the clamped one.
- **A pot at 100% is sealed with a lid.** `full` swaps the open mouth — rim
  ellipse plus the inner shade of the far wall — for a lid band, crown and
  knob. The lid is the pot's own material rather than the goal's colour: it
  says "closed", and a second tinted shape would compete with the fill for
  that reading. The knob has to sit above the crown (`LID_Y - RY`), or the
  crown ellipse simply paints over it.
- **Guard the liquid on `fill > 0`.** The surface at zero sits on the base
  ellipse's *centre*, so drawing "from the surface down" still paints a
  crescent along the floor — an empty pot with a sliver of colour in it.
- **A pot's colour comes from its row id, not its position.** `potSlot` keys on
  the id so deleting one goal does not repaint the rest. Goals have no chart
  counterpart to agree with, so any stable mapping does — this one is stable
  because ids are.
- **The dashboard is server-rendered apart from the filter bar, the two
  charts, and the theme switch.** Everything else stays on the server. The
  charts are the deliberate exception described below; the rule they came from
  — no copy of anyone's finances in a client bundle — still holds, because what
  crosses is the *aggregate* (nine numbers a month) and never the ledger.
  `components/transaction-list.tsx` must stay server-side.
- The other client components are the ones that genuinely need interactivity:
  `transaction-pagination.tsx`, `demo-data-controls.tsx` and
  `anomaly-scan-controls.tsx`. The last polls a background job and holds no
  financial data of its own — only a progress count.
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
- **The budget radar's rings are francs, on one scale shared by every spoke.**
  A spoke sitting far out is a large amount of money wherever it is on the
  dial, which is what makes the two shapes readable *as shapes*. Per-spoke
  normalisation — every category drawn as a share of its own budget, so the
  dashed shape is a circle at 100% — was tried and reverted: it buys one clean
  thing to look for and pays for it with the whole magnitude axis, drawing
  CHF 60 of a CHF 50 budget as the identical spoke to CHF 6'000 of a CHF 5'000
  one. **The axis reads in francs.** What that costs is the near-hub
  categories, where "half the budget" and "twice it" are a few pixels apart —
  which is exactly why the percentage is printed under every name. Read the
  shape for scale and the number for the verdict; neither alone is the chart.
- **The dial is refitted per month, and bends when a month needs it.**
  `lib/budget-scale.ts` owns that arithmetic; the component only draws through
  the `toDial` / `toMinor` pair it hands back, in minor units. While the
  month's peak stays inside `OUTLIER_CAP` × the largest budget the rings are
  plain linear franc steps. Past that they go logarithmic, with the knee
  **solved** so the largest budget keeps the radius the cap would have given
  it — which is what makes the two modes continuous and stops the dial popping
  as you page months. Limits averaging CHF 770 next to one runaway category at
  CHF 8'200 is the case: on a linear dial fitted to the outlier, every dashed
  ring knots at the hub.
- **The rings are chosen first and the curve fitted through them.** Round franc
  figures at every ring, then piecewise interpolation between them — so a tick
  never prints `CHF 1'237`, and the printed figure is the *exact* value of the
  ring it sits on rather than a tidied-up approximation. `roundish` rounds the
  rim **up**, so nothing ever falls outside the dial.
- **Nothing clips.** The dial used to stop at the cap and clamp everything past
  it onto the rim behind a `+` on the outer tick, which threw away the one
  figure the reader was looking at and drew CHF 2'500 and CHF 8'200 as the same
  spoke. **Don't reintroduce a clamp** — bending the scale is what replaced it.
  The `+` went with it: every tick now means what it says.
- **A compressed month says so, and a linear one does not.** `radarCompressed`
  renders under the chart only when `dial.compressed`. A scale that reads
  differently than it looks has to admit it; a standing caveat under a dial
  that is in fact linear is its own kind of wrong. Note the caveat is about the
  *spacing* of the rings, not their units — the dial reads in francs in both
  modes.
- **The radar's radius is measured, not a percentage.** ECharts resolves
  `radius: "65%"` against `min(width, height) / 2`, but what has to fit outside
  the dial is a *text label*, and text does not scale with the container. One
  percentage that frames the dial nicely at 1280px clips "Marketplace" at
  402px. `BudgetRadar` observes its own box, measures the widest axis label
  with `measureText`, and subtracts — which is why `NAME_FONT` is pinned on
  both the rich style and the ruler. If those two ever disagree the radius is
  computed against the wrong width.
- **Below `sm` the radar changes shape, not just size.** Shorter box (a radar
  is bounded by the narrower side, so the desktop height is only dead space),
  smaller type, names broken at their last space, and only the rim tick — six
  axis numbers queue up one short spoke, and the series paints over them. The
  rim tick goes too once the dial is under 60px.
- **Every category name carries its share of budget underneath it** — the
  verdict the shared franc dial cannot deliver near the hub, where a 2× overrun
  on a small limit is a few pixels. `share()` is both what colours it and what
  the tooltip prints, so the two can never disagree; the francs live in the
  shape, the tooltip and the `sr-only` table. The strings are measured per row
  in `radiusFor` **at the weight they are drawn in**, so the dial sizes itself
  against what it actually prints. Don't drop the percentage for tidiness.
- **Past 100% that percentage is red *and* bold, and the weights are 500/700
  for a reason.** Red alone says nothing to a reader who does not see colour,
  so weight carries the same verdict a second way. Canvas resolves a numeric
  weight against the faces the family ships, and `sans-serif` typically ships
  two: CSS font matching sends 600 and up to the bold face and everything below
  to the regular one, so 600 against 800 would have been the identical glyph
  twice. `SHARE_WEIGHT` (500) and `OVER_WEIGHT` (700) straddle that boundary.
- **The percentage under each axis name is `--positive`/`--danger`, not the
  chart fills.** They are 13px glyphs. `--chart-2` (#a5c400) is 2:1 on white
  and unreadable as text; the fill it labels is fine because a 2.5px stroke
  with a translucent area is not text.
- **The two charts answer different questions, and neither should grow into
  the other.** "Month by month" is the **net balance** over time — one bar per
  month diverging from a zero line, coloured by the `--flow-in`/`--flow-out`
  direction pair, no category breakdown, **one year at a time** behind a
  prev/next year pager. (It was two overlaid in/out areas before being reduced
  to balance-only bars.) Hovering a column widens it in place and hangs its
  amount off the data end — that label *is* the tooltip, so the chart has no
  floating one. The per-column width is why the bars are an ECharts `custom`
  series (`renderItem`): a `bar` series has one width for the whole series,
  and its zero baseline rides an empty companion `bar` series because a custom
  series cannot carry a `markLine`. Above the bars, a slim aligned panel
  carries the **running account balance** (`MonthPoint.balance`, the running
  sum of the nets) as an ink line — its own auto-scaled axis in its own grid,
  because the stock is routinely thirty times the flows and a shared scale
  squashes the bars into slivers, while a second axis on one plot would be a
  dual-axis chart. The synthetic generator's solvency pass raises salaries
  until that balance ends positive, so demo data always has a line worth
  reading. The donut carries the category
  story — and since the ranked "Where it goes" list was dropped as a second
  telling of it, the donut is the **only** thing carrying it, which is why its
  legend now shows at every width rather than only from `sm` up. A category
  breakdown was tried in the trend chart and drowned its reading in nine bands;
  if you want detail there, add a second chart rather than another dimension to
  this one.
- **A visually hidden table needs a wrapper `<div className="sr-only">`.**
  `sr-only` sets `width: 1px`, and a `<table>` ignores that — its intrinsic
  content width wins — so an absolutely positioned 520px table sat in the
  layout and gave the whole page a horizontal scrollbar on a phone. The div
  takes the class and clips the table inside it. Same reason the `<caption>`
  escaped: a table is not an ordinary block.
- **The `sr-only` tables carry `aria-label`, not `<caption>`.** A caption box
  belongs to the table *wrapper*, which is not reliably clipped along with the
  `sr-only` box — Safari paints it as a stray line of text under the chart.
  `aria-label` gives a screen reader the identical name and renders nothing
  anywhere. Don't reintroduce `<caption>` on a visually hidden table.
  `components/summary-cards.tsx` (the forecast tile) and
  `components/transaction-calendar.tsx` were the last two carrying a
  `<caption>` on a bare `sr-only` table — both bugs at once — and were
  converted to the wrapper-div-plus-`aria-label` shape; every hidden table
  now follows both rules.
- **The assistant lives on `/home` and nowhere else, and its state lives in
  the shell.** `components/chat-panel.tsx` exports `useAssistantChat()` beside
  `<ChatPanel>`; `HomeChat` is the one shell around it, inline and already
  open at the top of `/home`. The dashboard used to mount a second copy as a
  slide-over (`ChatSidebar`) — that is gone, along with the `Chat.openLabel`,
  `panelLabel`, `resizeLabel` and `close` strings that only it used. Don't put
  the assistant back on the dashboard; that page is the ledger. The hook and
  the component stay split rather than merged: the shell holds the transcript
  above whatever branch hides the panel — the debug toggle today — so a
  conversation survives being toggled away from. Merge them and every toggle
  silently discards the chat.
- **`ChatPanel` carries `min-h-0` in its own base classes.** It is a new flex
  item between a full-height shell and a scrolling transcript, and it has no
  `overflow` of its own, so without it a long conversation resolves to
  `min-content` and pushes the input form off the bottom of the screen. The
  shell owns the height through two className seams (`className`,
  `scrollClassName`) — not a `variant` prop, which would bake the page's
  layout into the shared component. `className` is also how the shell *hides*
  the panel: below `lg` it is `max-lg:hidden` until opened, rather than
  unmounted, so the input (and the ref the "other" button focuses) stays in
  the tree.
- **The dragon is called Batzi, and the assistant *is* him.** The card on
  `/home` is headed "Ask Batzi" rather than "Money assistant" — a named mascot
  is what the page has instead of a product name, and the name is a *Batzen*,
  the old coin he is holding in `coin`. Anything the app says about that
  character uses the name (`Chat.title`, `Chat.thinking`, `Chat.inputLabel`,
  `Home.dragonAlt.*`); the landing page's canned exchange still says "the
  dragon" and is the one place left to bring across. Don't reintroduce
  "assistant" as a *name* — it is fine as a common noun in prose.
- **The card's tagline is `lg`-only.** `Chat.subtitle` is a second line under
  a title that is already an instruction, and on the folded phone panel a line
  of header costs a chip's worth of transcript. It comes back from `lg`, where
  there is room for it.
- **On a phone there is no panel until it is asked for, and the dragon is
  why.** Below `lg` `HomeChat` renders `ChatLauncher` instead: a wrapped block
  of question pills capped at `max-h-38` — three rows and a glimpse of the
  fourth — with an "other" pill under it, and no transcript or input row at
  all. That is ~250px of card against ~380, and the difference is the mascot's:
  he is what the page is arranged around and what is saying the nudges, and at
  the full height he started below the fold. Two shapes were tried and are
  worth not repeating: wrapping *freely* is seven rows and 312px in German,
  which is the panel it replaces; one sideways-scrolling row is 112px but fits
  a single question on a 390px screen and hides the rest behind a gesture
  nothing announces. The cap plus the bottom fade is the middle — and the cap
  must not land on a row boundary, or the box reads as the end of the list.
  Folded is the SSR state, like the nudge deck's, so `/home` arrives with the
  dragon in frame and stays that way with JS off. Three things hang off it: a
  **send** opens the panel (`HomeChat` wraps `chat.send`), because asking is
  the one gesture that means "I want to read the answer" — and nothing closes
  it again, since collapsing under a reader is the shifting page the fixed
  height exists to prevent; **"other" is the one thing that focuses the
  input**, which is the on-demand case `ChatPanel`'s `inputRef` was kept for
  (an effect on the open flag, because focusing a `display: none` element is a
  no-op), and it sits *outside* the scroller because with the input folded a
  question nobody offered has no other way in; and the pills are the
  **follow-ups** once there are any, since folded is a state a reader comes
  back to mid-conversation and "what to ask next" is the honest content for it
  either way.
- **The chat is drawn in the page's own vocabulary, not its own.** The card is
  `rounded-lg border border-line bg-surface` — `components/nudge-card.tsx`'s
  shape, since the two sit one above the other on `/home` — and not the
  `rounded-xl` shadowed box it was. Every question pill is `CHAT_PILL` from
  `chat-panel.tsx`, which is `components/app-header.tsx`'s button pill down to
  the `shadow-2xs` and the `active:scale-95`; the launcher renders the same
  constant. It carries `max-w-full` and **not** `shrink-0` — these pills wrap
  inside their box, and a pill that cannot shrink runs a long German question
  straight out of the card. The follow-up row under the input is the exception,
  since it scrolls sideways, and adds `shrink-0 whitespace-nowrap` at the call
  site. Bubbles fill with `--surface-muted` rather than a bordered `--bg`,
  which is white on white in light mode. `CHAT_PILL_SHAPE` exists for the one
  pill that wants other colours: append a second `bg-*` to the full constant
  and which one wins is down to the cascade, not the order you wrote them in.
  There is no rule under the card's header any more — it separated a title from
  the one thing that title introduces.
- **The transcript's auto-scroll skips an empty conversation.** There is
  nothing to follow before the first turn, and following anyway is visible at
  the folded size: the page opened on the *last* starter chip with the one
  above it sliced in half.
- **The inline panel does not autofocus.** Focusing an input near the top of a
  phone page raises the keyboard on arrival and shoves away what the reader
  came for, so `HomeChat` passes no `inputRef`. The prop survives on
  `ChatPanel` for a shell that opens the chat on demand; nothing passes it
  today.
- **Nothing sets type on the pistachio.** `/home` fades to `--pistachio` at the
  bottom *because* that is where the dragon is, and the bottom of that page is
  now where the nudges are too; Pistachio is 2:1 on white and is a fill, never a
  ground for words. Every string down there carries its own ground — the cards
  on `bg-surface`, and the all-clear line and the "show all" toggle on surface
  pills, for exactly this reason.
- **`/home`'s column stretches with `flex-1`, never `min-h-full`.** The mascot
  is placed by `mt-auto` — bottom of the *page*, and the deck unfolds upwards
  out of him — and that needs free space to claim. `min-height: 100%` there
  resolved against an ancestor chain whose height is a minimum rather than a
  definite one, so it collapsed to nothing and the column was merely as tall as
  its content; it went unnoticed only because the chat used to overflow a phone
  screen on its own. `main` is a flex column and the page column is its growing
  child.
- **That gradient has to be carried under the tab bar by hand.** `<body>`
  reserves the floating bar's height as its *own* `app-shell:pb-30`, and
  padding paints the body's `bg-bg` — invisible on every other page, whose
  ground that already is, but on `/home` it cut the pistachio off in a white
  band above the bar. So that `main` carries `app-shell:-mb-30
  app-shell:pb-30`: the negative margin grows it into the reserved strip and
  the matching padding puts the clearance back *inside* the gradient, so the
  saturated end reaches the bottom of the screen and the dragon still sits
  clear of the glass. The two must stay equal to the body's `pb-30`, and all
  three follow the bar's own padding in `components/tab-bar.tsx`. Any future
  page with a background of its own needs the same pair.
- **`allocateSurplus` is the only thing that writes `savings_allocations`.**
  The app briefly carried a Dauersparauftrag — `savings_goals.monthly_minor`, a
  stated monthly intention that seeded the allocator's fields — and it was
  removed: a pot took two numbers to explain, and the plan never moved money,
  so it earned a control, a dialog, a column and nine strings per locale to
  pre-fill one input. If it comes back, it comes back as a plan that still
  writes nothing, because a standing order that quietly filled pots would
  invent savings out of months that never had the income.
- **`savings_goals.monthly_minor` is still declared, and deleting it from the
  schema is what you must not do.** The Dauersparauftrag above left the column
  behind on purpose. `drizzle-kit push` does *not* ignore a column the schema
  stopped declaring — it plans a drop, and because the column holds values it
  stops on `Found data-loss statements` and waits for a keypress, which in
  `npm run start` is the error `Interactive prompts require a TTY terminal` and
  a failed deploy. Same constraint that keeps `transactions.userId` nullable.
  Retiring it for real means clearing the values first and pushing from a
  terminal — a deliberate migration, not a side effect of deleting a feature.
- **Probe a schema question against a *complete* copy of the database.** It
  runs in WAL mode, so `cp data/app.db` alone hands you a stale snapshot that
  can be missing whole columns, and a push against it will happily report
  "No changes detected" for a change that in fact prompts. Copy `app.db`,
  `app.db-wal` and `app.db-shm` together, or checkpoint first.
- **`savings_goals.target_on` is `YYYY-MM-DD` text and nullable.** Text for the
  same reason `transactions.booked_on` is: a deadline is a calendar day, and as
  a timestamp 2026-07-01 renders as 30 June west of UTC. Nullable because
  plenty of goals are "eventually", and a past date is allowed — that is an
  overdue goal, which is true. Validate with `isCalendarDate`, not a regex: the
  shape alone accepts 2026-02-30.
- **Pots sort by `byTargetDate`: soonest first, undated last.** `null` is
  "eventually", and eventually is never sooner than a date — sorting undated
  pots to the top buries the one that is actually due. Ties break on id so a
  pot does not jump when a sibling is edited. Sorted in JavaScript rather than
  SQL because that null rule is not SQL's, and because it is worth testing.
- **Nudges are ranked in `lib/nudges.ts`, which is pure.** No DB import, no
  i18n call — anomaly nudges arrive already translated from
  `app/actions/anomalies.ts` and this module only orders them. `isOverBudget`
  lives there too: the comparison used to be inline in both `budget-editor` and
  `budget-radar` and exported from neither. Capped at three, warnings before
  the tip, because an entry page is not an inbox — and that cap is now also
  what keeps the deck legible, since a deck of eight is a pile.
- **The nudges are what the dragon is saying, so one component owns both.**
  `components/nudge-stack.tsx` holds the deck, the toggle *and* the mascot —
  hence the `speaker` prop. The mascot is **centred under the deck**, with the
  trail of nubs running down out of the bubble onto its head, so the channel is
  above the dragon; that is what lets the toggle sit *below* it rather than
  beside it, which it has to, because a centred mascot leaves under 90px either
  side at `lg` and the German string does not fit there. The trail is circles
  rather than a triangular tail because a tail would have the card's own 1px
  bottom border drawn straight across its neck, and because circles do not care
  that the bubble changes height when it unfolds. With nothing to report the
  page passes the all-clear line as the stack's only child, so a quiet day is
  the same arrangement saying one short thing rather than a second layout to
  keep in step.
- **The mascot sizes its own box, and the trail aims in percentages of it.**
  The dragon used to sit `absolute` in a fixed `h-28 w-36` slot at up to 2.4×
  that size, overflowing into both the trail and the toggle, with the nubs
  placed in absolute px tuned at the phone breakpoint — so at `lg` the trail
  pointed at empty air. The image is now an ordinary child that gives the
  wrapper its width, and the nubs are positioned in **percentages** of that
  wrapper, which is what keeps them aimed across both sizes. The head sits left
  of the asset's centre, between 34% and 43% across the four moods, under a
  mane that leaves the top tenth of the 512×512 frame transparent — that
  headroom is what the nubs rise into. **Re-check the offsets by eye if the
  mood set changes**; they are the one thing here that cannot be reasoned out
  from the markup.
- **The deck ships collapsed and unfolds with `0fr → 1fr`.** Collapsed is the
  SSR state, so the page arrives readable and stays that way with JS off — the
  no-shell-animation rule below, honoured by animating between two visible
  states rather than in from nothing. `grid-template-rows: 0fr → 1fr`
  interpolates natively, which is what lets a card of unknown height open with
  no measuring and no `ResizeObserver`; the inner `overflow-hidden` is required,
  because the row is what shrinks and content does not clip itself. **Do not
  give the collapsed row a small px peek** (`10px → 1fr`) to make the hidden
  cards themselves show an edge — a length and a flex fraction are different
  types and CSS will not interpolate between them, so it snaps. That is why the
  deck's depth is two decorative strips behind the front card that fade as the
  real ones unfold, and why they use ordinary `z-0`/`z-10` and never a negative
  z-index: `main` paints the pistachio gradient, and anything behind the local
  stacking order would be behind that too. A folded card carries `inert` —
  clipped to nothing is not the same as gone, and without it the link inside
  keeps its place in the tab order.
- **A merchant tile is initials with the mark laid over them, and the route
  decides which one shows.** `MerchantAvatar` is a server component and must
  stay one, so it cannot react to a failed load — instead the monogram is the
  ground and the `<img>` is painted on top, and `MERCHANT_MARK_SCRIPT` (one
  capturing `error` listener, rendered once by the layout) hides a mark that
  404s. It sets `hidden` rather than removing the element, because a missing
  element is a hydration mismatch React resolves by rebuilding the tree. The
  avatar asks for a mark for **every** merchant: whether one exists is not a
  fact `lib/merchant-brands.ts` holds — a mapped domain can have no favicon, a
  guess can miss, and an account can name its own domain on `/account` — so the
  route answers it and a 404 costs the initials nothing.
- **Reserve chart height in `app/loading.tsx`.** A canvas sizes itself from its
  container and cannot reserve its own space, so the skeleton has to carry the
  same pixel heights the components do.
- **The signed-in app has one section idiom, and `.card` is not it.**
  `components/section.tsx` is a big heading on the page's own ground (26px,
  30px from `sm`) over a `rounded-lg bg-surface-muted` panel — the same shape
  the ledger's month groups use, so the page reads as one design rather than
  cards stacked on panels. Every block above the ledger goes through it; the
  summary tiles are the same grey panel without a heading of their own, because
  the page `h1` heads them. **`/anomalies`, `/budget` and `/account` run on it
  too**, and their `h1` matches the dashboard's 30/36px — the budget and account
  pages used to head themselves at 22px, which is smaller than the sections
  underneath them. `.card` is left on the auth forms and the error pages. Two
  consequences worth knowing: the section headings are
  deliberately **not** sticky (the month headings are, at `top-16`, and a second
  sticky layer at the same offset collides with them), and the `pt-6` on each
  heading is what spaces sections apart, so the page stacks them with no
  `space-y` of its own.
- **A `Section` is presentational, so a client component may render it.**
  `monthly-trend.tsx`, `top-category-bars.tsx` and `budget-editor.tsx` all do.
  It has no `server-only` import and is not async; what it costs is a small
  presentational component in the client bundle, not a boundary violation.
- **Moving a block onto the grey panel means re-checking everything filled with
  its own ground.** The budget page's conversion needed four: rows divided by
  `divide-surface` rather than `border-line` (white lines, like the ledger's),
  strip rules as `border-t border-surface`, secondary buttons given `bg-surface`
  with a `hover:bg-surface-hover` (hovering to `surface-muted` on a
  `surface-muted` panel does nothing visible), and the radar's axis-tick plate
  moved from `tokens.surface` to `tokens.surfaceMuted` — a white chip behind
  every tick, where it had been a hole in the rings. The `bg-surface-muted/40`
  header and footer strips those blocks wore went away entirely: they existed to
  separate themselves from a white card, and there is no white card any more.
- **`/account` is four groups of rows, not six cards.**
  `components/settings-row.tsx` is the row — label and note on the left, the
  control on the right, an optional `detail` spanning underneath it — and
  `SETTINGS_GROUP` is the panel class that divides them, `divide-surface` per
  the rule above. The control components render *rows*; the heading and the
  panel come from `Section` on the page, which is why `install-app.tsx` and
  `anomaly-scan-controls.tsx` no longer draw a box or a header strip. The
  grouping answers **what a setting reaches**: Profile (the account itself),
  Preferences (this browser — theme, language, install), Data (the scan and the
  two importers), Danger zone. Two things not to undo: nothing inside a group
  gets a panel of its own — the generator's controls used to be three grounds
  deep on one control — and the `#anomaly-scan` anchor `/anomalies` links to
  twice lives on the Data group, so the link lands on a heading rather than
  mid-panel.
- **The header's tab group is the app's top-level pages; the right-hand pill
  cluster is account chrome.** `HeaderNav` carries Dashboard, Budget and
  Auffälligkeiten — the last moved out of the pill cluster, where it read as a
  setting rather than a page and could not show as current. Its tab keeps the
  pill's icon and the pill's habit of hiding its label below `sm`: three text
  tabs plus the account cluster do not fit on a 375px phone. `/` has to match
  the path exactly (it prefixes everything otherwise); the others own their
  subtrees, so `/anomalies/AMOUNT_SPIKE` still lights the Auffälligkeiten tab.
- **On a grey panel, a chart's separators are `--surface-muted`, and a bar
  track is `--surface`.** `useChartTokens()` exposes both. Anything filled with
  its own ground disappears — that is why the donut's wedge borders moved off
  `--surface` and the merchant bars' tracks moved onto it. (The chat once had
  its own pie on `--surface`; the assistant no longer draws, so the dashboard
  charts are the rule's only consumers.)
- **Never animate the page shell in.** Motion applies `initial` styles during
  SSR, so an entrance animation on a container ships it at `opacity: 0` and the
  page stays blank until hydration — or forever, if JS fails. `animate-pulse` in
  `app/loading.tsx` is fine: it animates between visible states.
- `app/loading.tsx` mirrors the dashboard's footprint, chart height included, so
  a filter change does not make the page jump.

## Seed data

- `npm run seed` reads every `.csv` in `SEED_DIR` (default
  `scripts/seed-data/`) and imports it into the **demo account**, creating that
  account if it is missing. Both halves are idempotent — the account is matched
  by email, the rows are replaced — so a manual re-run is a no-op.
- **Four statements ship, from three real formats, all committed normalized.**
  The `jeanine_2025_*` pair is the original synthetic export. The 2026 files
  are real bank shapes converted offline — `Account2` a ZKB Kontoauszug
  (semicolon-separated, German headers, `DD.MM.YYYY` dates), `Account4` a
  Revolut statement (comma CSV, `Started`/`Completed` timestamps, a `Fee`
  column, `REVERTED` rows) — because the importer reads exactly one shape and
  a raw bank export dropped into `seed-data/` unconverted parses as garbage.
  Decisions baked into the converted rows rather than the code: `REVERTED`
  lines are dropped (they never settled), Card Refunds are typed `income` so
  the Refund rule catches them, Revolut's "Metal plan fee" (amount 0, fee 180)
  is a CHF 180 `Revolut` fee line, the ATM line is `Cash withdrawal` → Other,
  and TWINT lines naming a private person (name and phone number) were
  sanitized to "Belastung TWINT: Privatzahlung" before committing.
- **A `naturalKey` collision is disambiguated in the data, not the code.** Two
  identical Swiss tickets bought together — same day, merchant and amount —
  are one key, and the dedupe would eat the second; it ships with " (2)"
  appended to its name. Do the same in any future conversion.
- **Salary, rent and Google One land every month of the covered range.** The
  2026 statements only carried May–July paydays and rents and a Jan–Apr
  Google One run, so the missing months were added by hand on the same
  patterns: salary (CHF 5'617.70) and Miete (CHF 3'000) together on the
  payday, 22nd–25th and a weekday — in the real months the rent leaves the
  account the day the salary arrives — and Google One (CHF 3) on the 23rd.
  Keep the every-month invariant if the range grows — the balance line, the
  income tiles and the recurring-payment rules are read for it.
- **The opening balance is CHF 20'000** — `OPENING_BALANCE_MINOR` in
  `scripts/lib/statement.ts`, shared by both importers and pinned by
  `tests/demo-data.test.ts`. Change it there and nowhere else.
- **The `/account` demo-data button imports the same directory.**
  `lib/demo-loader.ts` discovers `scripts/seed-data/*.csv` exactly like
  `scripts/seed.ts` does — it used to hardcode the two 2025 files and
  silently skipped every statement added later, while `npm run seed`
  imported them fine. `tests/demo-data.test.ts` pins its row count to the
  script's, which is the drift alarm.
- **`npm run start` seeds only an empty database.** It passes `--if-empty`,
  which exits early when the `transactions` table holds any row, so a fresh
  volume comes up populated with no manual step and every later boot leaves the
  data alone. Before that flag the seed ran on *every* boot and its scoped
  delete-then-insert silently wiped anything the demo account had generated from
  `/account`. The check is on table contents, not on `data/` existing —
  `db:push` runs first in `start` and creates the directory and the file, so the
  folder is never missing by the time the seed looks.
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
  once per side; without the dedupe those 12 lines count twice. 950 raw lines →
  938 rows. `transactions.externalId` stores the key, unique per user.
- **`MERCHANTS` in `scripts/lib/statement.ts` is the single source of both the
  category and the canonical merchant name.** The exports spell the same
  merchant several ways; grouping on the raw label silently splits the ranking.
  Add new merchants there, not at read time — categories are assigned once, at
  import. An explicit entry is allowed to classify to `Other` — TWINT
  person-to-person payments, a cash withdrawal, a barber: no spending category
  would be honest. Both the seed's unmapped warning and
  `tests/seed-rules.test.ts` check `slug in MERCHANTS` first, so only a
  *keyword fallback* landing on `Other` reads as a mapping gap. And every
  canonical name added here needs an entry in `MERCHANT_BRANDS`
  (`lib/merchant-brands.ts`) — a real domain or a deliberate `null` —
  because `tests/merchant-brands.test.ts` asserts coverage; that is what
  keeps "no logo exists" distinguishable from "someone forgot".
- **A refund is not income.** 39 of the 60 lines typed `income` are merchant
  credits. They get the `Refund` category and their own tile; folding them into
  salary overstates the earnings by CHF 7,038.
- **`CATEGORIES` includes `Gaming`, and adding a category is cheap.** The
  Revolut statement's Steam / Nintendo / Google Play tail is ~40 rows;
  filing it under "Subscriptions" would have been dishonest. The const is
  consumed as a type, as a validation set in `tests/demo-data.test.ts`, and
  as the assistant's fixed-expense name-set — an additive entry breaks
  nothing, and category strings render raw in the UI.
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

## Uploaded statements

The third way rows enter an account, and the only one a person can reach:
`/account` → Data → Import your own CSV.

- **The uploader appends; the other two importers replace.** `lib/csv-upload.ts`
  never deletes, so no `transactions.id` is reissued and it must **not** call
  `rebindAnomalies` — every stored finding stays bound to the row it describes.
  (The three callers of that function are still `scripts/seed.ts`,
  `lib/demo-loader.ts` and `lib/synthetic-generator.ts`, and all three
  delete-then-insert.) The new rows do change the account's fingerprint, which
  is how `getAnomalyScanState` already reports the scan as outdated.
- **Dedupe is the unique `(user_id, external_id)` index**, via
  `onConflictDoNothing().returning()` — the row count that comes back is what
  separates "imported" from "already there". Re-uploading an overlapping month
  is a normal thing to do and reads as a no-op, not an error.
- **The natural key carries an occurrence suffix** (`…|amount|text#2`) for a
  line repeated inside *one* file. Two identical charges on one day are real —
  the shipped Revolut export has a pair, disambiguated by hand with `" (2)"` —
  and without the suffix the dedupe eats the second one.
- **`lib/csv-import.ts` is pure and client-safe, and that is load-bearing.**
  The dialog runs it in the browser to sniff the delimiter, detect the columns
  and draw the preview — so nothing leaves the device until someone presses
  import — and the action runs the same module server-side on the same file, so
  the preview cannot disagree with the ledger. Keep `@/db`, `server-only` and
  drizzle out of it, the same way `lib/insights.ts` does, and keep it free of
  `new Date()`: a booking date is a calendar day.
- **A line that cannot be read is counted, never dropped.** `normalizeRows`
  returns `skipped` with a line number and a reason, the dialog prints them,
  and the toast repeats the count. "312 imported" over a file of 400 is a
  silent lie about someone's money.
- **Ambiguous dates are read day-first** (`01/02/2026` is 1 February), because
  every bank shipping into this app writes the day first and a reader has to
  pick one. Guessing per row would put half a statement in the wrong month.
- **`classifyFreeText` in `scripts/lib/statement.ts` is the free-text sibling of
  `classify`**, not a replacement: it strips the bank's ceremony (`EINKAUF ZKB
  VISA DEBIT …`), tries the slug table, then looks for a canonical `MERCHANTS`
  name inside what is left, then falls through to `classify`'s keyword rules.
  Names under four characters (BP, Eni, CRO, UPS) must match the *whole* label
  — contained, they fire on any label that happens to spell them. `KEYWORDS`
  stays untouched: it is read by `scripts/seed.ts` too, so an entry added there
  moves the shipped statements and `tests/seed-rules.test.ts` with them, which
  is why the salary hint lives in `lib/csv-upload.ts` instead.
- **`serverActions.bodySizeLimit` in `next.config.ts` exists for this feature.**
  A Server Action body is capped at 1 MB by default and the uploader posts the
  file; the app's own cap is `MAX_CSV_BYTES` (2 MB), checked in the browser and
  again in the action, so the limit someone hits comes with a sentence rather
  than as a framework 413.

## Anomaly detection

- **The engine never runs during a render.** It used to, over the account's
  whole history, on every dashboard load — at 25k transactions that was minutes
  of blocking CPU and took the server down with it. A scan is now triggered
  explicitly from `/account`, writes to the `anomalies` table, and the dashboard
  only reads rows back for the transaction ids on the page.
- `app/actions/anomalies.ts` owns the scan. `startAnomalyScan` inserts an
  `anomaly_runs` row and returns immediately; the work continues as a floating
  promise and the browser polls `getAnomalyScanStatus`. Progress lives in the
  database precisely because the request that started it has already returned.
- **`getStoredAnomaliesForPage` resolves the account from the session, never
  from an argument.** Every export of a `"use server"` module is an endpoint the
  browser can call with arguments it chooses, so a `userId` parameter there
  would be an open door onto any account's findings. Keep that shape for any
  new action.
- The scan yields to the event loop (`setImmediate`) around the analysis and
  between insert batches. Without that, the poll that draws the progress bar
  cannot be served while the work it reports on is running.
- Results are **replaced wholesale** per account on each scan, so re-running is
  idempotent. `anomalies.transactionId` is deliberately **not** a foreign key —
  a scan is a snapshot, and a cascade would silently empty the table when
  statements are re-imported.
- **Anything that delete-then-inserts transactions must call
  `rebindAnomalies`** (`lib/anomaly-sync.ts`) straight afterwards, inside the
  same write transaction. `transactions.id` is `AUTOINCREMENT`, so a re-import
  hands every statement line a new id and leaves every stored finding pointing
  at nothing — and `npm run start` is `db:push && seed && next start`, so this
  used to void a scan on **every single deploy**. That is why people kept being
  asked to re-run the detection. The three callers are `scripts/seed.ts`,
  `lib/demo-loader.ts` and `lib/synthetic-generator.ts`. Re-binding is by
  `external_id`; a finding whose key no longer resolves is deleted, because it
  describes a line that no longer exists and would otherwise keep the account
  looking permanently out of date.
- **`lib/anomaly-sync.ts` has no `server-only` and no `@/db` import, and its
  schema import is relative.** `scripts/seed.ts` runs under plain tsx outside
  Next's resolver — the same constraint `lib/password.ts` documents. It takes
  the caller's handle rather than reaching for one.
- **"Outdated" is a content comparison, never a timestamp one.** `runScan`
  stamps `anomaly_runs.transactionFingerprint` — a sorted hash of the account's
  `external_id`s — and `getAnomalyScanState` compares it against the current
  set. Timestamps cannot work here: the importers reset `transactions.createdAt`
  and the ids on every re-seed, so anything derived from them reported a
  perfectly good scan as stale after an import that changed nothing. A NULL fingerprint reads as
  *unknown*, not outdated, so scans predating the column do not start nagging.
  The sort inside `fingerprintOf` is load-bearing — the read has no `ORDER BY`.
- **`resolved_at` is the one thing a scan carries across its own delete.** The
  findings are the scan's to replace; the work someone did ticking them off is
  not. `runScan` reads the resolutions before the delete and re-stamps them on
  the way back in — see `priorResolutions`.
- **A resolution is keyed on `(rule_id, external_id)`, never on
  `transaction_id`.** `scripts/seed.ts` and `lib/demo-loader.ts` both
  delete-then-insert, so ids are reissued on every re-import; matching on them
  would quietly wipe the user's progress each time. (`npm run start` used to
  force that on every boot. It no longer does — see `--if-empty` under Seed data
  — but a manual `npm run seed` and every demo-data load still do.) That is what
  `anomalies.transactionExternalId` is for, and why `setAnomalyResolved`
  backfills it for rows that predate the column. `tests/anomalies.test.ts`
  re-imports the statements mid-test and asserts the resolutions still land.
- **Resolution is per (finding, transaction) — the grain of the table.**
  Ticking a row off under one rule leaves another rule's finding on the same row
  open, because they are different claims. A transaction therefore counts as
  resolved for a rule only when *every* row of that rule pointing at it is; both
  `getAnomalyOverview` and `getAnomalyRuleDetail` compute it that way, and a
  cheaper "any row resolved" would let a heading claim more than the rows under
  it.
- **`NEW_MERCHANT` fires only on significant amounts.** A first-time merchant
  is reported when the charge is at or above the 75th percentile of the
  account's non-recurring expenses; below that the merchant is still marked
  *seen*, so a later, larger charge does not re-fire either. Ungated, the
  Revolut statement alone produced 136 first-time-merchant findings — one per
  CHF 15 lunch — and drowned the ledger. The readability contract this serves
  lives in `tests/anomaly-seed-data.test.ts`: 20–200 findings, under a
  quarter of rows flagged, and still nothing escalatable to red.
- **The engine is performance-sensitive and easy to regress.** Two things keep
  it near-linear, and both look like harmless cleanups:
  - `parseTransactionDate` memoises on the transaction object. Several rules
    compare every transaction with every other, so it is called O(n²) times;
    un-memoised it was ~75% of total runtime.
  - `AMOUNT_SPIKE` caches median/MAD **per baseline group**, not per
    transaction. The baseline is the merchant's or category's whole history, so
    it is identical for every transaction in that group; computing it inside
    the loop made the rule O(n · g log g) and was the single largest cost.
  - `BALANCE_DROP` uses a two-cursor sliding window. Its `right` cursor must
    cover every transaction sharing the current timestamp — date-only rows all
    land on the same instant, and stopping at `i` would silently shrink the
    window.
  Together these took 25k transactions from ~10 minutes to under a second. If
  you touch the engine, re-check it against a large synthetic account.

### Two axes, not one

- **`severity` and `kind` answer different questions, and neither is a rename of
  the other.** `severity` (`low`/`medium`/`high`) is statistical magnitude — how
  far from its own baseline a number sits. `kind` (`info`/`warning`/`alert`) is
  how much a person should worry. A CHF 6'000 bike is `high` severity and only a
  `warning`: nobody needs alarming about their own purchase. The ledger colours
  by kind and ranks by kind-then-severity.
- **`kind` starts as a coarsening of `severity`** — `derivedKind` maps `low` to
  `info` and everything else to `warning`, stamped in the same final `.map()`
  that stamps `emoji`, so the 26 rules never spell it out. That coarsening is
  what keeps the two orderings from contradicting each other, which is what makes
  the ledger's sort safe. **Escalation is one-way**: the narrative layer may raise
  a kind, never lower it.
- **`alert` is red, means "this may not have been you", and needs two keys.** The
  LLM proposes it; `canEscalateToAlert` in the engine has to co-sign with a
  numeric predicate on metrics the rules already compute. Nothing deterministic
  ever emits `alert` — `tests/anomaly-seed-data.test.ts` asserts that, and that no
  finding in the shipped year is escalatable at all. The allowlist is four rules
  (`REPEAT_CHARGE`, `LARGE_TRANSFER`, `NEW_COUNTERPARTY`, `CASH_WITHDRAWAL_SPIKE`);
  everything else was left out because its modal case is a legitimate purchase.
  **Do not widen it without a co-signature** — the cost of a false red is a person
  phoning their bank about their own holiday booking, which is exactly what the
  `merchant_repeat_days <= 1` clause keeps the seed data's airline charges out of.
- **Card testing is out of reach**, and copy must not claim it: `REPEAT_CHARGE`
  skips anything under CHF 20, which is precisely what a probe charge is.
- **Only a crowded row is worth a request — unless an alert is possible.**
  `selectCrowdedFindings` asks the model about a finding only when one of its
  transactions carries three or more (`CROWDED_ROW`), which is where the row
  starts hiding badges behind "+N more" and a person stops being able to read it
  unaided. On the shipped ledger that is a handful of rows rather than all
  ~180. `selectForNarration` then adds back anything `canEscalateToAlert` already
  co-signs: `alert` can only be *proposed* by the model, so a finding the cost
  rule skips can never turn red — and the motivating case, a large transfer to a
  first-time recipient, is two findings on one row and so never crowded. Keep the
  two selections separate; folding the alert exemption into the crowding rule
  makes a cost heuristic silently load-bearing for a safety one.
- **The narrative layer batches, and the round trip is keyed on synthetic ids.**
  `lib/llm/analyze-insights.ts` sends ten findings per request, minified, and
  composes each batch's reply as a **union** — narratives plus every candidate no
  narrative cited. Both halves are load-bearing and both were once bugs: keying
  the round trip on `rule_id` pooled every `AMOUNT_SPIKE` in the ledger into one
  finding, and returning only what the model referenced silently deleted the rest.
  A batch that fails falls back on its own; the others are unaffected.
- **The model cannot name a merchant on its own.** The highest-cardinality rules
  put no merchant, category or month in `supporting_metrics`, and their
  descriptions do not name one either. `runScan` passes a `contextOf` lookup built
  from the rows it already holds. Never send `Transaction.description` — on a real
  statement that is a payment reference.

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
  `--brand` carries the landing's CTA band, the `warning` anomaly badges and
  the assistant's tile. It is *not* the logo tile any more: the mark is the
  multicolour dragon, and Supernova swallowed its whole yellow half. Never set
  type in either. (On the dark ground both clear AA, which is why `--positive` is
  Pistachio itself there rather than the darkened step.)
- **A Pistachio fill needs `--pistachio-edge` as a stroke.** At 2:1 the fill
  alone does not make a shape perceptible against white; the edge brings it to
  3.4:1. The consumer today is the balance chart's positive bars — `--flow-in`
  *is* Pistachio, and as a bar it is a fill where the old trend chart used it
  as a stroke, so `useChartTokens()` exposes the edge as `flowInEdge`. Note the
  edge has to be *lighter* than the fill in `.dark`, not darker — its job is to
  separate the fill from the ground, and the ground moved.
- `--positive` (`#5F7000`) is Pistachio darkened to 5.5:1 for amounts set as
  **text**. Don't use the bright Pistachio for a figure, and don't use
  `--positive` where the brand colour should show.
- **The ledger's anomaly rows are the `*-soft` tokens' one consumer.**
  `--accent-soft`, `--brand-soft` and `--danger-soft` are the row washes for
  `info`, `warning` and `alert`; `--accent`, `--brand`+`--brand-ink` and
  `--danger` are the matching badge borders and text. The badges also carry an
  `sr-only` kind word, because hue alone would make the classification a
  colour-only distinction.
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
  `slotsOf(stack)`, computed on the whole-range ranking, and the pie and the
  stacked bars read from that one map. A list coloured by array index repaints
  its survivors every time a filter reorders it, which makes the colour a lie.
  The merchant list is the one place index colouring survives — it has no chart
  counterpart, so there is nothing for it to disagree with, and it is now
  `BreakdownList`'s only caller, which is why that component no longer takes a
  `slots` prop. `slotsOf` is still the rule for anything category-coloured.
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
- **The logo is artwork, not palette, and it lives once in `lib/signet.ts`** —
  61 flat paths in ten fills, generated from `res/logos/beyond-money-icon.svg`.
  Consumed by `components/logo.tsx` (JSX), `app/[locale]/opengraph-image.tsx`
  (as a data URI — Satori only renders SVG reliably through an `<img>`), and
  `public/icon.svg` (its own copy, being a static file).
  Three things about it are load-bearing:
  - `SIGNET_PATHS` is in **paint order**; the traced shapes overlap, so sorting
    them is a silent redraw. The hover animation's ordering lives separately in
    `SIGNET_FLAME_ORDER` — the ten fills tail-to-head — exactly so the paths
    never have to move. `tests/logo-mark.test.ts` holds both.
  - Its hexes **must not follow the theme**. That is why every consumer sets it
    on `--logo-tile`, the fixed white the merchant marks use, rather than on
    the theme's surface: a constant drawing needs a constant ground, the same
    trade `.on-brand` makes in the other direction.
  - The mark is **inline SVG, never an `<img>`**, in `components/logo.tsx`: the
    hover staggers `animation-delay` per path, which nothing outside the
    document can reach. The reduced-motion block in `app/globals.css` therefore
    flattens `animation-delay` as well as duration — without that, "no motion"
    still means ten staggered flicks.
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
- **`dialog` and `alert-dialog` are not interchangeable.** An alert dialog is
  an interruption that demands an explicit choice — right for "delete this, are
  you sure", wrong for a form, where dismissing without choosing is a normal
  thing to want. Retargeting a pot is a form, so it uses `Dialog`; deleting one
  is a confirmation, so it uses `AlertDialog`.
- **On a pot card, retarget sits left and delete sits right.** The reversible
  action and the irreversible one go as far apart as the card allows, and both
  are always visible rather than revealed on hover — a hover affordance does
  not exist on a touch screen.
- **shadcn `asChild` gotcha**: `AlertDialogAction`/`AlertDialogCancel` wrap a
  `Button`, so the Button's variant classes land on the same element and
  `cn()` cannot merge them. Overrides there need Tailwind v4's trailing
  important modifier (`bg-danger!`), not a leading `!`.

## Deployment

- Coolify on Hetzner behind Cloudflare.
- `data/` is gitignored, so a fresh container has no tables. `npm run start`
  runs `npm run db:push && npm run seed -- --if-empty && next start` for exactly
  this reason — don't reduce it back to `next start`, or the site 500s with `no
  such table`. `db:push` creates the database's parent directory first, because
  `drizzle-kit` will not.
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
