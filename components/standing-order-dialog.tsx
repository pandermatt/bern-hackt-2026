"use client";

import { Loader2, Repeat } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setStandingOrder } from "@/app/actions/savings";
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
import { formatMoney, type SavingsPot } from "@/lib/insights";

/**
 * A Dauersparauftrag: pick a pot, say how much a month.
 *
 * **It moves no money.** The amount seeds the split when a finished month has
 * a surplus — the allocator below fills its fields from it — and nothing else
 * reads it. A standing order that quietly filled pots would invent savings out
 * of months that never had the income to spare.
 *
 * The same amount is editable on each pot's own gear dialog, beside its target
 * and deadline. This is the other door: it is the one you reach for when the
 * thought is "set up a standing order" rather than "change this pot".
 */
export function StandingOrderDialog({ pots }: { pots: SavingsPot[] }) {
  const t = useTranslations("Savings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [goalId, setGoalId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");

  const selected = pots.find((pot) => pot.id === goalId) ?? pots[0];
  const cleaned = amount.trim().replace(/[’'\s]/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  // Blank is allowed and clears the order — the same rule the server applies.
  const valid = cleaned === "" || (Number.isFinite(parsed) && parsed >= 0);

  function save() {
    if (!selected) return;
    startTransition(async () => {
      const result = await setStandingOrder(selected.id, amount);
      if (result.ok) {
        toast.success(
          t(cleaned === "" || parsed === 0 ? "standingOrderCleared" : "standingOrderSaved", {
            name: selected.name,
          }),
        );
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
        // Open on the first pot with whatever it already has, so the dialog
        // shows the truth rather than an empty field over a live order.
        if (next) {
          const first = pots[0];
          setGoalId(first?.id ?? null);
          setAmount(
            first?.monthlyMinor == null ? "" : (first.monthlyMinor / 100).toFixed(2),
          );
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-text transition-colors hover:bg-surface-muted"
        >
          <Repeat className="size-3.5 text-accent" aria-hidden />
          {t("standingOrder")}
        </button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("standingOrderTitle")}</DialogTitle>
          <DialogDescription>{t("standingOrderBody")}</DialogDescription>
        </DialogHeader>

        {pots.length === 0 ? (
          <p className="text-[13px] text-text-muted">{t("standingOrderNone")}</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && !pending) save();
            }}
            className="space-y-2.5"
          >
            <label className="block">
              <span className="text-[12.5px] font-medium text-text-muted">
                {t("standingOrderPot")}
              </span>
              <select
                value={selected?.id ?? ""}
                onChange={(event) => {
                  const next = pots.find(
                    (pot) => pot.id === Number(event.target.value),
                  );
                  setGoalId(next?.id ?? null);
                  // Switching pots shows that pot's order, not the last one's.
                  setAmount(
                    next?.monthlyMinor == null
                      ? ""
                      : (next.monthlyMinor / 100).toFixed(2),
                  );
                }}
                className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[13.5px] text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {pots.map((pot) => (
                  <option key={pot.id} value={pot.id}>
                    {pot.name}
                    {pot.monthlyMinor !== null &&
                      ` · ${t("potMonthly", { amount: formatMoney(pot.monthlyMinor) })}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[12.5px] font-medium text-text-muted">
                {t("monthlyLabel")}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className="mt-1 h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>
          </form>
        )}

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
            disabled={pots.length === 0 || !valid || pending}
            className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("standingOrderSave")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
