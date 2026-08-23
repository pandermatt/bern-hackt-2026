"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { merchantOverrides, transactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { merchantDomain } from "@/lib/merchant-brands";
import {
  isCategory,
  merchantOverridesFor,
  normalizeDomain,
  UNFILED,
} from "@/lib/merchant-overrides";
import { CATEGORIES } from "@/scripts/lib/statement";

/**
 * Everything the mapper needs about one merchant the importer could not place.
 *
 * `category` and `domain` are what this account has *said*, not what is being
 * shown: an empty domain with a `suggestedDomain` beside it is a merchant whose
 * mark comes from the shipped map, and the form says so as a placeholder rather
 * than by pre-filling a value nobody typed.
 */
export type UnfiledMerchant = {
  merchant: string;
  count: number;
  spentMinor: number;
  category: string;
  domain: string;
  /** What `lib/merchant-brands.ts` would resolve on its own, if anything. */
  suggestedDomain: string | null;
};

export type MerchantMapping = {
  merchants: UnfiledMerchant[];
  /** Every category the select offers, in catalog order. */
  categories: string[];
  /**
   * The category that means "leave it alone". Travels in the payload rather
   * than being imported by the form: `lib/merchant-overrides.ts` reaches for
   * `@/db`, which is `server-only`, and a client component that imported it
   * would fail the build.
   */
  unfiled: string;
};

/**
 * The merchants sitting in `Other`, with what this account has decided about
 * them.
 *
 * Grouped in SQL rather than by reading every row: this is a settings page, it
 * needs one line per merchant and no transaction detail, and the "one fetch,
 * then aggregate in JavaScript" rule is about the dashboard's *many* aggregates
 * over one scan — not about a single grouped count.
 *
 * It reads `transactions.category` as **stored**, which is the whole point:
 * a merchant that has been re-filed must stay on this list, showing the
 * category it was moved to. Reading the overridden value instead would make a
 * row vanish the moment it was saved, which reads as the save having eaten it.
 */
export async function getMerchantMapping(): Promise<MerchantMapping | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const rows = await db
    .select({
      merchant: transactions.merchant,
      count: sql<number>`count(*)`,
      // Expenses are negative, so the magnitude is what a "spent" figure means.
      spentMinor: sql<number>`abs(sum(${transactions.amountMinor}))`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, user.id),
        eq(transactions.category, UNFILED),
      ),
    )
    .groupBy(transactions.merchant);

  const overrides = await merchantOverridesFor(user.id);

  return {
    merchants: rows
      .map((row) => {
        const override = overrides.get(row.merchant);
        return {
          merchant: row.merchant,
          count: Number(row.count),
          spentMinor: Number(row.spentMinor),
          category:
            override?.category && isCategory(override.category)
              ? override.category
              : UNFILED,
          domain: override?.domain ?? "",
          suggestedDomain: merchantDomain(row.merchant),
        };
      })
      // Biggest first: the merchant worth ten francs a year is not the one
      // somebody opened this page to file.
      .sort((a, b) => b.spentMinor - a.spentMinor || a.merchant.localeCompare(b.merchant)),
    /*
     * Everything but the opening balance, which is not a place to put a
     * merchant — it is the single synthetic line each importer writes to seed
     * the running balance. `Salary`, `Refund` and `Transfer` stay on the list:
     * a mis-filed employer or a refund the rules read as a purchase is exactly
     * the kind of thing somebody comes here to correct.
     */
    categories: CATEGORIES.filter((category) => category !== "Opening balance"),
    unfiled: UNFILED,
  };
}

export type SaveMerchantOverridesResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Errors are phrased here, not in the component — the client raises whatever
 * string it gets straight into a toast, so it has to arrive translated. The
 * same shape `app/actions/budget.ts` uses.
 */
async function mappingError(
  key: string,
  values?: Record<string, string>,
): Promise<SaveMerchantOverridesResult> {
  const t = await getTranslations("MerchantMappingErrors");
  return { ok: false, error: t(key, values) };
}

const entrySchema = z.object({
  merchant: z.string().trim().min(1).max(120),
  /** `Other` means "no opinion", which deletes the row rather than storing it. */
  category: z.string().trim().max(40),
  /** Blank means "no opinion" too; anything else has to look like a domain. */
  domain: z.string().trim().max(300),
});

/**
 * Writes what the account holder decided about each merchant.
 *
 * One transaction, like `saveBudgets`, so a half-saved mapping is not a state
 * the page can land in — and the callback is synchronous because better-sqlite3
 * is a synchronous driver.
 *
 * A row is stored only when it says something. `Other` plus a blank domain is
 * the absence of an opinion, and the absence of an opinion is the absence of a
 * row: keeping one full of NULLs would leave the table growing by a row per
 * merchant somebody merely looked at, and would make "has this been decided?" a
 * question about column contents rather than about existence.
 *
 * The merchant names are not validated against the ledger. A name that matches
 * nothing simply never applies — `applyMerchantOverrides` looks rows up by
 * name — and rejecting unknown names would break the honest case where an
 * override is saved for a merchant whose last transaction has since been
 * re-imported away.
 */
export async function saveMerchantOverrides(
  entries: { merchant: string; category: string; domain: string }[],
): Promise<SaveMerchantOverridesResult> {
  const user = await getCurrentUser();
  if (!user) return mappingError("notSignedIn");

  const parsed = z.array(entrySchema).max(500).safeParse(entries);
  if (!parsed.success) return mappingError("malformed");

  const upserts: { merchant: string; category: string | null; domain: string | null }[] = [];
  const clears: string[] = [];

  for (const entry of parsed.data) {
    const category =
      entry.category === "" || entry.category === UNFILED
        ? null
        : entry.category;
    if (category !== null && !isCategory(category)) {
      return mappingError("unknownCategory", { category });
    }

    let domain: string | null = null;
    if (entry.domain !== "") {
      domain = normalizeDomain(entry.domain);
      if (domain === null) {
        return mappingError("notADomain", { domain: entry.domain });
      }
    }

    if (category === null && domain === null) {
      clears.push(entry.merchant);
      continue;
    }
    upserts.push({ merchant: entry.merchant, category, domain });
  }

  try {
    db.transaction((tx) => {
      if (clears.length > 0) {
        tx.delete(merchantOverrides)
          .where(
            and(
              eq(merchantOverrides.userId, user.id),
              inArray(merchantOverrides.merchant, clears),
            ),
          )
          .run();
      }
      for (const row of upserts) {
        tx.insert(merchantOverrides)
          .values({
            userId: user.id,
            merchant: row.merchant,
            category: row.category,
            domain: row.domain,
            updatedAt: new Date(),
          })
          // The unique index on (user_id, merchant) is what makes this an
          // upsert instead of a read-then-write race.
          .onConflictDoUpdate({
            target: [merchantOverrides.userId, merchantOverrides.merchant],
            set: {
              category: row.category,
              domain: row.domain,
              updatedAt: new Date(),
            },
          })
          .run();
      }
    });
  } catch {
    return mappingError("saveFailed");
  }

  // Every page that reads a category or draws a merchant tile. The dashboard
  // and the budget page read the overridden rows; the account page is where
  // the form itself lives and has to come back showing what was saved.
  revalidatePath("/[locale]/dashboard", "page");
  revalidatePath("/[locale]/budget", "page");
  revalidatePath("/[locale]/account", "page");
  return { ok: true };
}
