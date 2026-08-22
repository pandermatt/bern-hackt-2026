<img width="1200" height="702" alt="file-1843745a13bb821b30b75334dfc7eae5" src="https://github.com/user-attachments/assets/46ada97a-e7b6-4f5a-bf7d-5f9ac42d6920" /># Beyond Money

A personal-finance dashboard built on bank statement exports: email/password
accounts, and each account sees only its own transactions. A year of statements
becomes income and spending per month, a category breakdown, a merchant
ranking, and a filterable ledger.

Built for **BärnHäckt 2026** on the PostFinance challenge.

Next.js 16 · shadcn/ui · Tailwind v4

## Deployments

| Branch | URL |
| --- | --- |
| `development` | <https://dev.beyond-money.ch/> |
| `main` | <https://beyond-money.ch/> |

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
`scripts/seed-data/` into it.

| | |
| --- | --- |
| Email | `jeanine@example.com` — override with `SEED_EMAIL` |
| Password | `beyond-money-demo` — override with `SEED_PASSWORD` |


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

## Environment

Copy `.env.example` to `.env`. Fill in the values, see [.env.example](.env.example).
