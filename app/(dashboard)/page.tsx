import { Suspense } from "react";

import { getDashboard } from "@/app/actions/transactions";
import { BreakdownList } from "@/components/breakdown-list";
import { Landing } from "@/components/landing";
import { MonthlyTrend } from "@/components/monthly-trend";
import { SummaryCards } from "@/components/summary-cards";
import { TransactionFilters } from "@/components/transaction-filters";
import { TransactionList } from "@/components/transaction-list";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  // The authoritative auth check — the proxy only sniffs for a cookie.
  // Signed-out visitors get the landing page rather than a redirect, so "/"
  // stays a usable public entry point.
  const user = await getCurrentUser();
  if (!user) return <Landing />;

  const dashboard = await getDashboard(await searchParams);
  if (!dashboard) return <Landing />;

  const { facets, filters, monthly, totals, categories, merchants } = dashboard;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <div className="mb-5">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
          Your year in money
        </h1>
        <p className="mt-1 text-[13.5px] text-text-muted">
          {facets.first
            ? `${facets.accounts.join(" and ")} · ${facets.first} to ${facets.last}`
            : "No statements imported yet."}
        </p>
      </div>

      <div className="space-y-4">
        <SummaryCards totals={totals} />

        <MonthlyTrend series={monthly} />

        <div className="grid gap-4 lg:grid-cols-2">
          <BreakdownList
            heading="Where it goes"
            slices={categories}
            linkParam="categories"
            emptyLabel="No spending in this range."
          />
          <BreakdownList
            heading="Top merchants"
            slices={merchants}
            linkParam="merchant"
            emptyLabel="No merchants in this range."
          />
        </div>

        {/* TransactionFilters reads useSearchParams, which needs a boundary it
            can suspend against. */}
        <Suspense fallback={null}>
          <TransactionFilters facets={facets} filters={filters} />
        </Suspense>

        <TransactionList
          rows={dashboard.transactions}
          anomalies={dashboard.anomalies}
          page={dashboard.page}
          pageCount={dashboard.pageCount}
          totalCount={dashboard.totalCount}
        />
      </div>
    </main>
  );
}
