import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { getDashboard } from "@/app/actions/transactions";
import { BreakdownList } from "@/components/breakdown-list";
import { CategoryPie } from "@/components/category-pie";
import { ChatSidebar } from "@/components/chat-sidebar";
import { Landing } from "@/components/landing";
import { MonthlyTrend } from "@/components/monthly-trend";
import { SummaryCards } from "@/components/summary-cards";
import { TopCategoryBars } from "@/components/top-category-bars";
import { AnomalySuggestion } from "@/components/anomaly-suggestion";
import { TransactionFilters } from "@/components/transaction-filters";
import { TransactionList } from "@/components/transaction-list";
import { getCurrentUser } from "@/lib/auth";
import { displayName } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function Home({ params, searchParams }: PageProps<"/[locale]">) {
  const { locale } = await params;
  // `getTranslations`, not `useTranslations`: an async server component cannot
  // call a hook.
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  const tm = await getTranslations({ locale, namespace: "Merchants" });

  // The authoritative auth check — the proxy only sniffs for a cookie.
  // Signed-out visitors get the landing page rather than a redirect, so "/"
  // stays a usable public entry point.
  const user = await getCurrentUser();
  if (!user) return <Landing />;

  const query = await searchParams;
  const dashboard = await getDashboard(query);
  if (!dashboard) return <Landing />;

  const { facets, view, filters, monthly, stack, totals, merchants } = dashboard;

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
        <div className="mb-5">
          {/* Bigger than the 26/30px section headings below it, or the page
              would be headed by something smaller than its own sections. */}
          <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
            {t("welcome")} {displayName(user)}
          </h1>
          {/* Describes the rows in view, so it tracks the filters. An empty view
              with statements behind it is a filter that matched nothing — a
              different thing to say than having imported nothing at all. */}
          <p className="mt-1 text-[13.5px] text-text-muted">
            {view.first
              ? t("range", {
                  accounts: view.accounts.join(t("accountJoiner")),
                  first: view.first,
                  last: view.last,
                })
              : facets.first
                ? t("noMatches")
                : t("nothingImported")}
          </p>
        </div>

        {/* No `space-y` — every section below carries the ledger's own `pt-6`
            on its heading, so the whole page runs on one rhythm instead of two
            stacked ones. The bare blocks get theirs explicitly. */}
        <div>
          <SummaryCards totals={totals} />

          <MonthlyTrend series={monthly} />

          {/* One category story per breakpoint, not two stacked tellings of
              it: the donut on a phone, where eight labelled bars have no room
              and hover barely exists; the split-on-hover bars from `sm` up,
              where they can breathe. CSS decides, not JS, so the server HTML
              carries both and neither flashes in. Colours come from the same
              slot map, so a category looks identical wherever it shows. */}
          <div className="sm:hidden">
            <CategoryPie stack={stack} />
          </div>
          <div className="hidden sm:block">
            <TopCategoryBars data={dashboard.topCategories} stack={stack} />
          </div>

          <BreakdownList
            heading={tm("heading")}
            slices={merchants}
            linkParam="merchant"
            emptyLabel={tm("empty")}
          />

          {/* Sits directly above the ledger, because that is where the findings
              it is offering would show up. Only until the first scan completes —
              after that, no badges is a genuine answer rather than a gap. */}
          {!dashboard.anomalyScan.hasCompletedScan &&
            dashboard.totalCount > 0 && (
              <div className="pt-6">
                <AnomalySuggestion
                  running={dashboard.anomalyScan.running}
                  transactionCount={dashboard.totalCount}
                />
              </div>
            )}

          {/* TransactionFilters reads useSearchParams, which needs a boundary it
              can suspend against. */}
          <div className="pt-6">
            <Suspense fallback={null}>
              <TransactionFilters
                facets={facets}
                filters={filters}
                accountTotals={dashboard.accountTotals}
              />
            </Suspense>
          </div>

          <TransactionList
            rows={dashboard.transactions}
            anomalies={dashboard.anomalies}
            monthTotals={dashboard.monthTotals}
            nextOffset={dashboard.nextOffset}
            continuesInto={dashboard.continuesInto}
            totalCount={dashboard.totalCount}
            filters={query}
          />
        </div>
      </main>

      <ChatSidebar />
    </>
  );
}
