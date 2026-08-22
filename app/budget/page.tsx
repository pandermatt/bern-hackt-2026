import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getBudgetOverview } from "@/app/actions/budget";
import { BudgetEditor } from "@/components/budget-editor";
import { BudgetMonthPicker } from "@/components/budget-month-picker";
import { BudgetRadar } from "@/components/budget-radar";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/insights";

export const dynamic = "force-dynamic";

export const metadata = { title: "Budget" };

export default async function BudgetPage({
  searchParams,
}: PageProps<"/budget">) {
  // The proxy only sniffs for a cookie; this is the authoritative check.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { month: rawMonth } = await searchParams;
  const overview = await getBudgetOverview(
    typeof rawMonth === "string" ? rawMonth : undefined,
  );
  if (!overview) redirect("/login");

  const { months, month, rows } = overview;

  const totalUsed = rows.reduce((sum, row) => sum + row.usedMinor, 0);
  const totalLimit = rows.reduce((sum, row) => sum + (row.limitMinor ?? 0), 0);
  const budgeted = rows.filter((row) => row.limitMinor !== null).length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
            Budget
          </h1>
          <p className="mt-1 text-[13.5px] text-text-muted">
            {month
              ? `Set a monthly limit per category and watch ${month} against it.`
              : "No statements imported yet."}
          </p>
        </div>

        {month && months.length > 1 && (
          <Suspense fallback={null}>
            <BudgetMonthPicker months={months} month={month} />
          </Suspense>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card px-5 py-14 text-center">
          <p className="text-[14.5px] font-medium text-text">
            Nothing to budget yet
          </p>
          <p className="mx-auto mt-1 max-w-[42ch] text-[13.5px] text-text-muted">
            Import a statement and this page will suggest a monthly limit for
            each category, from your own averages.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="card p-5" aria-labelledby="radar-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2
                id="radar-heading"
                className="text-[15px] font-semibold text-text"
              >
                Spending against budget
              </h2>
              <p className="text-[12.5px] text-text-muted">
                {budgeted === 0
                  ? "No limits set — the ring is your own monthly average"
                  : `${formatMoney(totalUsed)} spent of ${formatMoney(totalLimit)} in ${month}`}
              </p>
            </div>

            <div className="mt-2">
              <BudgetRadar rows={rows} />
            </div>
          </section>

          {/* Keyed on the month: the editor holds the typed-but-unsaved
              values in state, and switching months has to start it over. */}
          <BudgetEditor key={month} rows={rows} />
        </div>
      )}
    </main>
  );
}
