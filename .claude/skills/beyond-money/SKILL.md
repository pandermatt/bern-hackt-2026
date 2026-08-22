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
- **`budgets`, `savings_goals` and `savings_allocations` are the writable
  tables.** `transactions` is read-only in the
  UI; budget limits are not. Its `userId` is **NOT NULL**, unlike
  `transactions.userId` — that column is nullable because it was added to a
  populated table and `drizzle-kit push` deploys without `--force`, whereas
  `budgets` is created empty, so the constraint costs nothing. The unique index
  on `(user_id, category)` is what makes saving an upsert rather than a
  read-then-write race. The two savings tables are created empty for the same
  reason and follow the same shape.
- **An allocation is keyed by `(goal_id, month)`, not appended as a log.** The
  page's question is "how much of March have I already put away", and with a
  log that answer changes meaning the moment someone revises an allocation.
  One row per goal per month makes revising an upsert and keeps the month's
  remaining balance a subtraction rather than a reconciliation.
- **`updateSavingsGoal` changes the target and nothing else.** The name picks
  the pot's glyph, and there is no icon column to override that with, so
  renaming would silently repaint the card. Delete and re-add is the honest way
  to change what a goal *is*. A target below what is already saved is allowed —
  the pot reads over 100%, which is true; money is never discarded to make a
  number fit.
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
- Registration is **open** — anyone who can reach the site can create an
  account.
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
- **Mutations use the `{ ok }` envelope; reads return data directly.**
  `saveBudgets` and the three actions in `app/actions/savings.ts` are the app's
  only mutations — that envelope is what the client raises a `sonner` toast
  off. Each runs its deletes and upserts inside one `db.transaction`, so a
  half-saved budget or a half-allocated month is not a state the page can land
  in.
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
- **Goal glyphs are Font Awesome Free, deep-imported.**
  `@fortawesome/free-solid-svg-icons/faCar`, never the barrel — the barrel is
  ~2000 definitions, the same reasoning as `echarts/charts`. `lib/goal-icon.ts`
  guesses from the goal's name in German and English; there is no icon column,
  because a picker is a second field to fill in for something the name already
  says. **Free has no palm tree** (`fa-tree-palm` is Pro), so holidays get
  `fa-umbrella-beach`.
- **A glyph's box is not always square** — `fa-laptop` is 640×512 — so fit on
  `max(width, height)` rather than assuming 512. A `clipPath` resolves in the
  user space of the element that references it, so the clip must sit on an
  **untransformed** group or the waterline scales with the glyph.
- **The glyph is drawn twice, clipped at the waterline: `--accent` above,
  `--chart-ink` below.** It sits on the wall, so the level rises past it as the
  goal fills, and it has to stay legible on whichever of the ten hues it ends
  up under. Don't use the accent for the submerged half — the brand colour is a
  teal and three of the fills are teals, so the glyph vanished into its own
  liquid. Ink only ever darkens (or, in `.dark`, only ever lightens) whatever
  it lands on.
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
- **The budget radar's rim is refitted per month, but capped.** The rings are
  francs on one shared scale, and the rim follows that month's own peak so a
  quiet month draws a dial it fills — bounded at `OUTLIER_CAP` × the largest
  limit. Both halves are load-bearing: a fixed rim leaves most months drawing
  a tiny shape in a big empty dial, and an uncapped one lets a single runaway
  category (CHF 8'200 against limits averaging CHF 770) push every dashed ring
  into a knot at the hub, which is the one thing the chart exists to show.
  Past the rim the spending clamps, the outer tick grows a `+`, and the real
  figure is printed under the category name, in the tooltip, and in the
  `sr-only` table. A percent-of-budget scale solves the framing outright but
  was rejected: the axis has to read in francs.
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
- **Every category name carries its share of budget underneath it.** A franc
  scale cannot separate "half the budget" from "twice it" for a small category
  near the hub, so the shape carries magnitude and the printed percentage
  carries the verdict. Neither alone is the chart; don't drop one for tidiness.
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
- **One chat body, two shells — and the state lives in the shell that never
  unmounts.** `components/chat-panel.tsx` exports `useAssistantChat()` beside
  `<ChatPanel>`; `ChatSidebar` is the slide-over and `HomeChat` is the inline
  panel on `/home`. The split is a hook plus a component rather than one
  component for a specific reason: `ChatSidebar` renders a launcher when
  closed, so it never unmounts, and holding the transcript at *its* level is
  the only thing that makes a conversation survive closing the panel. Move the
  hook call inside the `open &&` branch and every close silently discards the
  chat. `<ChatSidebar />` stays props-free, so the dashboard's mount is the
  canary: if that file needs editing, the contract moved.
- **`ChatPanel` carries `min-h-0` in its own base classes.** It is a new flex
  item between a full-height shell and a scrolling transcript, and it has no
  `overflow` of its own, so without it a long conversation resolves to
  `min-content` and pushes the input form off the bottom of the screen. The
  shell owns the height through two className seams (`className`,
  `scrollClassName`) — not a `variant` prop, which would bake each page's
  layout into the shared component.
- **The inline panel does not autofocus.** Focusing an input near the top of a
  phone page raises the keyboard on arrival and shoves away what the reader
  came for. Only the slide-over passes an `inputRef`.
- **Nothing sets type on the pistachio.** `/home` fades to `--pistachio` at the
  bottom *because* that is where the dragon is, and the bottom of that page is
  now where the nudges are too; Pistachio is 2:1 on white and is a fill, never a
  ground for words. Every string down there carries its own ground — the cards
  on `bg-surface`, and the all-clear line and the "show all" toggle on surface
  pills, for exactly this reason.
- **A Dauersparauftrag never moves money.** `savings_goals.monthly_minor` is a
  plan, not a balance: nothing reads it to create an allocation. It seeds the
  allocator's fields when a finished month has a surplus, and the reader still
  presses save. A standing order that quietly filled pots would invent savings
  out of months that never had the income — and `allocateSurplus` stays the
  only thing that writes `savings_allocations`.
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
  `components/nudge-stack.tsx` holds the deck, the toggle *and* the mascot. The
  toggle cannot sit under the deck: a trail of nubs runs from the dragon's head
  up to the bubble's bottom corner, and a pill parked in that channel breaks the
  one thing the arrangement exists to say. Hence the `speaker` prop. The trail
  is circles rather than a triangular tail because a tail would have the card's
  own 1px bottom border drawn straight across its neck, and because circles do
  not care that the bubble changes height when it unfolds. With nothing to
  report the page passes the all-clear line as the stack's only child, so a
  quiet day is the same arrangement saying one short thing rather than a second
  layout to keep in step.
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
- **Reserve chart height in `app/loading.tsx`.** A canvas sizes itself from its
  container and cannot reserve its own space, so the skeleton has to carry the
  same pixel heights the components do.
- **The signed-in app has one section idiom, and `.card` is not it.**
  `components/section.tsx` is a big heading on the page's own ground (26px,
  30px from `sm`) over a `rounded-lg bg-surface-muted` panel — the same shape
  the ledger's month groups use, so the page reads as one design rather than
  cards stacked on panels. Every block above the ledger goes through it; the
  summary tiles are the same grey panel without a heading of their own, because
  the page `h1` heads them. **`/anomalies` and `/budget` run on it too**, and
  their `h1` matches the dashboard's 30/36px — the budget page used to head
  itself at 22px, which is smaller than the sections underneath it. `.card`
  still belongs on `/account`, the auth forms and the error pages. Two
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
  `--surface` and the merchant bars' tracks moved onto it. `chat-pie.tsx` stays
  on `--surface`: it sits in the sidebar, not on a panel.
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
  statements are re-imported rather than leaving a stale result the user can see
  and re-run.
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
  unaided. On a year of real statements that is a handful of rows rather than all
  ~79. `selectForNarration` then adds back anything `canEscalateToAlert` already
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
  `--brand` is the signet tile in `components/logo.tsx`. Never set type in
  either. (On the dark ground both clear AA, which is why `--positive` is
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
