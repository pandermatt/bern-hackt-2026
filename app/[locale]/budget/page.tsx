import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { Metadata } from "next";

import { getBudgetOverview } from "@/app/actions/budget";
import { getSavingsOverview } from "@/app/actions/savings";
import { BudgetEditor } from "@/components/budget-editor";
import { BudgetMonthPicker } from "@/components/budget-month-picker";
import { BudgetRadar } from "@/components/budget-radar";
import { SavingsGoals } from "@/components/savings-goals";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/budget">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("budget") };
}

export default async function BudgetPage({
  params,
  searchParams,
}: PageProps<"/[locale]/budget">) {
  const { locale } = await params;
  // `getTranslations`, not `useTranslations`: this component is async, and a
  // hook cannot be called across an await.
  const t = await getTranslations({ locale, namespace: "Budget" });

  // The proxy only sniffs for a cookie; this is the authoritative check.
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  const { month: rawMonth } = await searchParams;
  const requested = typeof rawMonth === "string" ? rawMonth : undefined;
  // Both halves resolve the same month from the same query string, so the
  // savings section is never showing a different month than the radar.
  const [overview, savings] = await Promise.all([
    getBudgetOverview(requested),
    getSavingsOverview(requested),
  ]);
  if (!overview || !savings) return redirect({ href: "/login", locale });

  const { months, month, rows } = overview;

  const totalUsed = rows.reduce((sum, row) => sum + row.usedMinor, 0);
  const totalLimit = rows.reduce((sum, row) => sum + (row.limitMinor ?? 0), 0);
  const budgeted = rows.filter((row) => row.limitMinor !== null).length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
            {t("title")}
          </h1>
          <p className="mt-1 text-[13.5px] text-text-muted">
            {month ? t("subtitle", { month }) : t("subtitleEmpty")}
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
            {t("emptyTitle")}
          </p>
          <p className="mx-auto mt-1 max-w-[42ch] text-[13.5px] text-text-muted">
            {t("emptyBody")}
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
                {t("radarHeading")}
              </h2>
              <p className="text-[12.5px] text-text-muted">
                {/* `month` is non-null whenever there are rows — `budgetRows`
                    returns [] without one — but that is not something the type
                    carries, and "no month" has nothing to say about a month
                    anyway. */}
                {budgeted === 0 || !month
                  ? t("radarNoLimits")
                  : t("radarMeta", {
                      spent: formatMoney(totalUsed),
                      limit: formatMoney(totalLimit),
                      month,
                    })}
              </p>
            </div>

            <div className="mt-2">
              <BudgetRadar rows={rows} />
            </div>
          </section>

          {/* Keyed on the month: the editor holds the typed-but-unsaved
              values in state, and switching months has to start it over. */}
          <BudgetEditor key={month} rows={rows} />

          <SavingsGoals overview={savings} />
        </div>
      )}
    </main>
  );
}
