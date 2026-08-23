import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

import { getBudgetOverview } from "@/app/actions/budget";
import { BudgetBoard } from "@/components/budget-board";
import { Link, redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
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

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      {/* The dashboard's and the anomalies page's own heading size. This used
          to be 22px, which put the page title below the section headings that
          sit under it. */}
      <div className="mb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {t("title")}
        </h1>
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

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg bg-surface-muted px-5 py-14 text-center">
          <p className="text-[15px] font-medium text-text">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-[42ch] text-[13px] text-text-muted">
            {t("emptyBody")}
          </p>
        </div>
      ) : (
        <BudgetBoard
          rows={rows}
          months={months}
          month={month}
          monthName={monthName}
        />
      )}
    </main>
  );
}
