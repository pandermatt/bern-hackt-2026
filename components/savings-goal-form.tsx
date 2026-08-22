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
  // Optional, and blank is a real answer: plenty of goals are "eventually".
  const [targetOn, setTargetOn] = useState("");

  const ready = name.trim() !== "" && amount.trim() !== "";

  function submit() {
    startTransition(async () => {
      const result = await createSavingsGoal(name, amount, targetOn);
      if (result.ok) {
        toast.success(t("goalAdded", { name: name.trim() }));
        setName("");
        setAmount("");
        setTargetOn("");
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
      /* The panel's own surface as the rule, matching the divider above it.

         **Stacked below `sm`, the wrapping row it always was from `sm` up.**
         Every one of the four children carried a fixed or minimum width and
         `shrink-0`, so on a phone the wrap put the 10rem date field and the
         143px "Ziel hinzufügen" button on one line and neither could give:
         313px of controls in the 248px a 320px screen leaves inside the
         panel, so the button sat on top of the date. Nothing here is worth a
         second column on a phone anyway — the widths only exist so the three
         fields line up on a desk, which is why every one of them is now
         behind the breakpoint. */
      className="flex flex-col gap-2.5 border-t border-surface px-4 py-3.5 sm:flex-row sm:flex-wrap sm:items-end sm:px-5"
    >
      <label className="sm:min-w-[10rem] sm:flex-1">
        <span className="text-[12.5px] font-medium text-text-muted">
          {t("goalLabel")}
        </span>
        <input
          type="text"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("goalPlaceholder")}
          className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[16px] sm:text-[13.5px] text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>

      <label className="sm:w-[9rem] sm:shrink-0">
        <span className="text-[12.5px] font-medium text-text-muted">
          {t("targetLabel")}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="5000"
          className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[16px] sm:text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>

      <label className="sm:w-[10rem] sm:shrink-0">
        <span className="text-[12.5px] font-medium text-text-muted">
          {t("targetDateOptional")}
        </span>
        {/* A native date input: it gets the platform's own picker and the
            reader's own date format for free, and `globals.css` already sets
            `color-scheme` per theme so the calendar glyph is not a white icon
            on a dark field. The value is always `YYYY-MM-DD` regardless. */}
        <input
          type="date"
          value={targetOn}
          onChange={(event) => setTargetOn(event.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 font-mono text-[16px] sm:text-[13px] text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>

      <button
        type="submit"
        disabled={!ready || pending}
        className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3.5 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50 sm:shrink-0"
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
