"use client";

import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createSavingsGoal } from "@/app/actions/savings";

/**
 * "Holiday, 5000" → a new pot.
 *
 * Held as the strings the user typed, like the budget editor: a half-finished
 * "50 0" is a legitimate intermediate state, and the server does the
 * authoritative parse anyway.
 */
export function SavingsGoalForm() {
  const t = useTranslations("Savings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  const ready = name.trim() !== "" && amount.trim() !== "";

  function submit() {
    startTransition(async () => {
      const result = await createSavingsGoal(name, amount);
      if (result.ok) {
        toast.success(t("goalAdded", { name: name.trim() }));
        setName("");
        setAmount("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !pending) submit();
      }}
      className="flex flex-wrap items-end gap-2.5 border-t border-line px-4 py-3.5 sm:px-5"
    >
      <label className="min-w-[10rem] flex-1">
        <span className="text-[12.5px] font-medium text-text-muted">
          {t("goalLabel")}
        </span>
        <input
          type="text"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("goalPlaceholder")}
          className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13.5px] text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>

      <label className="w-[9rem] shrink-0">
        <span className="text-[12.5px] font-medium text-text-muted">
          {t("targetLabel")}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="5000"
          className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>

      <button
        type="submit"
        disabled={!ready || pending}
        className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Plus className="size-3.5" aria-hidden />
        )}
        {t("addGoal")}
      </button>
    </form>
  );
}
