"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { transferSavings } from "@/app/actions/savings";
import { SavingsPot } from "@/components/savings-pot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney, potPercent, type SavingsPot as Pot } from "@/lib/insights";

/**
 * The pots grid, plus drag-and-drop between them.
 *
 * A pot only knows how to draw itself — it stays a plain `<div>` — so the
 * dragging lives here, one level up, where the full list of pots is in scope
 * and a drop can be resolved against it.
 */
export function SavingsPotsGrid({ pots }: { pots: Pot[] }) {
  const [transfer, setTransfer] = useState<{ from: Pot; to: Pot } | null>(null);

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-3 sm:px-5 md:grid-cols-4 lg:grid-cols-5">
        {pots.map((pot) => (
          <PotSlot
            key={pot.id}
            pot={pot}
            onDrop={(fromGoalId) => {
              const from = pots.find((candidate) => candidate.id === fromGoalId);
              if (from) setTransfer({ from, to: pot });
            }}
          />
        ))}
      </ul>

      {transfer && (
        <TransferDialog
          from={transfer.from}
          to={transfer.to}
          onOpenChange={(open) => {
            if (!open) setTransfer(null);
          }}
        />
      )}
    </>
  );
}

/**
 * One draggable, droppable grid cell.
 *
 * Native HTML5 drag-and-drop rather than a library: this is one gesture
 * (drag a pot onto another pot), not a sortable list or a cross-window drop
 * target, so `dataTransfer` carrying the source id is the whole mechanism.
 */
function PotSlot({ pot, onDrop }: { pot: Pot; onDrop: (fromGoalId: number) => void }) {
  const [over, setOver] = useState(false);
  // Counts enter/leave rather than toggling on both, because a child element
  // firing its own dragleave on the way to a grandchild would otherwise drop
  // the highlight mid-drag.
  const depth = useRef(0);

  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", String(pot.id));
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const raw = event.dataTransfer.getData("text/plain");
        const fromGoalId = Number(raw);
        if (Number.isFinite(fromGoalId) && fromGoalId !== pot.id) {
          onDrop(fromGoalId);
        }
      }}
      className={cn(
        "cursor-grab rounded-lg transition-shadow active:cursor-grabbing",
        over && "shadow-[0_0_0_2px_var(--accent)]",
      )}
    >
      <SavingsPot pot={pot} />
    </li>
  );
}

function TransferDialog({
  from,
  to,
  onOpenChange,
}: {
  from: Pot;
  to: Pot;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Savings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLInputElement>(null);
  // Defaults to whatever moves `to` closest to its target without emptying
  // `from` past what it holds — a starting point, not a ceiling: overfunding
  // a pot is allowed everywhere else in the app, so this dialog does not shut
  // that door either.
  const suggested = Math.max(
    0,
    Math.min(from.savedMinor, to.targetMinor - to.savedMinor),
  );
  const [amount, setAmount] = useState(() =>
    suggested > 0 ? (suggested / 100).toFixed(2) : (from.savedMinor / 100).toFixed(2),
  );

  const cleaned = amount.trim().replace(/[’'\s]/g, "").replace(",", ".");
  const parsedAmount = Number(cleaned);
  const valid =
    cleaned !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    Math.round(parsedAmount * 100) <= from.savedMinor;
  const preview = valid
    ? potPercent(to.savedMinor + Math.round(parsedAmount * 100), to.targetMinor)
    : null;

  function move() {
    startTransition(async () => {
      const result = await transferSavings(from.id, to.id, amount);
      if (result.ok) {
        toast.success(
          t("transferred", { amount: formatMoney(Math.round(parsedAmount * 100)), from: from.name, to: to.name }),
        );
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          field.current?.focus();
          field.current?.select();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("transferTitle", { to: to.name })}</DialogTitle>
          <DialogDescription>
            {t("transferDescription", { amount: formatMoney(from.savedMinor), from: from.name })}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !pending) move();
          }}
        >
          <label>
            <span className="text-[12.5px] font-medium text-text-muted">
              {t("transferFieldLabel")}
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
              ? t("transferHint", { amount: formatMoney(from.savedMinor) })
              : t("transferPreview", { to: to.name, percent: preview })}
          </p>
        </form>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 cursor-pointer rounded-md border border-line-strong px-3.5 text-[13.5px] font-medium text-text transition-colors hover:bg-surface-muted"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={move}
            disabled={!valid || pending}
            className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("moveMoney")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
