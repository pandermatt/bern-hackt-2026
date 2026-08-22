"use client";

import { useTranslations } from "next-intl";

import { deleteAccount } from "@/app/actions/auth";
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

export function DangerZone() {
  const t = useTranslations("DangerZone");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="h-10 w-full shrink-0 cursor-pointer rounded-md border border-danger/40 px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger-soft sm:h-8 sm:w-auto"
        >
          {t("trigger")}
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          {/* A real form + server action, not client-side onClick: deleteAccount
              always redirects (never returns a result to toast), so this can
              be a plain progressive-enhancement submit like the logout form. */}
          <form action={deleteAccount}>
            <AlertDialogAction
              type="submit"
              className="w-full bg-danger! text-white! hover:bg-danger-hover!"
            >
              {t("confirm")}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
