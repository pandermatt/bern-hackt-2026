import { Suspense } from "react";

import { getDashboard } from "@/app/actions/transactions";
import { BreakdownList } from "@/components/breakdown-list";
import { CategoryPie } from "@/components/category-pie";
import { Landing } from "@/components/landing";
import { MonthlyTrend } from "@/components/monthly-trend";
import { SummaryCards } from "@/components/summary-cards";
import { TransactionFilters } from "@/components/transaction-filters";
import { TransactionList } from "@/components/transaction-list";
import { getCurrentUser } from "@/lib/auth";
import { slotsOf } from "@/lib/insights";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  // The authoritative auth check — the proxy only sniffs for a cookie.
  // Signed-out visitors get the landing page rather than a redirect, so "/"
  // stays a usable public entry point.
  const user = await getCurrentUser();
  if (!user) return <Landing />;

  const dashboard = await getDashboard(await searchParams);
  if (!dashboard) return <Landing />;

  const { facets, view, filters, monthly, stack, totals, categories, merchants } =
    dashboard;
  // One category, one colour, everywhere on the page — and the slots come from
  // the whole-range ranking, so a filter never repaints the survivors.
  const slots = slotsOf(stack);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <div className="mb-5">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text">
          Your year in money
        </h1>
        {/* Describes the rows in view, so it tracks the filters. An empty view
            with statements behind it is a filter that matched nothing — a
            different thing to say than having imported nothing at all. */}
        <p className="mt-1 text-[13.5px] text-text-muted">
          {view.first
            ? `${view.accounts.join(" and ")} · ${view.first} to ${view.last}`
            : facets.first
              ? "No transactions match these filters."
              : "No statements imported yet."}
        </p>
      </div>

      <div className="space-y-4">
        <SummaryCards totals={totals} />

        <MonthlyTrend series={monthly} />

        <CategoryPie stack={stack} />

        <div className="grid gap-4 lg:grid-cols-2">
          <BreakdownList
            heading="Where it goes"
            slices={categories}
            linkParam="categories"
            emptyLabel="No spending in this range."
            slots={slots}
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
