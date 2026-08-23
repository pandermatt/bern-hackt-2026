import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { Metadata } from "next";

import { getBudgetOverview } from "@/app/actions/budget";
import { BudgetEditor } from "@/components/budget-editor";
import { BudgetMonthPicker } from "@/components/budget-month-picker";
import { BudgetRadar } from "@/components/budget-radar";
import { DragonBuddy } from "@/components/dragon-buddy";
import { Section } from "@/components/section";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/insights";
import { budgetVerdict, dragonForBudget, isOverBudget } from "@/lib/nudges";
import { monthLabel } from "@/lib/month-label";

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
  // The copy names the month; `month` is the `YYYY-MM` key the query string
  // and the data layer speak. See `lib/month-label.ts`.
  const tMonths = await getTranslations({ locale, namespace: "Months" });

  // The proxy only sniffs for a cookie; this is the authoritative check.
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  const { month: rawMonth } = await searchParams;
  const requested = typeof rawMonth === "string" ? rawMonth : undefined;
  const overview = await getBudgetOverview(requested);
  if (!overview) return redirect({ href: "/login", locale });

  const { months, month, rows } = overview;
  const monthName = month ? monthLabel(tMonths, month) : null;

  const totalUsed = rows.reduce((sum, row) => sum + row.usedMinor, 0);
  const totalLimit = rows.reduce((sum, row) => sum + (row.limitMinor ?? 0), 0);
  const budgeted = rows.filter((row) => row.limitMinor !== null).length;

  /* The dragon's read on the month, decided once in `lib/nudges.ts` so the
     face and the sentence cannot disagree — the same split the anomaly engine
     makes between `severity` and `kind`. The figures below are only ever the
     evidence for the verdict; they never pick it. */
  const verdict = budgetVerdict(rows);
  const over = rows.filter(isOverBudget);
  const overBy = over.reduce(
    (sum, row) => sum + (row.usedMinor - (row.limitMinor as number)),
    0,
  );
  // The one nearest its limit without having crossed it — the category the
  // "tight" verdict is actually about.
  const tightest = rows
    .filter((row) => row.limitMinor !== null && !isOverBudget(row))
    .sort(
      (a, b) =>
        b.usedMinor / (b.limitMinor as number) - a.usedMinor / (a.limitMinor as number),
    )[0];

  const dragonLine =
    verdict === "unplanned"
      ? t("dragonUnplanned")
      : verdict === "over"
        ? t("dragonOver", { count: over.length })
        : verdict === "tight"
          ? t("dragonTight", { category: tightest?.category ?? "" })
          : t("dragonClear");

  const dragonNote =
    verdict === "over"
      ? t("dragonNoteOver", { amount: formatMoney(overBy) })
      : verdict === "tight" && tightest
        ? t("dragonNoteTight", {
            share: Math.round(
              (tightest.usedMinor / (tightest.limitMinor as number)) * 100,
            ),
          })
        : verdict === "clear"
          ? t("dragonNoteClear", { count: budgeted, total: rows.length })
          : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      {/* The dashboard's and the anomalies page's own heading size. This used
          to be 22px, which put the page title below the section headings that
          sit under it. */}
      <div className="mb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {t("title")}
        </h1>
        {/* A flourish, not a divider — the brand's whole colour range at
            once, under the one line on the page that names it. Decorative and
            `aria-hidden`: nothing here has to be told apart, which is what
            makes the ramp safe to use as a sweep. See `globals.css`. */}
        <div className="rainbow-underline mt-2 w-24" aria-hidden />
        <p className="mt-1 text-[13.5px] text-text-muted">
          {month
            ? /* One sentence with the link inside it, rather than two
                 fragments spliced around it: German puts "Sparziele"
                 elsewhere in the clause than English does. */
              t.rich("subtitle", {
                savings: (chunks) => (
                  <Link
                    href="/savings"
                    className="font-medium text-accent hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })
            : t("subtitleEmpty")}
        </p>
      </div>

      {rows.length > 0 && (
        <div className="mb-6">
          <DragonBuddy mood={dragonForBudget(verdict)} line={dragonLine} note={dragonNote} />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg bg-surface-muted px-5 py-14 text-center">
          <p className="text-[15px] font-medium text-text">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-[42ch] text-[13px] text-text-muted">
            {t("emptyBody")}
          </p>
        </div>
      ) : (
        /* No `space-y` — every Section brings its own `pt-6`, the rhythm the
           dashboard, the ledger and the anomalies page already run on. */
        <div>
          <Section
            id="radar"
            heading={t("radarHeading")}
            meta={
              /* `month` is non-null whenever there are rows — `budgetRows`
                 returns [] without one — but that is not something the type
                 carries, and "no month" has nothing to say about a month
                 anyway. Tested through `monthName` rather than `month` so the
                 narrowing reaches the value actually interpolated below; the
                 two are null together by construction. */
              budgeted === 0 || !monthName
                ? t("radarNoLimits")
                : t("radarMeta", {
                    spent: formatMoney(totalUsed),
                    limit: formatMoney(totalLimit),
                    month: monthName,
                  })
            }
            panelClassName="p-4 sm:p-5"
          >
            {/* The month lives with the chart it refits, not up beside the
                page title — the radar's rim is refitted to whichever month is
                picked, and every figure in the panel follows it. */}
            {month && months.length > 1 && (
              <div className="mb-3 flex justify-end">
                <Suspense fallback={null}>
                  <BudgetMonthPicker months={months} month={month} />
                </Suspense>
              </div>
            )}

            <BudgetRadar rows={rows} />
          </Section>

          {/* Keyed on the month: the editor holds the typed-but-unsaved
              values in state, and switching months has to start it over. */}
          <BudgetEditor key={month} rows={rows} />
        </div>
      )}
    </main>
  );
}
