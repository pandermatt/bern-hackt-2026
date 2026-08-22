import { useTranslations } from "next-intl";

import type { SavingsOverview } from "@/app/actions/savings";
import { SavingsAllocator } from "@/components/savings-allocator";
import { SavingsGoalForm } from "@/components/savings-goal-form";
import { SavingsPot } from "@/components/savings-pot";
import { formatMoney } from "@/lib/insights";

/**
 * Sparziele: what the account is saving for, and where a finished month's
 * leftover money goes.
 *
 * Server-rendered apart from the three controls, like the rest of the app —
 * the pots are SVG the server can draw, and only the forms need a client.
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
  const { month, monthEnded, surplusMinor, pots } = overview;

  const savedMinor = pots.reduce((sum, pot) => sum + pot.savedMinor, 0);
  const targetMinor = pots.reduce((sum, pot) => sum + pot.targetMinor, 0);
  const surplus = surplusMinor ?? 0;
  const canAllocate = month !== null && monthEnded && surplus > 0;

  return (
    <section className="card overflow-hidden" aria-labelledby="savings-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line bg-surface-muted/40 px-4 py-3 sm:px-5">
        <div>
          <h2 id="savings-heading" className="text-[14.5px] font-semibold text-text">
            {t("heading")}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-text-muted">
            {t("subtitle")}
          </p>
        </div>
        {pots.length > 0 && (
          <p className="font-mono text-[12.5px] tabular-nums text-text-muted">
            {t("savedOfTarget", {
              saved: formatMoney(savedMinor),
              target: formatMoney(targetMinor),
            })}
          </p>
        )}
      </div>

      {pots.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13.5px] text-text-muted sm:px-5">
          {t("empty")}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-3 sm:px-5 md:grid-cols-4 lg:grid-cols-5">
          {pots.map((pot) => (
            <SavingsPot key={pot.id} pot={pot} />
          ))}
        </ul>
      )}

      {canAllocate && pots.length > 0 ? (
        // Keyed on the month: the allocator holds typed-but-unsaved amounts,
        // and switching months has to start it over.
        <SavingsAllocator
          key={month}
          month={month}
          surplusMinor={surplus}
          pots={pots}
        />
      ) : (
        month !== null && (
          <p className="border-t border-line bg-surface-muted/40 px-4 py-3 text-[12.5px] text-text-muted sm:px-5">
            {!monthEnded
              ? t("monthRunning", { month })
              : surplus === 0
                ? t("monthSpentAll", { month })
                : t("monthLeftOver", {
                    month,
                    amount: formatMoney(surplus),
                  })}
          </p>
        )
      )}

      <SavingsGoalForm />
    </section>
  );
}
