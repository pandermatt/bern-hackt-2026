"use client";

import { Loader2, Settings } from "lucide-react";
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
}: {
  id: number;
  name: string;
  targetMinor: number;
  savedMinor: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(() => (targetMinor / 100).toFixed(2));

  const cleaned = amount.trim().replace(/[’'\s]/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  const valid = cleaned !== "" && Number.isFinite(parsed) && parsed > 0;
  // Shown before saving, because retargeting below what is already saved is
  // allowed and the resulting number surprises people.
  const preview = valid ? potPercent(savedMinor, Math.round(parsed * 100)) : null;

  function save() {
    startTransition(async () => {
      const result = await updateSavingsGoal(id, amount);
      if (result.ok) {
        toast.success(`“${name}” retargeted.`);
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
        if (next) setAmount((targetMinor / 100).toFixed(2));
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Adjust ${name}`}
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
            {formatMoney(savedMinor)} is already in this pot. Changing the
            target does not move any of it.
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
              Target (CHF)
            </span>
            <input
              ref={field}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
          <p className="mt-1.5 h-4 font-mono text-[11.5px] tabular-nums text-text-subtle">
            {preview === null
              ? "A target above zero."
              : `The pot would read ${preview}%.`}
          </p>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <button
              type="button"
              className="h-9 cursor-pointer rounded-md border border-line-strong px-3.5 text-[13.5px] font-medium text-text transition-colors hover:bg-surface-muted"
            >
              Cancel
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={save}
            disabled={!valid || pending}
            className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Save target
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
