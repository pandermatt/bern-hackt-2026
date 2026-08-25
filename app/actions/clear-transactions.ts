"use server";

import { and, count, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db";
import { anomalies, anomalyRuns, transactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export type ClearResult =
  | { ok: true; deleted: number }
  | { ok: false; error: string };

/**
 * Errors are phrased here, not in the component — the client raises whatever
 * string it gets straight into a toast, so it has to arrive translated. Same
 * shape `app/actions/anomalies.ts` uses.
 */
async function clearError(key: string): Promise<ClearResult> {
  const t = await getTranslations("DangerZoneErrors");
  return { ok: false, error: t(key) };
}

const clearInputSchema = z.object({
  /**
   * One of `transactions.account` — the bank account a statement line belongs
   * to, not the login. Omitted means every account. The 60-character bound is
   * the one `lib/csv-upload.ts` clamps an imported account name to.
   */
  account: z.string().max(60).optional(),
});

/**
 * Take an account's statement lines back out.
 *
 * **The one thing in the app that deletes transactions without putting any
 * back.** The two importers that delete (`lib/demo-loader.ts` and the
 * generator) delete-then-insert, and the uploader only appends; this is the
 * danger zone's own operation, for someone who wants their statements out of a
 * deployment or wants to start an import over from nothing.
 *
 * Three things go, in this order, inside one write:
 *
 * 1. **The findings that describe the doomed lines.** A finding is a claim
 *    about a statement line, so it cannot outlive one. This is *not* a
 *    `rebindAnomalies` case — that exists because an importer reissues every
 *    id and the findings have to be re-pointed; nothing is reissued here, so
 *    the surviving rows keep their ids and the surviving findings keep
 *    pointing at them. There is nothing to re-point, only orphans to drop.
 * 2. **The lines themselves.**
 * 3. **The scan runs, but only once the account holds nothing at all.** A run
 *    is a statement about statements: with none left, `getAnomalyScanState`
 *    would otherwise compare its fingerprint against the empty set forever and
 *    report a permanently outdated scan over an account with nothing in it.
 *    Clearing one account of several leaves the runs alone — outdated is then
 *    exactly what the scan is.
 *
 * What stays: budgets, savings goals and their allocations, and merchant
 * rules. Those are decisions the account holder made rather than statements,
 * they survive every other kind of re-import, and a "clear transactions" that
 * quietly took them too would be a different button.
 *
 * The account is resolved from the session, never from an argument — every
 * export of a `"use server"` module is an endpoint the browser can call with
 * arguments of its choosing, and this one deletes. `account` is safe to take
 * from the caller for the same reason `ruleId` is in `setAnomalyResolved`: it
 * only narrows a set already scoped to the session.
 */
export async function clearTransactions(input?: {
  account?: string;
}): Promise<ClearResult> {
  const user = await getCurrentUser();
  if (!user) return clearError("notSignedIn");

  const parsed = clearInputSchema.safeParse(input ?? {});
  if (!parsed.success) return clearError("unknownAccount");
  const { account } = parsed.data;

  const scope = account
    ? and(eq(transactions.userId, user.id), eq(transactions.account, account))
    : eq(transactions.userId, user.id);

  try {
    const deleted = db.transaction((tx) => {
      // Built, not run: it is a subquery inside the delete below, so the
      // findings are matched against the lines while those still exist.
      const doomed = tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(scope);

      tx
        .delete(anomalies)
        .where(
          and(
            eq(anomalies.userId, user.id),
            inArray(anomalies.transactionId, doomed),
          ),
        )
        .run();

      const gone = tx.delete(transactions).where(scope).run().changes;

      const [left] = tx
        .select({ total: count() })
        .from(transactions)
        .where(eq(transactions.userId, user.id))
        .all();

      if ((left?.total ?? 0) === 0) {
        tx.delete(anomalyRuns).where(eq(anomalyRuns.userId, user.id)).run();
      }

      return gone;
    });

    // A named account that matched nothing is the page and the database
    // disagreeing — cleared in another tab, most likely. Reporting "0 cleared"
    // as a success would be a lie about which button was pressed.
    if (account && deleted === 0) return clearError("unknownAccount");

    // The statements are what every page under the locale is drawn from — the
    // ledger, the charts, the budget, the pots, the nudges on `/home` and the
    // findings. Naming them one by one is six calls that would still miss the
    // seventh; the subtree is the honest scope.
    revalidatePath("/[locale]", "layout");

    return { ok: true, deleted };
  } catch {
    return clearError("clearFailed");
  }
}
