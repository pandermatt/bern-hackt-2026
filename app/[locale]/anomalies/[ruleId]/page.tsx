import { ArrowLeft, ListFilter } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getAnomalyRuleDetail } from "@/app/actions/anomalies";
import { AnomalyIcon } from "@/components/anomaly-icon";
import { Section } from "@/components/section";
import type { Transaction } from "@/db/schema";
import { Link, redirect } from "@/i18n/navigation";
import type { AnomalySeverity } from "@/lib/anomaly-engine";
import { getCurrentUser } from "@/lib/auth";
import { formatDay, formatMoney } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/anomalies/[ruleId]">): Promise<Metadata> {
  const { locale, ruleId } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const detail = await getAnomalyRuleDetail(ruleId);
  return { title: detail ? detail.title : t("anomalies") };
}

const SEVERITY_CLASSES: Record<AnomalySeverity, string> = {
  high: "border-danger/50 text-danger",
  medium: "border-brand text-brand-ink",
  low: "border-line-strong text-text-muted",
};

/**
 * Close to the ledger's own row, so a transaction looks like itself in both
 * places — but flat, because here every row already shares one finding and
 * carries no badges of its own.
 */
function Row({ row }: { row: Transaction }) {
  const inflow = row.amountMinor > 0;

  return (
    <li className="flex items-baseline gap-3 px-4 py-2.5 sm:px-5">
      <span className="w-[11ch] shrink-0 font-mono text-[12px] text-text-subtle tabular-nums">
        {formatDay(row.bookedOn)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{row.merchant}</span>
      <span
        className={`shrink-0 font-mono text-[13px] tabular-nums ${
          inflow ? "text-positive" : "text-text"
        }`}
      >
        {inflow ? "+" : "−"}
        {formatMoney(row.amountMinor)}
      </span>
    </li>
  );
}

export default async function AnomalyRulePage({
  params,
  searchParams,
}: PageProps<"/[locale]/anomalies/[ruleId]">) {
  const { locale, ruleId } = await params;
  const { tx } = await searchParams;

  const t = await getTranslations({ locale, namespace: "Anomalies" });
  // Keyed by rule id. `t.has` first, so a finding from an older engine renders
  // without an explanation rather than throwing.
  const explain = await getTranslations({ locale, namespace: "AnomalyRules" });

  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  // A stale or hand-edited `?tx=` is simply not a focus — the page still shows
  // the rule, it just has nothing to put first.
  const focusId = Number(Array.isArray(tx) ? tx[0] : tx);
  const detail = await getAnomalyRuleDetail(
    ruleId,
    Number.isFinite(focusId) ? focusId : undefined,
  );
  if (!detail) notFound();

  const explanation = explain.has(detail.ruleId) ? explain(detail.ruleId) : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <Link
        href="/anomalies"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        {t("title")}
      </Link>

      <div className="mt-3 mb-5">
        <h1 className="flex items-start gap-3 text-[30px] leading-tight font-semibold tracking-tight text-text sm:text-[36px]">
          {/* Sized under the heading rather than with it: at 36px a lucide
              stroke reads as a second heading, where the emoji it replaces read
              as a bullet. `mt-1` puts it on the cap line of the first word. */}
          <AnomalyIcon name={detail.icon} className="mt-1 size-6 shrink-0 text-text-muted sm:size-7" />
          <span>{detail.title}</span>
        </h1>

        {explanation && (
          <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-text-muted">
            {explanation}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-md border bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold ${
              SEVERITY_CLASSES[detail.severity]
            }`}
          >
            {t("count", { count: detail.transactionCount })}
          </span>
          {/* `includeTransfers` is load-bearing: some rules attach only to
              transfer rows, which the ledger hides unless asked. */}
          <Link
            href={{
              pathname: "/dashboard",
              query: { anomaly: detail.ruleId, includeTransfers: "true" },
            }}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
          >
            <ListFilter aria-hidden className="size-3.5" />
            {t("seeInLedger")}
          </Link>
        </div>
      </div>

      <div>
        {detail.focus && (
          <Section
            id="focus"
            heading={t("thisFinding")}
            meta={formatMoney(detail.focus.totalMinor)}
            panelClassName=""
          >
            <p className="border-b border-surface px-4 py-3 text-[13px] text-text-muted sm:px-5">
              {detail.focus.description}
            </p>
            <ul className="divide-y divide-surface">
              {detail.focus.rows.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          </Section>
        )}

        {detail.others.length > 0 && (
          <Section
            id="others"
            heading={detail.focus ? t("otherOfThisKind") : t("allOfThisKind")}
            meta={t("count", { count: detail.others.length })}
            panelClassName=""
          >
            <ul className="divide-y divide-surface">
              {detail.others.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          </Section>
        )}
      </div>
    </main>
  );
}
