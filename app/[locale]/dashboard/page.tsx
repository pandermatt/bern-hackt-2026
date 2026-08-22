import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { getDashboard } from "@/app/actions/transactions";
import { BreakdownList } from "@/components/breakdown-list";
import { ChatSidebar } from "@/components/chat-sidebar";
import { MonthlyTrend } from "@/components/monthly-trend";
import { ScrollDebug } from "@/components/scroll-debug";
import { SummaryCards } from "@/components/summary-cards";
import { TopCategoryBars } from "@/components/top-category-bars";
import { AnomalySuggestion } from "@/components/anomaly-suggestion";
import { TransactionCalendar } from "@/components/transaction-calendar";
import { TransactionFilters } from "@/components/transaction-filters";
import { TransactionList } from "@/components/transaction-list";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { displayName } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  // `getTranslations`, not `useTranslations`: an async server component cannot
  // call a hook.
  const t = await getTranslations({ locale, namespace: "Dashboard" });
  const tm = await getTranslations({ locale, namespace: "Merchants" });

  // The authoritative auth check — the proxy only sniffs for a cookie. This is
  // a protected page now, so a signed-out visitor gets bounced rather than
  // shown the landing page; the landing lives at "/", which is the public one.
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  const query = await searchParams;
  const dashboard = await getDashboard(query);
  if (!dashboard) return redirect({ href: "/login", locale });

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

          {/* The page's one category story, at every width. It opens as the
              donut on a phone — eight labelled bars have no room there — and
              as the split-on-hover bars on desktop; the view toggle then
              morphs between the two either way. This replaced the year donut
              (`CategoryPie`) that used to fill the phone slot. */}
          <TopCategoryBars data={dashboard.topCategories} stack={stack} />

          <BreakdownList
            heading={tm("heading")}
            slices={merchants}
            linkParam="merchant"
            emptyLabel={tm("empty")}
          />

          {/* Sits directly above the ledger, because that is where the findings
              it is offering would show up. Until the first scan completes —
              after that, no badges is a genuine answer rather than a gap — and
              again once the statements have been re-imported underneath the
              last scan, which leaves findings that describe transactions that
              no longer exist. The anomalies page says so in words; without this
              the dashboard just quietly stopped showing badges. */}
          {(!dashboard.anomalyScan.hasCompletedScan ||
            dashboard.anomalyScan.stale) &&
            dashboard.totalCount > 0 && (
              <div className="pt-6">
                <AnomalySuggestion
                  running={dashboard.anomalyScan.running}
                  stale={dashboard.anomalyScan.stale}
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
                anomalyLabel={dashboard.anomalyLabel}
              />
            </Suspense>
          </div>

          {/* One set of transactions, two faces. The ledger is where you read a
              row; the calendar is where you see when the money moved and which
              days the scan flagged. `calendar` is only ever non-null in
              calendar view — see getDashboard. */}
          {dashboard.calendar ? (
            <TransactionCalendar
              // Without a key from the filters, an open day would survive a
              // filter change that removed it — the same reason the ledger's
              // feed is keyed.
              key={JSON.stringify(query)}
              months={dashboard.calendar}
              monthTotals={dashboard.monthTotals}
              totalCount={dashboard.totalCount}
              filters={query}
            />
          ) : (
            <TransactionList
              rows={dashboard.transactions}
              anomalies={dashboard.anomalies}
              monthTotals={dashboard.monthTotals}
              nextOffset={dashboard.nextOffset}
              continuesInto={dashboard.continuesInto}
              totalCount={dashboard.totalCount}
              filters={query}
            />
          )}
        </div>
      </main>

      <ChatSidebar />

      {/* Temporary: the ledger's "jumps back to the top" report does not
          reproduce on a desk, so this reports from the device it happens on.
          Remove with `components/scroll-debug.tsx`. */}
      {query.debug === "scroll" && <ScrollDebug />}
    </>
  );
}
