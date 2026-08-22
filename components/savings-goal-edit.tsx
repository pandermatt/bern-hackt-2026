"use client";

import { Loader2, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateSavingsGoal } from "@/app/actions/savings";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatMoney, potPercent } from "@/lib/insights";

/**
 * Retargets a pot.
 *
 * A plain `Dialog`, not the `AlertDialog` the delete control uses: an alert
 * dialog is an interruption that demands a choice, which is right for
 * destroying data and wrong for a form you might change your mind about.
 *
 * `open` is held here so the dialog can close itself once the save lands —
 * otherwise the toast fires behind a panel that is still covering the pot.
 */
export function SavingsGoalEdit({
  id,
  name,
  targetMinor,
  savedMinor,
  targetOn,
  monthlyMinor,
}: {
  id: number;
  name: string;
  targetMinor: number;
  savedMinor: number;
  targetOn: string | null;
  monthlyMinor: number | null;
}) {
  const t = useTranslations("Savings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(() => (targetMinor / 100).toFixed(2));
  // Both optional, and both clear on blank: a goal may have no deadline and
  // most have no standing order.
  const [due, setDue] = useState(() => targetOn ?? "");
  const [monthly, setMonthly] = useState(() =>
    monthlyMinor === null ? "" : (monthlyMinor / 100).toFixed(2),
  );

  const cleaned = amount.trim().replace(/[’'\s]/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  const valid = cleaned !== "" && Number.isFinite(parsed) && parsed > 0;
  // Shown before saving, because retargeting below what is already saved is
  // allowed and the resulting number surprises people.
  const preview = valid ? potPercent(savedMinor, Math.round(parsed * 100)) : null;

  function save() {
    startTransition(async () => {
      const result = await updateSavingsGoal(id, amount, due, monthly);
      if (result.ok) {
        toast.success(t("retargeted", { name }));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening should show what is stored, not last time's abandoned edit.
        if (next) {
          setAmount((targetMinor / 100).toFixed(2));
          setDue(targetOn ?? "");
          setMonthly(monthlyMinor === null ? "" : (monthlyMinor / 100).toFixed(2));
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("adjustLabel", { name })}
          className="cursor-pointer rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-muted hover:text-text"
        >
          <Settings className="size-3.5" aria-hidden />
        </button>
      </DialogTrigger>

      <DialogContent
        onOpenAutoFocus={(event) => {
          // Focus the field, not the close button: there is one thing to do
          // here and it is type a number, and it is already filled in.
          event.preventDefault();
          field.current?.focus();
          field.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {t("editDescription", { amount: formatMoney(savedMinor) })}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending) save();
          }}
        >
          <label>
            <span className="text-[12.5px] font-medium text-text-muted">
              {t("targetLabel")}
            </span>
            <input
              ref={field}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[16px] sm:text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
          <p className="mt-1.5 h-4 font-mono text-[11.5px] tabular-nums text-text-subtle">
            {preview === null
              ? t("editHint")
              : t("editPreview", { percent: preview })}
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <label>
              <span className="text-[12.5px] font-medium text-text-muted">
                {t("targetDateLabel")}
              </span>
              {/* Native, so the reader gets their platform's picker and their
                  own date format; the value is `YYYY-MM-DD` either way. */}
              <input
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 font-mono text-[16px] sm:text-[12.5px] text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>
            <label>
              <span className="text-[12.5px] font-medium text-text-muted">
                {t("monthlyLabel")}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={monthly}
                onChange={(event) => setMonthly(event.target.value)}
                placeholder="0.00"
                className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[16px] sm:text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <button
              type="button"
              className="h-9 cursor-pointer rounded-md border border-line-strong px-3.5 text-[13.5px] font-medium text-text transition-colors hover:bg-surface-muted"
            >
              {t("cancel")}
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={save}
            disabled={!valid || pending}
            className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("saveTarget")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
