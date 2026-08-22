import { useTranslations } from "next-intl";

import type { SavingsOverview } from "@/app/actions/savings";
import { SavingsAllocator } from "@/components/savings-allocator";
import { SavingsGoalForm } from "@/components/savings-goal-form";
import { SavingsPotsGrid } from "@/components/savings-pots-grid";
import { Section } from "@/components/section";
import { formatMoney } from "@/lib/insights";
import { monthLabel } from "@/lib/month-label";

/**
 * Sparziele: what the account is saving for, and where a finished month's
 * leftover money goes.
 *
 * Server-rendered apart from the controls that need one — the pots are SVG
 * the server can draw, but the grid around them is a client component too,
 * since dragging one pot onto another to move money is genuine interactivity.
 *
 * The allocator appears **only for a month that has ended and came out
 * ahead**. Offering to put away money from a month still in progress is
 * offering to allocate next week's rent: the surplus is income minus spending,
 * and on the 8th that number only ever goes down.
 */
export function SavingsGoals({ overview }: { overview: SavingsOverview }) {
  // `useTranslations`, not `getTranslations`: this is a *synchronous* server
  // component, so the hook works and keeps the call site the same shape the
  // client components use.
  const t = useTranslations("Savings");
  const tMonths = useTranslations("Months");
  const { month, monthEnded, surplusMinor, freeMinor, pots } = overview;

  // The sentences below name the month; `month` itself is the `YYYY-MM` key
  // the data layer speaks. Interpolating the key read "In 2025-12 blieb Geld
  // übrig" — see `lib/month-label.ts`.
  const monthName = month === null ? null : monthLabel(tMonths, month);

  const savedMinor = pots.reduce((sum, pot) => sum + pot.savedMinor, 0);
  const targetMinor = pots.reduce((sum, pot) => sum + pot.targetMinor, 0);
  const surplus = surplusMinor ?? 0;
  // What this month may claim: everything still free in the pool, plus
  // whatever it has already put away — those francs are its to revise. The
  // gate is the pool rather than the month's own leftover, because a pot is a
  // claim on money the account is holding, not on one month's pay slip.
  const monthAllocated = pots.reduce((sum, pot) => sum + pot.monthMinor, 0);
  const ceilingMinor = freeMinor + monthAllocated;
  const canAllocate = month !== null && monthEnded && ceilingMinor > 0;

  return (
    /* The page's one section idiom — big heading on the page's own ground over
       a grey panel — rather than a card. See `components/section.tsx`.

       The meta slot holds one line, so it carries whichever of the two is
       worth reading: the running total once there are pots, and the sentence
       explaining what a pot is when there are none. */
    <Section
      id="savings"
      heading={t("heading")}
      /* The meta slot holds one line about the pots as a set rather than any
         one of them, which is the only thing the section heading can speak to. */
      meta={
        <span className="text-[12.5px] text-text-muted">
          {pots.length > 0
            ? t("savedOfTarget", {
                saved: formatMoney(savedMinor),
                target: formatMoney(targetMinor),
              })
            : t("subtitle")}
        </span>
      }
    >
      {pots.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13.5px] text-text-muted sm:px-5">
          {t("empty")}
        </p>
      ) : (
        <SavingsPotsGrid
          pots={pots}
          month={monthEnded ? month : null}
          freeMinor={freeMinor}
        />
      )}

      {canAllocate && pots.length > 0 ? (
        // Keyed on the month *and* on what is already allocated: the allocator
        // holds typed-but-unsaved amounts, so switching months has to start it
        // over, and so does anything that moves money outside the allocator
        // itself — dragging a pot onto another one can change this month's
        // already-allocated figure for both, and a stale key would leave the
        // fields showing amounts that no longer match what is actually saved.
        <SavingsAllocator
          key={`${month}:${pots.map((pot) => `${pot.id}:${pot.monthMinor}`).join(",")}`}
          month={month}
          surplusMinor={ceilingMinor}
          pots={pots}
        />
      ) : (
        /* Tested through `monthName` so the narrowing reaches the value the
           sentences interpolate; the two are null together by construction. */
        monthName !== null && (
          <p className="border-t border-surface px-4 py-3 text-[12.5px] text-text-muted sm:px-5">
            {/* The month's own figure still leads, because that is the thing
                the reader just lived through. What follows it is about the
                pool, which is what actually decides whether anything can be
                put away. */}
            {!monthEnded
              ? t("monthRunning", { month: monthName })
              : freeMinor < 0
                ? t("poolOverdrawn", { amount: formatMoney(freeMinor) })
                : surplus < 0
                  ? t("monthOverspent", { month: monthName, amount: formatMoney(surplus) })
                  : t("poolEmpty", { month: monthName })}
          </p>
        )
      )}

      <SavingsGoalForm />
    </Section>
  );
}
