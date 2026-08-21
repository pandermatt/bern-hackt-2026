import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions, type NewTransaction } from "@/db/schema";
import { toRecords } from "@/scripts/lib/csv";
import { classify, naturalKey, toMinor } from "@/scripts/lib/statement";

const DEMO_FILES = [
  "jeanine_2025_Account1_2025.csv",
  "jeanine_2025_Account3_2025.csv",
] as const;

/**
 * Loads the official demo CSV statements (Account 1 and Account 3)
 * for a specific user, replacing any existing transactions.
 */
export async function loadDemoCsvForUser(userId: number): Promise<{ count: number }> {
  const seedDir = join(process.cwd(), "scripts", "seed-data");
  const seen = new Set<string>();
  const rows: NewTransaction[] = [];

  for (const file of DEMO_FILES) {
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

  // Clear existing rows for this user and insert in batches
  db.delete(transactions).where(eq(transactions.userId, userId)).run();

  for (let i = 0; i < rows.length; i += 100) {
    db.insert(transactions).values(rows.slice(i, i + 100)).run();
  }

  return { count: rows.length };
}
