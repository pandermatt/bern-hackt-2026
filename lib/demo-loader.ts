import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions, type NewTransaction } from "@/db/schema";
import { rebindAnomalies } from "@/lib/anomaly-sync";
import { toRecords } from "@/scripts/lib/csv";
import {
  classify,
  naturalKey,
  openingBalanceRow,
  toMinor,
} from "@/scripts/lib/statement";

/**
 * Loads the official demo CSV statements for a specific user, replacing any
 * existing transactions.
 *
 * The files are discovered from `scripts/seed-data`, exactly like
 * `scripts/seed.ts` does — this used to be a hardcoded two-file list, which
 * silently left every statement added after it out of the UI's demo-data
 * button while `npm run seed` imported them fine.
 */
export async function loadDemoCsvForUser(userId: number): Promise<{ count: number }> {
  const seedDir = join(process.cwd(), "scripts", "seed-data");
  const seen = new Set<string>();
  const rows: NewTransaction[] = [];

  const files = readdirSync(seedDir)
    .filter((file) => file.endsWith(".csv"))
    .sort();

  for (const file of files) {
    const filePath = join(seedDir, file);
    const content = readFileSync(filePath, "utf8");
    for (const row of toRecords(content)) {
      const key = naturalKey(row);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const income = row.type === "income";
      const slug = income ? row.source_id : row.target_id;
      const label = income ? row.source_label : row.target_label;
      const account = income ? row.target_label : row.source_label;

      const rule = classify(slug, label);
      const magnitude = toMinor(row.base_amount || row.amount);

      rows.push({
        userId,
        externalId: key,
        bookedOn: row.transaction_date,
        kind: row.type as NewTransaction["kind"],
        amountMinor: income ? magnitude : -magnitude,
        currency: row.currency || "CHF",
        originalAmountMinor: toMinor(row.amount),
        account,
        merchant: row.type === "transfer" ? "Credit card payment" : rule.name,
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
    rows.unshift(openingBalanceRow(userId, first));
  }

  // Clear existing rows for this user and insert in batches
  db.delete(transactions).where(eq(transactions.userId, userId)).run();

  for (let i = 0; i < rows.length; i += 100) {
    db.insert(transactions).values(rows.slice(i, i + 100)).run();
  }

  /*
   * The ids just changed, so every stored finding now points at nothing.
   * Re-point the ones whose statement line came back and drop the rest --
   * without this a scan is voided by every import. Different data here means
   * nothing matches and everything is dropped, which is the honest outcome:
   * those findings describe statements that no longer exist.
   */
  rebindAnomalies(db, userId);

  return { count: rows.length };
}
