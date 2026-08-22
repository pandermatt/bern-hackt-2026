"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { deleteSavingsGoal } from "@/app/actions/savings";
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
import { formatMoney } from "@/lib/insights";

/**
 * Removes a goal, and with it every allocation ever made to it.
 *
 * Confirmed rather than immediate, because the money is not deleted so much as
 * *released*: a month's surplus is a property of the statements, so emptying
 * the pot it went into makes those francs allocatable again. That is the right
 * behaviour, and also surprising enough to be worth saying out loud.
 */
export function SavingsGoalDelete({
  id,
  name,
  savedMinor,
}: {
  id: number;
  name: string;
  savedMinor: number;
}) {
  const t = useTranslations("Savings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteSavingsGoal(id);
      if (result.ok) {
        toast.success(t("removed", { name }));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={t("deleteLabel", { name })}
          className="cursor-pointer rounded-md p-1.5 text-text-subtle transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-default disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {savedMinor > 0
              ? t("deleteBodyFunded", { amount: formatMoney(savedMinor) })
              : t("deleteBodyEmpty")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={remove}
            className="bg-danger! text-white! hover:bg-danger-hover!"
          >
            {t("deleteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
