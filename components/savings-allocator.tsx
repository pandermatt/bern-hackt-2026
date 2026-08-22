"use client";

import { Loader2, PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { allocateSurplus } from "@/app/actions/savings";
import { formatMoney, type SavingsPot } from "@/lib/insights";
import { monthLabel } from "@/lib/month-label";

/**
 * Splits a finished month's leftover money across the pots.
 *
 * The running total is the whole point of doing this client-side: allocating
 * is a balancing act, and finding out you overshot only after a round trip
 * makes it one you do twice. The server re-derives the ceiling from the
 * statements regardless — this is the convenience, not the check.
 *
 * Fields start at whatever is already allocated for the month, so revising is
 * editing rather than starting over. That is why the parent keys this on the
 * month: switching months has to reset the inputs, and a remount does that
 * better than an effect that syncs a render later.
 */

/** Minor units → the plain decimal an input should hold. Zero stays empty. */
function toField(minor: number): string {
  return minor === 0 ? "" : (minor / 100).toFixed(2);
}

/** What a field is worth, for the running total. `NaN` for anything unparseable. */
function toMinor(field: string): number {
  const cleaned = field.trim().replace(/[’'\s]/g, "").replace(",", ".");
  if (cleaned === "") return 0;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : NaN;
}

export function SavingsAllocator({
  month,
  surplusMinor,
  pots,
}: {
  month: string;
  surplusMinor: number;
  pots: SavingsPot[];
}) {
  const t = useTranslations("Savings");
  const tMonths = useTranslations("Months");
  // "Dezember 2025", not the `YYYY-MM` key the action is keyed on —
  // `month` itself still goes to the server untouched. See `lib/month-label.ts`.
  const monthName = monthLabel(tMonths, month);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fields, setFields] = useState<Record<number, string>>(() =>
    // What is already allocated for this month: those are saved figures and
    // the reader is editing them, not starting over.
    Object.fromEntries(pots.map((pot) => [pot.id, toField(pot.monthMinor)])),
  );

  const amounts = pots.map((pot) => toMinor(fields[pot.id] ?? ""));
  const invalid = amounts.some(Number.isNaN);
  const claimed = invalid
    ? 0
    : amounts.reduce((sum, amount) => sum + amount, 0);
  const remaining = surplusMinor - claimed;
  const over = remaining < 0;
  const dirty = pots.some(
    (pot, index) => amounts[index] !== pot.monthMinor && !Number.isNaN(amounts[index]),
  );

  function spreadEvenly() {
    if (pots.length === 0) return;
    // A pot the user already put a number into is left alone — its amount
    // still counts against the pool, but only the empty fields get filled.
    const filled = pots.map((pot) => (fields[pot.id] ?? "").trim() !== "");
    const claimedByFilled = pots.reduce(
      (sum, pot, index) =>
        filled[index] && !Number.isNaN(amounts[index]) ? sum + amounts[index] : sum,
      0,
    );
    const pool = Math.max(0, surplusMinor - claimedByFilled);

    // A pot's share stops at what it still needs to reach its target —
    // `savedMinor` already counts this month's own contribution, so add
    // `monthMinor` back before subtracting.
    const caps = pots.map((pot) =>
      Math.max(0, pot.targetMinor - pot.savedMinor + pot.monthMinor),
    );
    const allocated = new Array<number>(pots.length).fill(0);
    // Water-filling: a pot that caps out at the current even share frees its
    // leftover for the pots still under theirs, which raises their share, which
    // can cap out another pot — so this repeats until a pass caps out none.
    const active = new Set(
      pots.map((_, index) => index).filter((index) => !filled[index]),
    );
    let pending = pool;
    while (active.size > 0) {
      const share = Math.floor(pending / active.size);
      let anyCapped = false;
      for (const index of active) {
        if (caps[index] <= share) {
          allocated[index] = caps[index];
          pending -= caps[index];
          active.delete(index);
          anyCapped = true;
        }
      }
      if (!anyCapped) {
        // Nothing left to cap: split what remains evenly, remainder to the
        // first still-active pot rather than letting it vanish.
        const indices = [...active];
        const each = Math.floor(pending / indices.length);
        const remainder = pending - each * indices.length;
        indices.forEach((index, position) => {
          allocated[index] = position === 0 ? each + remainder : each;
        });
        break;
      }
    }
    setFields((previous) => {
      const next = { ...previous };
      pots.forEach((pot, index) => {
        if (!filled[index]) next[pot.id] = toField(allocated[index]);
      });
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await allocateSurplus(
        month,
        pots.map((pot) => ({ goalId: pot.id, amount: fields[pot.id] ?? "" })),
      );
      if (result.ok) {
        toast.success(t("moved"));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    /* Sits inside the savings panel, which is already `--surface-muted`, so
       the tinted strip this used to wear has nothing left to distinguish it
       from — the rule above is the whole separation, and it is the panel's own
       surface showing through, like the ledger's dividers. */
    <div className="border-t border-surface px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-text">
          <PiggyBank className="size-4 text-accent" aria-hidden />
          {t("allocatorHeading", { month: monthName })}
        </h3>
        {/* "left over", not "free": the line below tracks what is still
            unallocated, and two numbers both calling themselves free is how a
            reader ends up trusting neither. */}
        <p className="font-mono text-[12.5px] tabular-nums text-text-muted">
          {t("allocatorLeftOver", { amount: formatMoney(surplusMinor) })}
        </p>
      </div>

      <ul className="mt-3 space-y-2">
        {pots.map((pot) => (
          <li key={pot.id} className="flex items-center gap-3">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ background: `var(--chart-${pot.slot})` }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">
              {pot.name}
            </span>
            <label className="shrink-0">
              <span className="sr-only">
                {t("allocatorFieldLabel", { name: pot.name, month: monthName })}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={fields[pot.id] ?? ""}
                onChange={(event) =>
                  setFields((previous) => ({
                    ...previous,
                    [pot.id]: event.target.value,
                  }))
                }
                placeholder="0.00"
                className="h-9 w-[8.5rem] rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[16px] sm:text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>
          </li>
        ))}
      </ul>

      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-3">
        <p
          className={`mr-auto font-mono text-[12.5px] tabular-nums ${
            over || invalid ? "text-danger" : "text-text-muted"
          }`}
        >
          {invalid
            ? t("notAnAmount")
            : over
              ? t("over", { amount: formatMoney(-remaining) })
              : t("unallocated", { amount: formatMoney(remaining) })}
        </p>

        <button
          type="button"
          onClick={spreadEvenly}
          disabled={pending}
          /* `bg-surface`, hovering to `surface-hover`: on the grey panel a
             hover to `surface-muted` is a hover to its own ground. */
          className="h-9 cursor-pointer rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-60"
        >
          {t("splitEvenly")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || over || invalid || !dirty}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("moveToPots")}
        </button>
      </div>
    </div>
  );
}
