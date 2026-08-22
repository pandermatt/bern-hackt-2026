import { CheckCircle2, ChevronRight, Sparkles, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { getAnomalyOverview, type AnomalyGroup } from "@/app/actions/anomalies";
import { AnomalyIcon } from "@/components/anomaly-icon";
import { HideResolvedToggle } from "@/components/hide-resolved-toggle";
import { ResolveRing } from "@/components/resolve-ring";
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
 * One kind of finding, as a row you can click for the explanation.
 *
 * It opens the rule's own page rather than the filtered ledger. This page is a
 * list of *kinds* of thing, so clicking a kind should say what that kind means;
 * dropping straight into the ledger skipped the explanation and landed on a
 * view that explains nothing. The ledger is still one hop on, from the link the
 * rule page carries — which is also where the note about `includeTransfers`
 * now lives, since that flag matters only on the way to the ledger.
 *
 * The description is the finding's own words, not a template. For the
 * absence-shaped rules it is the only place the finding actually is: a missed
 * salary can only link to the last salary that *did* arrive, which on its own
 * explains nothing.
 */
function GroupRow({
  group,
  countLabel,
  progressLabel,
  hideResolved,
}: {
  group: AnomalyGroup;
  countLabel: string;
  progressLabel: string;
  hideResolved: boolean;
}) {
  return (
    <li>
      <Link
        href={`/anomalies/${group.ruleId}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover sm:px-5"
      >
        {/* How much of this kind has been worked through. An indicator, not a
            control — resolving happens on the rule's own page, where a person
            can see what they are ticking off. That is also why it can sit
            inside the anchor: a button here would be interactive content
            nested in a link.

            With `hideResolved` on it reads empty, because the resolved part is
            not in the list any more and a ring claiming progress the page is
            not showing would be describing something else. */}
        <ResolveRing
          resolved={hideResolved ? 0 : group.resolvedCount}
          total={group.transactionCount}
          label={progressLabel}
        />

        {/* The rule's own lucide glyph — the same one its badges wear in the
            ledger, so a finding is recognisable before its title is read. It
            stays neutral in colour: the count badge beside it already carries
            the severity, and a second colour-coded thing would only compete. */}
        <AnomalyIcon name={group.icon} className="size-5 shrink-0 text-text-muted" />

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
  searchParams,
}: PageProps<"/[locale]/anomalies">) {
  const { locale } = await params;
  const { hideResolved } = await searchParams;
  const t = await getTranslations({ locale, namespace: "Anomalies" });

  const user = await getCurrentUser();
  // Not the dashboard's polymorphic landing fallback — this page is not public.
  if (!user) return redirect({ href: "/login", locale });

  // The literal string, the way `includeTransfers` is read — anything else in
  // the query string simply is not the flag.
  const hidingResolved = hideResolved === "true";

  const overview = await getAnomalyOverview(hidingResolved);
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

        {/* Only once there is something to hide. The toggle reads
            `useSearchParams`, so it needs a boundary it can suspend against. */}
        {overview.resolvedGroupCount > 0 && (
          <div className="mt-3">
            <Suspense fallback={null}>
              <HideResolvedToggle resolvedGroupCount={overview.resolvedGroupCount} />
            </Suspense>
          </div>
        )}
      </div>

      {/* Outdated *and* there are findings to show. The empty state below says
          this too, but only when it has nothing else to say — and now that
          "outdated" means the statements moved rather than that every finding
          orphaned, the two are no longer the same case: a page full of results
          can still be behind, and that is exactly when nobody would think to
          re-run. Not shown while a scan is in flight, since it is about to stop
          being true. */}
      {overview.outdated && total > 0 && !overview.running && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-brand bg-brand-soft px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2.5">
            <TriangleAlert
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-brand-ink"
            />
            <div>
              <p className="text-[13.5px] font-medium text-text">
                {t("outdatedTitle")}
              </p>
              <p className="mt-0.5 max-w-[70ch] text-[12.5px] text-text-muted">
                {t("outdatedBody")}
              </p>
            </div>
          </div>
          <Link
            href="/account#anomaly-scan"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-accent px-3.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 max-sm:w-full"
          >
            {t("runScan")}
          </Link>
        </div>
      )}

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
                  progressLabel={t("resolvedOf", {
                    resolved: hidingResolved ? 0 : group.resolvedCount,
                    total: group.transactionCount,
                  })}
                  hideResolved={hidingResolved}
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
                  progressLabel={t("resolvedOf", {
                    resolved: hidingResolved ? 0 : group.resolvedCount,
                    total: group.transactionCount,
                  })}
                  hideResolved={hidingResolved}
                />
              ))}
            </ul>
          </Section>
        )}

        {/* Everything worked through, and the toggle is what is hiding it. A
            fourth kind of nothing, and the only one that is a statement about
            the reader rather than about the statements — folding it into
            `emptyTitle` would claim the scan found nothing when in fact it
            found plenty and someone dealt with all of it. */}
        {total === 0 && hidingResolved && overview.resolvedGroupCount > 0 && (
          <div className="mt-6 rounded-lg bg-surface-muted px-5 py-10 text-center">
            <CheckCircle2 aria-hidden className="mx-auto size-6 text-accent" />
            <p className="mt-3 text-[15px] font-medium text-text">
              {t("allResolvedTitle")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-text-muted">
              {t("allResolvedBody", { count: overview.resolvedGroupCount })}
            </p>
            <Suspense fallback={null}>
              <div className="mt-4 flex justify-center">
                <HideResolvedToggle resolvedGroupCount={overview.resolvedGroupCount} />
              </div>
            </Suspense>
          </div>
        )}

        {total === 0 && !(hidingResolved && overview.resolvedGroupCount > 0) && (
          <div className="mt-6 rounded-lg bg-surface-muted px-5 py-10 text-center">
            <Sparkles aria-hidden className="mx-auto size-6 text-accent" />
            {/* Three different nothings, and telling them apart is the whole
                job of this state: nobody has looked yet, someone looked and
                found nothing, or someone looked at statements that have since
                been replaced. Only the middle one is good news. */}
            <p className="mt-3 text-[15px] font-medium text-text">
              {overview.outdated
                ? t("outdatedTitle")
                : overview.hasCompletedScan
                  ? t("emptyTitle")
                  : t("neverScannedTitle")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-text-muted">
              {overview.running
                ? t("runningBody")
                : overview.outdated
                  ? t("outdatedBody")
                  : overview.hasCompletedScan
                    ? t("emptyBody")
                    : t("neverScannedBody")}
            </p>
            {(overview.outdated || !overview.hasCompletedScan) && !overview.running && (
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
