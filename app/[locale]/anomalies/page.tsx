import { ChevronRight, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getAnomalyOverview, type AnomalyGroup } from "@/app/actions/anomalies";
import { Section } from "@/components/section";
import { Link, redirect } from "@/i18n/navigation";
import type { AnomalySeverity } from "@/lib/anomaly-engine";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/anomalies">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return { title: t("anomalies") };
}

/**
 * The same vocabulary the ledger's badges use, so a finding looks like itself
 * in both places.
 */
const SEVERITY_CLASSES: Record<AnomalySeverity, string> = {
  high: "border-danger/50 text-danger",
  medium: "border-brand text-brand-ink",
  low: "border-line-strong text-text-muted",
};

/**
 * One kind of finding, as a row you can click into the ledger.
 *
 * Two details that look incidental and are not:
 *
 *  - `includeTransfers=true` rides on every link. `applyFilters` drops transfers
 *    unless asked, and some rules — `LARGE_TRANSFER` most obviously — attach
 *    *only* to transfer rows, so without it those links land on an empty
 *    ledger. Carrying it unconditionally also means one counting rule serves
 *    every group, so the number here always matches the ledger's own footer.
 *  - The description is the finding's own words, not a template. For the
 *    absence-shaped rules it is the only place the finding actually is: a
 *    missed salary can only link to the last salary that *did* arrive, which on
 *    its own explains nothing.
 */
function GroupRow({ group, countLabel }: { group: AnomalyGroup; countLabel: string }) {
  return (
    <li>
      <Link
        href={{
          pathname: "/",
          query: { anomaly: group.ruleId, includeTransfers: "true" },
        }}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover sm:px-5"
      >
        <span aria-hidden className="shrink-0 text-[20px] leading-none">
          {group.emoji}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[14px] font-medium text-text">{group.title}</span>
            <span
              className={`rounded-md border bg-surface px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums ${
                SEVERITY_CLASSES[group.severity]
              }`}
            >
              {countLabel}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-text-muted">
            {group.description}
          </span>
        </span>

        <ChevronRight aria-hidden className="size-4 shrink-0 text-text-subtle" />
      </Link>
    </li>
  );
}

export default async function AnomaliesPage({
  params,
}: PageProps<"/[locale]/anomalies">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Anomalies" });

  const user = await getCurrentUser();
  // Not the dashboard's polymorphic landing fallback — this page is not public.
  if (!user) return redirect({ href: "/login", locale });

  const overview = await getAnomalyOverview();
  const total = overview.action.length + overview.context.length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <div className="mb-5">
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {t("title")}
        </h1>
        <p className="mt-1 text-[13.5px] text-text-muted">
          {overview.hasCompletedScan ? t("subtitle") : t("subtitleUnscanned")}
        </p>
      </div>

      {/* No `space-y` — every Section brings its own `pt-6`, the rhythm the
          dashboard and the ledger already run on. */}
      <div>
        {overview.action.length > 0 && (
          <Section
            id="action"
            heading={t("actionHeading")}
            meta={t("actionMeta")}
            panelClassName=""
          >
            <ul className="divide-y divide-surface">
              {overview.action.map((group) => (
                <GroupRow
                  key={group.ruleId}
                  group={group}
                  countLabel={t("count", { count: group.transactionCount })}
                />
              ))}
            </ul>
          </Section>
        )}

        {overview.context.length > 0 && (
          <Section
            id="context"
            heading={t("contextHeading")}
            meta={t("contextMeta")}
            panelClassName=""
          >
            <ul className="divide-y divide-surface">
              {overview.context.map((group) => (
                <GroupRow
                  key={group.ruleId}
                  group={group}
                  countLabel={t("count", { count: group.transactionCount })}
                />
              ))}
            </ul>
          </Section>
        )}

        {total === 0 && (
          <div className="mt-6 rounded-lg bg-surface-muted px-5 py-10 text-center">
            <Sparkles aria-hidden className="mx-auto size-6 text-accent" />
            {/* Three different nothings, and telling them apart is the whole
                job of this state: nobody has looked yet, someone looked and
                found nothing, or someone looked at statements that have since
                been replaced. Only the middle one is good news. */}
            <p className="mt-3 text-[15px] font-medium text-text">
              {overview.stale
                ? t("staleTitle")
                : overview.hasCompletedScan
                  ? t("emptyTitle")
                  : t("neverScannedTitle")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-text-muted">
              {overview.running
                ? t("runningBody")
                : overview.stale
                  ? t("staleBody")
                  : overview.hasCompletedScan
                    ? t("emptyBody")
                    : t("neverScannedBody")}
            </p>
            {(overview.stale || !overview.hasCompletedScan) && !overview.running && (
              <Link
                href="/account#anomaly-scan"
                className="mt-4 inline-flex h-10 items-center rounded-full bg-accent px-5 text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                {t("runScan")}
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
