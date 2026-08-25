"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { clearTransactions } from "@/app/actions/clear-transactions";
import type { TransactionAccount } from "@/app/actions/transactions";
import { SettingsRow } from "@/components/settings-row";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Takes the statements back out — all of them, or one account's.
 *
 * The danger zone's other row deletes the login and everything under it, which
 * is no help to someone who wants their own statements off a deployment, or
 * wants to import a file again from nothing. This is the smaller hammer, and
 * the two sit next to each other in ascending order of what they take.
 *
 * **"Account" here is the bank account a line was booked to** — the same
 * `transactions.account` the ledger's filter bar offers, and deliberately the
 * same vocabulary, since a reader meets that picker first. It is not the
 * login, which is what the row below this one deletes; that is why the label
 * says "clear transactions" rather than "clear account", and why the dialog
 * names the account it is about to empty.
 *
 * The picker only appears when there is more than one account to tell apart —
 * with a single account "all of them" and "that one" are the same button, and
 * a select with one real option is a control that cannot be used.
 *
 * `AlertDialog`, not `Dialog`: this is an interruption that demands an explicit
 * choice, and dismissing it without choosing is exactly the outcome someone who
 * mis-clicked wants.
 */
export function ClearTransactions({ accounts }: { accounts: TransactionAccount[] }) {
  const t = useTranslations("DangerZone");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** `""` is every account — the ledger filter's convention for the same idea. */
  const [scope, setScope] = useState("");

  const total = accounts.reduce((sum, entry) => sum + entry.count, 0);
  const doomed =
    scope === "" ? total : (accounts.find((a) => a.account === scope)?.count ?? 0);

  function clear() {
    startTransition(async () => {
      const result = await clearTransactions(scope === "" ? {} : { account: scope });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("cleared", { count: result.deleted }));
      // The account just cleared is about to leave the list, and a controlled
      // select pointing at an option that no longer exists renders as neither.
      setScope("");
      router.refresh();
    });
  }

  return (
    <SettingsRow
      label={<span className="text-danger">{t("clearLabel")}</span>}
      note={t("clearNote")}
    >
      <div className="flex w-full gap-2 sm:w-auto">
        {accounts.length > 1 && (
          <select
            aria-label={t("clearScope")}
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            disabled={pending}
            /* 16px below `sm` on purpose: iOS zooms the page in on a focused
               control with smaller type. The same rule the importer's fields
               and the generator's selects follow. */
            className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-[16px] text-text focus:ring-1 focus:ring-accent focus:outline-none disabled:opacity-50 sm:h-8 sm:flex-none sm:text-[13px]"
          >
            <option value="">{t("clearAll", { count: total })}</option>
            {accounts.map((entry) => (
              <option key={entry.account} value={entry.account}>
                {t("clearOne", { account: entry.account, count: entry.count })}
              </option>
            ))}
          </select>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              /* Nothing to clear is not an error worth a dialog and a toast —
                 the count beside the picker already says so. */
              disabled={pending || doomed === 0}
              className="h-10 shrink-0 cursor-pointer rounded-md border border-danger/40 px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:cursor-default disabled:opacity-50 max-sm:flex-1 sm:h-8"
            >
              {t("clearTrigger")}
            </button>
          </AlertDialogTrigger>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {scope === ""
                  ? t("clearTitleAll")
                  : t("clearTitleOne", { account: scope })}
              </AlertDialogTitle>
              {/* The count is the whole point of confirming: what a person
                  needs before pressing this is how much is about to go. */}
              <AlertDialogDescription>
                {scope === ""
                  ? t("clearBodyAll", { count: doomed })
                  : t("clearBodyOne", { account: scope, count: doomed })}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={clear}
                className="bg-danger! text-white! hover:bg-danger-hover!"
              >
                {t("clearConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SettingsRow>
  );
}
