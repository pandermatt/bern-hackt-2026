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
            Sparziele
          </h2>
          <p className="mt-0.5 text-[12.5px] text-text-muted">
            Savings goals. Each pot fills as you put a month&rsquo;s leftover
            money into it.
          </p>
        </div>
        {pots.length > 0 && (
          <p className="font-mono text-[12.5px] tabular-nums text-text-muted">
            {formatMoney(savedMinor)} of {formatMoney(targetMinor)} saved
          </p>
        )}
      </div>

      {pots.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13.5px] text-text-muted sm:px-5">
          No goals yet. Add one below — a holiday, a new car — and it appears
          here as a pot to fill.
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
              ? `${month} is still running. Whatever it has left over becomes allocatable once the month is over.`
              : surplus === 0
                ? `${month} spent everything it earned, so there is nothing spare to put away.`
                : `${month} had ${formatMoney(surplus)} left over. Add a goal below to put it somewhere.`}
          </p>
        )
      )}

      <SavingsGoalForm />
    </section>
  );
}
