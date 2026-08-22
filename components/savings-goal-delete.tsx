"use client";

import { Trash2 } from "lucide-react";
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteSavingsGoal(id);
      if (result.ok) {
        toast.success(`“${name}” removed.`);
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
          aria-label={`Delete ${name}`}
          className="cursor-pointer rounded-md p-1.5 text-text-subtle transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-default disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden />
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {savedMinor > 0
              ? `The ${formatMoney(savedMinor)} in this pot goes back to the months it came from, and can be allocated again. This cannot be undone.`
              : "This pot is empty, so nothing is lost. This cannot be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={remove}
            className="bg-danger! text-white! hover:bg-danger-hover!"
          >
            Delete goal
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
