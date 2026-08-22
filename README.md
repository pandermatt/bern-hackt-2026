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

## Deployments

| Branch | URL |
| --- | --- |
| `development` | <https://dev.beyond-money.ch/> |
| `main` | <https://beyond-money.ch/> |

`development` is the integration branch — merge there first, and only promote to
`main` once it looks right on the dev deployment.

## Setup

The SQLite file lives at `./data/app.db` and is **not** committed, so a fresh
clone needs the schema pushed before the app will run:

```bash
npm install
npm run db:push   # creates ./data/app.db and its tables
npm run dev
```

Then open <http://localhost:3000> and create an account at `/register`.

Once an account exists, load the statements:

```bash
npm run seed
```

`seed` creates the **demo account** if it is missing and imports every `.csv` in
`scripts/seed-data/` into it. It is safe to re-run: the account is matched by
email and rows are keyed by statement line, so a second import replaces rather
than duplicates. Expect `Imported 513 transactions from 2 statements (12
duplicate transfer lines skipped)`.

| | |
| --- | --- |
| Email | `jeanine@example.com` — override with `SEED_EMAIL` |
| Password | `beyond-money-demo` — override with `SEED_PASSWORD` |

> ⚠️ **The demo password is in the repository.** Anyone who can read the source
> can sign into that account on any deployment. That is a deliberate tradeoff:
> the statements are synthetic and this is a demo. Set `SEED_PASSWORD` on the
> host to change it.

> `better-sqlite3` compiles a native binding on install. Under npm 11 the
> install script is gated — if it was skipped, run
> `npm install-scripts approve better-sqlite3` and reinstall.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Pushes the schema, seeds the demo account **if the database is empty**, then serves the production build |
| `npm run db:push` | Apply `db/schema.ts` to the database (`drizzle-kit push`) |
| `npm run db:studio` | Drizzle Studio against the same file |
| `npm run db:backup` | Snapshot the database into `data/backups/` (`VACUUM INTO`) |
| `npm run seed` | Import `scripts/seed-data/*.csv` into an existing account. `-- --if-empty` skips when the database already holds transactions |
| `npm test` | Vitest: CSV parsing, aggregation, import rules, auth, and per-account scoping |

Schema changes go through `npm run db:push`. There is no migrations folder and
none should be added.

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
