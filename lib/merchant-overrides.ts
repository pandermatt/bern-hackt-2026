import { eq } from "drizzle-orm";

import { db } from "@/db";
import { merchantOverrides, type Transaction } from "@/db/schema";
import { CATEGORIES } from "@/scripts/lib/statement";

/**
 * The account holder's own answers about a merchant — what category its lines
 * belong to, and where its brand mark comes from — read back in the shape the
 * two consumers want.
 *
 * The table's doc comment (`db/schema.ts`) has the reasoning; this module is
 * the only thing that reads it, so that the "applied on read" rule has exactly
 * one implementation to be right about.
 */
export type MerchantOverride = {
  merchant: string;
  category: string | null;
  domain: string | null;
};

/** Everything this account has said about its merchants, by merchant name. */
export async function merchantOverridesFor(
  userId: number,
): Promise<Map<string, MerchantOverride>> {
  const rows = await db
    .select({
      merchant: merchantOverrides.merchant,
      category: merchantOverrides.category,
      domain: merchantOverrides.domain,
    })
    .from(merchantOverrides)
    .where(eq(merchantOverrides.userId, userId));

  return new Map(rows.map((row) => [row.merchant, row]));
}

/**
 * The rows as the reader has decided they should read.
 *
 * Pure, and it copies rather than mutates: `ownedRows` hands the same array to
 * the facets, the charts and the ledger, and a rewrite in place would be a
 * change to the statement itself rather than to how it is read.
 *
 * A category the catalog no longer knows is ignored rather than applied. The
 * override is stored as a string and `CATEGORIES` is code, so an entry removed
 * in a later release would otherwise leave rows in a category nothing can
 * colour, budget or translate — the same defensive read `goalIcon` makes of
 * `savings_goals.icon`.
 */
export function applyMerchantOverrides(
  rows: Transaction[],
  overrides: Map<string, MerchantOverride>,
): Transaction[] {
  if (overrides.size === 0) return rows;

  return rows.map((row) => {
    const category = overrides.get(row.merchant)?.category;
    if (!category || category === row.category || !isCategory(category)) {
      return row;
    }
    return { ...row, category };
  });
}

/**
 * The category the importer files anything it cannot place under, and so the
 * one the mapper on `/account` lists — "Übriges" to a German reader. It is
 * also the mapper's "leave it alone" option: choosing it is the absence of an
 * override rather than an override onto `Other`.
 */
export const UNFILED = "Other";

/** Whether a stored string is still a category this build knows about. */
export function isCategory(value: string): boolean {
  return (CATEGORIES as readonly string[]).includes(value);
}

/**
 * What the app will accept as a brand domain, and the one shape it stores.
 *
 * Deliberately forgiving about the input and strict about the output: people
 * paste `https://www.uzh.ch/de/index.html`, and refusing that to insist on
 * `uzh.ch` would be a form arguing with somebody who already gave the right
 * answer. What comes back is bare, lowercase and label-shaped, because it goes
 * two places that both require it — the icon services take a domain, and
 * `app/api/merchant-icon/[slug]/route.ts` uses it as a cache filename, where
 * anything with a slash or a `..` in it would be a path rather than a name.
 *
 * `null` means "this is not a domain", which the caller reports; an empty
 * input is the caller's business (it means "no opinion") and never reaches
 * here.
 */
export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // Everything from the first slash, question mark or hash is a path, not a
  // host — and so is anything after a colon, which is a port.
  const host = withoutScheme.split(/[/?#:]/)[0].replace(/^www\./, "");

  // Bare domain: at least two labels, each alphanumeric-or-hyphen, no trailing
  // dot. 253 is the length a hostname is allowed to be.
  if (host.length > 253) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;

  return host;
}
