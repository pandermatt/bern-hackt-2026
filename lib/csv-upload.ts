import { db } from "@/db";
import { transactions, type NewTransaction } from "@/db/schema";
import { analyzeCsv, type CsvMapping, type ParsedRow } from "@/lib/csv-import";
import { classifyFreeText, type Category } from "@/scripts/lib/statement";

/**
 * The third way rows enter an account: a statement somebody uploaded.
 *
 * Unlike `lib/demo-loader.ts` and `lib/synthetic-generator.ts`, which both
 * delete the account's transactions and re-insert a whole world, this one
 * **appends**. Two consequences the next person should not undo:
 *
 * - **No `rebindAnomalies` call.** Nothing is deleted, so no
 *   `transactions.id` is reissued and every stored finding stays pointing at
 *   the row it describes. Re-binding here would be a no-op at best. The new
 *   rows do change the account's fingerprint, which is exactly how
 *   `getAnomalyScanState` already reports the scan as outdated.
 * - **Dedupe is the unique `(user_id, external_id)` index**, not a read-then-
 *   write. Uploading the same file twice imports nothing the second time and
 *   says so, which is the behaviour someone re-exporting an overlapping month
 *   needs.
 */
export type ImportResult = {
  /** Rows written. */
  imported: number;
  /** Rows the account already had, matched on the natural key. */
  duplicates: number;
  /** Lines that could not be read at all — see `normalizeRows`. */
  skipped: number;
  /** Data lines in the file. */
  total: number;
};

export type ImportOptions = {
  text: string;
  mapping: CsvMapping;
  /** What the ledger calls this account. Defaults to the file's own name. */
  accountLabel: string;
};

/**
 * A credit that is pay rather than a refund. Kept here rather than in
 * `KEYWORDS`, which `scripts/seed.ts` also reads: a keyword added there moves
 * the shipped statements and `tests/seed-rules.test.ts` with them.
 */
const SALARY = /(lohn|sal[äa]r|gehalt|salary|payroll|pension|rente)/i;

export function importUploadedCsv(
  userId: number,
  { text, mapping, accountLabel }: ImportOptions,
): ImportResult {
  const { rows, skipped, total } = analyzeCsv(text, mapping);
  const account = accountLabel.trim().slice(0, 60) || "Imported";

  // Two identical charges on one day at one merchant are a real thing — the
  // shipped Revolut export has a pair, disambiguated by hand with " (2)".
  // Here the occurrence number goes in the key instead, so both survive and
  // re-uploading the same file still matches them one for one.
  const seen = new Map<string, number>();
  const values: NewTransaction[] = rows.map((row) => {
    const record = toTransaction(userId, row, account);
    const occurrence = (seen.get(record.externalId) ?? 0) + 1;
    seen.set(record.externalId, occurrence);
    return occurrence === 1
      ? record
      : { ...record, externalId: `${record.externalId}#${occurrence}` };
  });

  let imported = 0;

  // One transaction around the whole file: a half-imported statement is not a
  // state the dashboard should ever render. The callback is synchronous
  // because better-sqlite3 is a synchronous driver — an async one silently
  // breaks the transaction.
  db.transaction((tx) => {
    for (let i = 0; i < values.length; i += 100) {
      const written = tx
        .insert(transactions)
        .values(values.slice(i, i + 100))
        .onConflictDoNothing()
        .returning({ id: transactions.id })
        .all();
      imported += written.length;
    }
  });

  return {
    imported,
    duplicates: values.length - imported,
    skipped: skipped.length,
    total,
  };
}

/** One normalized statement line as a row of `transactions`. */
function toTransaction(
  userId: number,
  row: ParsedRow,
  account: string,
): NewTransaction {
  const income = row.amountMinor > 0;
  const label = row.description || "Unknown";
  const rule = classifyFreeText(label);

  return {
    userId,
    externalId: [
      row.bookedOn,
      income ? "income" : "expense",
      account,
      rule.name,
      row.amountMinor,
      row.description,
    ].join("|"),
    bookedOn: row.bookedOn,
    // An uploaded file is one side of the story, so nothing here is a
    // `transfer`: that kind exists for a payment recorded in both of the demo
    // account's exports, and this importer never sees the other side.
    kind: income ? "income" : "expense",
    amountMinor: row.amountMinor,
    currency: row.currency,
    // The charged figure, unsigned. No FX rate is invented — if the line was
    // in EUR it stays an EUR figure until a real rate is applied.
    originalAmountMinor: Math.abs(row.amountMinor),
    account,
    merchant: rule.name,
    category: categoryOf(income, label, rule.category),
    description: row.description,
    createdAt: new Date(),
  };
}

/**
 * The income rule `lib/demo-loader.ts` already uses: a credit that is not pay
 * is a refund, not earnings. Folding merchant credits into salary overstates
 * what an account earns, and the dashboard has a tile for each.
 */
function categoryOf(income: boolean, label: string, category: Category): Category {
  if (!income) return category;
  if (category === "Salary" || SALARY.test(label)) return "Salary";
  return "Refund";
}
