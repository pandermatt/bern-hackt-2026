import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { transactions, users, type NewTransaction } from "../db/schema";
import { rebindAnomalies } from "../lib/anomaly-sync";
import { hashPassword } from "../lib/password";
import { toRecords } from "./lib/csv";
import {
  classify,
  naturalKey,
  openingBalanceRow,
  toMinor,
} from "./lib/statement";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";
// Resolved against the working directory, like DATABASE_PATH above — npm always
// runs scripts from the package root.
const SEED_DIR = process.env.SEED_DIR ?? resolve("scripts/seed-data");

/**
 * Passed by `npm run start`, so a boot onto a volume that already holds
 * statements leaves them alone — only a fresh, empty database gets seeded. A
 * bare `npm run seed` still re-imports unconditionally, which is how you pick
 * up edited statements or a new SEED_DIR.
 *
 * The question it answers is "does the database already hold transactions",
 * not "does `data/` exist": `db:push` runs first in `start` and creates both
 * the directory and the database file, so by the time this script opens it the
 * folder is never missing. An empty database is the observable form of a fresh
 * volume.
 */
const ONLY_IF_EMPTY = process.argv.includes("--if-empty");

/**
 * The demo account. `npm run start` runs this script before serving, so a
 * fresh deploy comes up with a populated dashboard and no manual step.
 *
 * ⚠️ These credentials are in the repository, so anyone who can read the source
 * can sign into this account on any deployment that runs the seed. That is an
 * accepted tradeoff here: the statements are synthetic and the app is a
 * demo. Set SEED_PASSWORD on the host to override it, or SEED_EMAIL to attach
 * the statements to an account you registered yourself instead.
 *
 * If real data ever lands in this database, delete this block and go back to
 * seeding an account that already exists.
 */
const DEMO_EMAIL = (process.env.SEED_EMAIL ?? "jeanine@example.com").toLowerCase();
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "beyond-money-demo";
/** Only applied when this script creates the account — an existing one keeps
 * whatever name its owner set. */
const DEMO_NAME = process.env.SEED_NAME ?? "Jeanine";

/*
 * Wrapped in a main() rather than run at the top level: hashing the demo
 * account's password is async, and a top-level await makes this module async,
 * which tsx's CJS transform rejects with ERR_REQUIRE_ASYNC_MODULE.
 */
async function main() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");

  // Nested rather than hoisted to module scope so it can close over `sqlite`
  // without naming better-sqlite3's instance type.
  //
  // The table's existence is part of the question: `db:push` has always run by
  // this point under `npm run start`, but `npm run seed -- --if-empty` against a
  // database nobody pushed would otherwise throw "no such table" instead of
  // reporting the obvious answer.
  const hasTransactions = () => {
    const table = sqlite
      .prepare(
        "select 1 from sqlite_master where type = 'table' and name = 'transactions'",
      )
      .get();

    if (!table) return false;

    return sqlite.prepare("select 1 from transactions limit 1").get() !== undefined;
  };

  const db = drizzle(sqlite);

  if (ONLY_IF_EMPTY && hasTransactions()) {
    console.log(
      `${DB_PATH} already holds transactions — skipping the seed. ` +
        `Run \`npm run seed\` to re-import anyway.`,
    );
    sqlite.close();
    return;
  }

  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, DEMO_EMAIL))
    .get();

  let target = existing;

  if (!target) {
    if (process.env.SEED_EMAIL) {
      // An explicit SEED_EMAIL names an account someone registered themselves.
      // Creating it here would hand it a password they did not choose.
      console.error(
        `No account found for ${process.env.SEED_EMAIL}. Register it first, then re-run this.`,
      );
      sqlite.close();
      process.exit(1);
    }

    // Hashed with the same code path the login route verifies against — see the
    // note in lib/password.ts.
    const [created] = db
      .insert(users)
      .values({
        email: DEMO_EMAIL,
        name: DEMO_NAME,
        passwordHash: await hashPassword(DEMO_PASSWORD),
      })
      .returning()
      .all();

    target = created;
    console.log(`Created the demo account ${DEMO_EMAIL}.`);
  }

  const files = readdirSync(SEED_DIR)
    .filter((file) => file.endsWith(".csv"))
    .sort();

  if (files.length === 0) {
    console.error(`No .csv files in ${SEED_DIR}.`);
    sqlite.close();
    process.exit(1);
  }

  const seen = new Set<string>();
  const rows: NewTransaction[] = [];
  const unmapped = new Set<string>();
  let duplicates = 0;

  for (const file of files) {
    for (const row of toRecords(readFileSync(join(SEED_DIR, file), "utf8"))) {
      const key = naturalKey(row);
      // The credit-card payments appear in both exports, once per side.
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);

      const income = row.type === "income";
      // Direction is not in the amount — it comes from `type` plus which side the
      // account sits on. For an expense the account is the source and the
      // merchant the target; for income it is the other way round.
      const slug = income ? row.source_id : row.target_id;
      const label = income ? row.source_label : row.target_label;
      const account = income ? row.target_label : row.source_label;

      const rule = classify(slug, label);
      // Transfers are labelled by the account they land in, not a merchant, and
      // are overridden to "Transfer" below — they are not a mapping gap.
      if (row.type !== "transfer" && rule.category === "Other") {
        unmapped.add(`${slug} (${label})`);
      }

      const magnitude = toMinor(row.base_amount || row.amount);

      rows.push({
        userId: target.id,
        externalId: key,
        bookedOn: row.transaction_date,
        kind: row.type as NewTransaction["kind"],
        // Income is the only inflow; expenses and transfers both leave an account.
        amountMinor: income ? magnitude : -magnitude,
        currency: row.currency || "CHF",
        originalAmountMinor: toMinor(row.amount),
        account,
        merchant: row.type === "transfer" ? "Credit card payment" : rule.name,
        // A refund from a shop is not income. 35 of the 48 "income" lines are
        // merchant credits; folding them into Salary would overstate earnings by
        // CHF 4,590.13 and make the salary figure meaningless.
        category:
          row.type === "transfer"
            ? "Transfer"
            : income && rule.category !== "Salary"
              ? "Refund"
              : rule.category,
        description: row.name,
        createdAt: new Date(),
      });
    }
  }

  // The opening balance, dated the day before the earliest statement line —
  // see the note on `openingBalanceRow`.
  if (rows.length > 0) {
    const first = rows.reduce(
      (min, row) => (row.bookedOn < min ? row.bookedOn : min),
      rows[0].bookedOn,
    );
    rows.unshift(openingBalanceRow(target.id, first));
  }

  // Delete-then-insert, scoped to this account — what makes `npm run seed` safe
  // to re-run against a database that already holds these statements.
  const write = sqlite.transaction(() => {
    db.delete(transactions).where(eq(transactions.userId, target.id)).run();
    // Chunked: one 513-row statement binds ~6,000 parameters, close enough to
    // SQLITE_MAX_VARIABLE_NUMBER to be a build flag away from failing.
    for (let i = 0; i < rows.length; i += 100) {
      db.insert(transactions).values(rows.slice(i, i + 100)).run();
    }
    /*
     * The delete-then-insert above reissues every id, so the account's stored
     * anomaly findings now point at rows that no longer exist. Re-point them by
     * the natural key they carry -- without it a re-seed of the very same
     * statements voids the last scan and the detection has to be re-run.
     *
     * `npm run start` no longer reaches this on a boot with data (it passes
     * --if-empty), so the case this now covers is a manual `npm run seed`.
     */
    rebindAnomalies(db, target.id);
  });
  write();

  if (unmapped.size > 0) {
    console.warn(
      `Uncategorised merchants fell back to "Other":\n  ${[...unmapped].join("\n  ")}`,
    );
  }

  console.log(
    `Imported ${rows.length} transactions from ${files.length} statements ` +
      `(${duplicates} duplicate transfer lines skipped) for ${target.email} in ${DB_PATH}`,
  );

  sqlite.close();
}

main();
