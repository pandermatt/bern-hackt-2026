"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { merchantOverrides, transactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { merchantBatches } from "@/lib/merchant-batches";
import { merchantDomain } from "@/lib/merchant-brands";
import { geminiApiKey } from "@/lib/llm/gemini";
import { suggestMerchantCategories } from "@/lib/llm/suggest-merchant-categories";
import {
  isCategory,
  merchantOverridesFor,
  normalizeDomain,
  UNFILED,
} from "@/lib/merchant-overrides";
import { CATEGORIES } from "@/scripts/lib/statement";

/**
 * Everything the mapper needs about one merchant on the account.
 *
 * `category` is what the merchant reads as *now* — this account's own answer
 * if it gave one, the importer's otherwise. `base` is the importer's, kept
 * beside it so setting a merchant back to what the rules said can drop the
 * override rather than store a copy of it.
 *
 * `domain` is what the account has *said*, not what is being shown: an empty
 * one with a `suggestedDomain` beside it is a merchant whose mark comes from
 * the shipped map, and the form says so as a placeholder rather than by
 * pre-filling a value nobody typed.
 */
export type MerchantRow = {
  merchant: string;
  count: number;
  spentMinor: number;
  category: string;
  /** What the importer's rules made of it, before this account said anything. */
  base: string;
  domain: string;
  /** What `lib/merchant-brands.ts` would resolve on its own, if anything. */
  suggestedDomain: string | null;
};

export type MerchantMapping = {
  /** Merchants still reading as `Other` — the work, and the top of the page. */
  open: MerchantRow[];
  /**
   * Every other merchant the account has ever had, so a decision can be
   * changed. The importer's own answers are in here too: filing Coop under
   * Food & Drink is exactly as much a decision as filing an unknown shop, and
   * the only difference is who made it.
   */
  filed: MerchantRow[];
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
 * Every merchant on the account, split into the ones still wanting a category
 * and the ones that have one.
 *
 * Grouped in SQL rather than by reading every row: this is a settings page, it
 * needs one line per merchant and no transaction detail, and the "one fetch,
 * then aggregate in JavaScript" rule is about the dashboard's *many* aggregates
 * over one scan — not about a single grouped count.
 *
 * **A merchant moves lists when it is filed, rather than vanishing.** This read
 * used to return only the rows stored as `Other`, and kept a merchant on that
 * list after it had been given a category, on the grounds that a row
 * disappearing on save reads as the save having eaten it. Two lists answer that
 * better: the decision is visibly somewhere, and the second list is the only
 * place a category can be *changed* — before this, a merchant the importer got
 * right was unreachable, so "Coop is not groceries for me" had no answer.
 *
 * The grouping is by (merchant, category) because one merchant legitimately
 * holds rows in two: a shop's refunds are filed under `Refund`, not under what
 * they were refunds *for*. The category with the most rows is the one the
 * merchant reads as, and `Refund` loses a tie on purpose — it describes the
 * direction of a handful of lines rather than what the merchant sells.
 */
export async function getMerchantMapping(): Promise<MerchantMapping | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const rows = await db
    .select({
      merchant: transactions.merchant,
      category: transactions.category,
      count: sql<number>`count(*)`,
      // Expenses are negative, so the magnitude is what a "spent" figure means.
      spentMinor: sql<number>`abs(sum(${transactions.amountMinor}))`,
    })
    .from(transactions)
    .where(eq(transactions.userId, user.id))
    .groupBy(transactions.merchant, transactions.category);

  const overrides = await merchantOverridesFor(user.id);

  type Tally = {
    count: number;
    spentMinor: number;
    byCategory: Map<string, number>;
  };
  const tallies = new Map<string, Tally>();

  for (const row of rows) {
    // Not a merchant: the single synthetic line each importer writes to seed
    // the running balance.
    if (row.category === "Opening balance") continue;

    const tally = tallies.get(row.merchant) ?? {
      count: 0,
      spentMinor: 0,
      byCategory: new Map<string, number>(),
    };
    tally.count += Number(row.count);
    tally.spentMinor += Number(row.spentMinor);
    tally.byCategory.set(
      row.category,
      (tally.byCategory.get(row.category) ?? 0) + Number(row.count),
    );
    tallies.set(row.merchant, tally);
  }

  const open: MerchantRow[] = [];
  const filed: MerchantRow[] = [];

  for (const [merchant, tally] of tallies) {
    let base = UNFILED;
    let best = -1;
    for (const [category, count] of tally.byCategory) {
      // `Refund` loses a tie: it says which way a few lines went, not what the
      // merchant is.
      const better =
        count > best || (count === best && base === "Refund" && category !== "Refund");
      if (better) {
        base = category;
        best = count;
      }
    }

    const override = overrides.get(merchant);
    const said =
      override?.category && isCategory(override.category) ? override.category : null;

    const entry: MerchantRow = {
      merchant,
      count: tally.count,
      spentMinor: tally.spentMinor,
      category: said ?? base,
      base,
      domain: override?.domain ?? "",
      suggestedDomain: merchantDomain(merchant),
    };

    (entry.category === UNFILED ? open : filed).push(entry);
  }

  // Biggest first: the merchant worth ten francs a year is not the one somebody
  // opened this page to file.
  const bySpend = (a: MerchantRow, b: MerchantRow) =>
    b.spentMinor - a.spentMinor || a.merchant.localeCompare(b.merchant);

  return {
    open: open.sort(bySpend),
    filed: filed.sort(bySpend),
    /*
     * Everything but the opening balance, which is not a place to put a
     * merchant. `Salary`, `Refund` and `Transfer` stay on the list: a mis-filed
     * employer or a refund the rules read as a purchase is exactly the kind of
     * thing somebody comes here to correct.
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
 *
 * Typed as the failure arm alone rather than as one of the result unions, so
 * both the save and the suggestion can return it.
 */
async function mappingError(
  key: string,
  values?: Record<string, string>,
): Promise<{ ok: false; error: string }> {
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

export type SuggestCategoriesResult =
  | {
      ok: true;
      /** Merchant → category, for the merchants in this batch the model placed. */
      suggestions: Record<string, string>;
      /** The names this batch actually asked about, so the client can mark
       *  exactly those done rather than the ones it guessed were in it. */
      asked: string[];
      /** How many batches the whole run has. Same arithmetic on both sides. */
      batches: number;
    }
  | { ok: false; error: string };

/**
 * Asks the model to file the merchants this account has not filed yet.
 *
 * **It takes no arguments, and that is the point.** Every export of a
 * `"use server"` module is an endpoint the browser can call with arguments of
 * its choosing, and this one spends the deployment's model budget — a version
 * that accepted a list of names would be a free text box wired to the API key.
 * The names come from `getMerchantMapping` instead, so the prompt can only ever
 * contain merchants that are already on this account's own statements.
 *
 * **Nothing is written.** The answers go back to the form, where the selects
 * show them and the person presses Save. Re-filing how somebody's money is
 * categorised moves the donut, the budget and the ledger; it is not a change to
 * make while they are looking the other way.
 *
 * Only merchants with no decision on them are asked about. A category somebody
 * chose is an answer, and asking a model to second-guess it is not what the
 * button says it does.
 *
 * **One batch per call, chosen by index.** The client walks the batches so it
 * can draw a progress bar over real completed work and light up the rows a
 * request is actually about — an index only narrows this account's own list, so
 * it costs none of the property above: the browser still cannot put a word of
 * its own into the prompt. `lib/merchant-batches.ts` is the slicing both sides
 * share, and the answer names what it asked about so a client whose list has
 * moved on marks the right rows anyway.
 *
 * The `{ ok }` envelope on a read, unlike every other read in the app: this one
 * reaches the network and can fail in ways a person needs to be told about in
 * a toast — no key configured, or nothing came back — where a signed-out
 * `getMerchantMapping` can simply answer `null`.
 */
export async function suggestCategoriesForUnfiled(input?: {
  /** Zero-based. Out of range answers an empty batch rather than an error. */
  batch?: number;
}): Promise<SuggestCategoriesResult> {
  const user = await getCurrentUser();
  if (!user) return mappingError("notSignedIn");

  // Checked here rather than left to the model call, which answers a missing
  // key with an empty map — indistinguishable from "the model had nothing to
  // say", and the two need different sentences.
  if (!geminiApiKey()) return mappingError("notConfigured");

  const mapping = await getMerchantMapping();
  if (!mapping) return mappingError("notSignedIn");

  const unfiled = mapping.open.map((row) => row.merchant);

  const batches = merchantBatches(unfiled);
  const index = Math.max(0, Math.trunc(input?.batch ?? 0));
  const asked = batches[index] ?? [];
  if (asked.length === 0) {
    return { ok: true, suggestions: {}, asked: [], batches: batches.length };
  }

  // An empty answer is not an error at this grain: one batch the model could
  // not place should not end a run that is otherwise working. The client
  // counts what came back and says so at the end.
  const suggestions = await suggestMerchantCategories(asked);

  return {
    ok: true,
    suggestions: Object.fromEntries(suggestions),
    asked,
    batches: batches.length,
  };
}
