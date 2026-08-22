import { ArrowLeft, CheckCircle2, ListFilter } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { getAnomalyRuleDetail } from "@/app/actions/anomalies";
import { AnomalyIcon } from "@/components/anomaly-icon";
import { HideResolvedToggle } from "@/components/hide-resolved-toggle";
import { ResolveToggle } from "@/components/resolve-toggle";
import { Section } from "@/components/section";
import type { Transaction } from "@/db/schema";
import { Link, redirect } from "@/i18n/navigation";
import type { AnomalySeverity } from "@/lib/anomaly-engine";
import { getCurrentUser } from "@/lib/auth";
import { formatDay, formatMoney, groupByDayMerchant } from "@/lib/insights";

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
 * carries no badges of its own. The date has moved up to the group heading,
 * which is where it is now said once instead of on every line.
 *
 * A server component: the amounts and merchant names never leave the server.
 * Only the toggle beside it is a client component, and it is handed ids.
 */
function Row({
  row,
  ruleId,
  resolved,
  label,
}: {
  row: Transaction;
  ruleId: string;
  resolved: boolean;
  label: string;
}) {
  const inflow = row.amountMinor > 0;

  return (
    <li
      className={`flex items-baseline gap-3 px-4 py-2.5 sm:px-5 ${
        // The same "switched off" treatment the hidden category chips wear, so
        // a thing you have dealt with looks the same everywhere in the app.
        resolved ? "opacity-60" : ""
      }`}
    >
      <span className="self-center">
        <ResolveToggle
          ruleId={ruleId}
          transactionIds={[row.id]}
          resolved={resolved}
          label={label}
          className="size-[16px]"
        />
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-[13.5px] text-text ${
          resolved ? "line-through" : ""
        }`}
      >
        {row.description || row.merchant}
      </span>
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

/**
 * The rows of one section, folded into (booking day, merchant) groups.
 *
 * That pair is the unit `consolidateInsights` merges findings on, so it is the
 * boundary the engine itself already treats as "one event" — four charges of a
 * single duplicate billing belong to one heading and resolve together.
 *
 * Three scopes of control, and they nest: the page header ticks off the whole
 * rule, a group heading ticks off its day at its merchant, a row ticks off
 * itself. A group counts as resolved only when every row in it is, so the
 * heading's state can never claim more than the rows underneath it.
 */
function GroupedRows({
  rows,
  ruleId,
  resolvedIds,
  t,
}: {
  rows: Transaction[];
  ruleId: string;
  resolvedIds: Set<number>;
  t: Awaited<ReturnType<typeof getTranslations<"Anomalies">>>;
}) {
  const groups = groupByDayMerchant(rows);

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const ids = group.rows.map((row) => row.id);
        const resolvedHere = ids.filter((id) => resolvedIds.has(id)).length;
        const groupResolved = resolvedHere === ids.length;
        // Some but not all — the only case the ring alone would be ambiguous.
        const partly = resolvedHere > 0 && !groupResolved;
        // A group of one already says its amount on its row, so repeating it in
        // the heading would print the same figure twice on adjacent lines.
        const many = group.rows.length > 1;

        return (
          <div key={group.key}>
            {/* On the page's own ground, not on a panel: the ledger's month
                headings work exactly this way, and it is what makes this read
                as a title over a list rather than as the list's first row.
                Smaller than a month heading, though, because this sits one
                level further in -- the Section above it already owns the
                26/30px step. */}
            <div className="flex items-center gap-3 px-1 pb-1.5">
              <ResolveToggle
                ruleId={ruleId}
                transactionIds={ids}
                resolved={groupResolved}
                progress={{ resolved: resolvedHere, total: ids.length }}
                label={
                  /* A part-filled ring is otherwise a shape-only signal: the
                     group carries no "x of y" text of its own, so the progress
                     goes into the button's name when there is any to report. */
                  partly
                    ? `${t("resolveGroup", {
                        merchant: group.merchant,
                        day: formatDay(group.bookedOn),
                      })} — ${t("resolvedOf", {
                        resolved: resolvedHere,
                        total: ids.length,
                      })}`
                    : t(groupResolved ? "unresolveGroup" : "resolveGroup", {
                        merchant: group.merchant,
                        day: formatDay(group.bookedOn),
                      })
                }
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-[14px] font-medium text-text ${
                    groupResolved ? "line-through opacity-70" : ""
                  }`}
                >
                  {group.merchant}
                </p>
                <p className="font-mono text-[12px] text-text-subtle tabular-nums">
                  {formatDay(group.bookedOn)}
                  {many && ` · ${t("count", { count: group.rows.length })}`}
                </p>
              </div>
              {many && (
                <span className="shrink-0 font-mono text-[13px] text-text tabular-nums">
                  {formatMoney(group.totalMinor)}
                </span>
              )}
            </div>

            {/* Every group gets its rows now, single-row ones included. They
                used to be folded into the heading to avoid saying the same
                thing twice, which worked while the heading sat on the panel;
                with the heading lifted off it, a one-row group would otherwise
                have no panel at all and its amount would float on the page.

                `overflow-clip` on the list itself is what rounds the first and
                last rows -- a radius on an ancestor does not clip a child's
                background. Dividers are `--surface` showing through the grey,
                the same as the ledger's panels. */}
            <ul className="divide-y divide-surface overflow-clip rounded-lg bg-surface-muted">
              {group.rows.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  ruleId={ruleId}
                  resolved={resolvedIds.has(row.id)}
                  /* Named by the line the row actually shows, not by the
                     merchant: two salary payments from one employer on one
                     day are two buttons, and naming both after the merchant
                     and the amount gives them the same accessible name. */
                  label={t(resolvedIds.has(row.id) ? "unresolveOne" : "resolveOne", {
                    amount: formatMoney(row.amountMinor),
                    line: row.description || row.merchant,
                  })}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default async function AnomalyRulePage({
  params,
  searchParams,
}: PageProps<"/[locale]/anomalies/[ruleId]">) {
  const { locale, ruleId } = await params;
  const { tx, hideResolved } = await searchParams;

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

  const resolvedIds = new Set(detail.resolvedIds);
  const allIds = [
    ...(detail.focus?.rows ?? []).map((row) => row.id),
    ...detail.others.map((row) => row.id),
  ];
  const allResolved = allIds.length > 0 && allIds.every((id) => resolvedIds.has(id));

  // The same literal string the overview reads, and the same flag: switching it
  // on there and clicking into a rule has to keep the ticked-off rows out of
  // sight, or the setting would only hold for as long as you stay on one page.
  const hidingResolved = hideResolved === "true";
  // Not a filter in the query: `resolvedIds` is "every finding of this rule on
  // that row is done", which the action works out across findings, and the
  // header's controls still need the full set to have something to reopen.
  const shown = (rows: Transaction[]) =>
    hidingResolved ? rows.filter((row) => !resolvedIds.has(row.id)) : rows;

  const focusRows = shown(detail.focus?.rows ?? []);
  const otherRows = shown(detail.others);
  // Recomputed rather than taken from `detail.focus`: a total over rows the
  // page is not showing would be a heading describing a different list.
  const focusTotalMinor = focusRows.reduce((sum, t) => sum + Math.abs(t.amountMinor), 0);
  const nothingLeft = focusRows.length === 0 && otherRows.length === 0;

  // Keeps the switch on across the hop back, the same way the list's own rows
  // carry it inward.
  const backHref = hidingResolved ? "/anomalies?hideResolved=true" : "/anomalies";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12">
      <Link
        href={backHref}
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

          {/* The whole rule, in one control. `allResolved` is what makes this a
              real toggle rather than a one-way sweep — clicking a full ring
              puts everything back, which is the only way out of resolving 40
              rows by mistake. */}
          <span className="inline-flex items-center gap-2">
            <ResolveToggle
              ruleId={detail.ruleId}
              transactionIds={allIds}
              resolved={allResolved}
              /* Draws the same fraction the text beside it states — an empty
                 circle next to "1 of 2 resolved" was the ring contradicting
                 its own label. */
              progress={{
                resolved: detail.resolvedIds.length,
                total: detail.transactionCount,
              }}
              label={t(allResolved ? "unresolveAll" : "resolveAll")}
              className="size-[20px]"
            />
            <span className="text-[13px] font-medium text-text-muted">
              {t("resolvedOf", {
                resolved: detail.resolvedIds.length,
                total: detail.transactionCount,
              })}
            </span>
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

          {/* The same control the overview carries, in the same row as this
              page's other whole-rule affordances. Always, not only once
              something is resolved: it is one setting spanning both pages, and
              a switch that appears and disappears under you is not one.

              The "x of y resolved" above stays truthful while it is on — that
              count is about the rule, not about the list, and it is the only
              thing left saying how much is being hidden. */}
          <Suspense fallback={null}>
            <HideResolvedToggle resolvedCount={detail.resolvedIds.length} />
          </Suspense>
        </div>
      </div>

      <div>
        {detail.focus && focusRows.length > 0 && (
          <Section
            id="focus"
            heading={t("thisFinding")}
            meta={formatMoney(focusTotalMinor)}
            /* No ground of its own: each group below brings its own panel, and
               a panel inside a panel reads as neither. */
            panelClassName="bg-transparent overflow-visible"
          >
            {/* Was a strip across the top of the panel, with a border where the
                panel used to end. On the bare ground it is just the section's
                own lead-in. */}
            <p className="px-1 pb-3 text-[13px] text-text-muted">
              {detail.focus.description}
            </p>
            <GroupedRows
              rows={focusRows}
              ruleId={detail.ruleId}
              resolvedIds={resolvedIds}
              t={t}
            />
          </Section>
        )}

        {otherRows.length > 0 && (
          <Section
            id="others"
            heading={
              detail.focus && focusRows.length > 0
                ? t("otherOfThisKind")
                : t("allOfThisKind")
            }
            meta={t("count", { count: otherRows.length })}
            panelClassName="bg-transparent overflow-visible"
          >
            <GroupedRows
              rows={otherRows}
              ruleId={detail.ruleId}
              resolvedIds={resolvedIds}
              t={t}
            />
          </Section>
        )}

        {/* The rule is worked through and the toggle is what is hiding it. The
            page cannot simply render nothing here: it still has a title, a
            count and a ring above, and an empty space under them reads as a
            page that failed to load rather than as a job finished. */}
        {nothingLeft && (
          <div className="mt-6 rounded-lg bg-surface-muted px-5 py-10 text-center">
            <CheckCircle2 aria-hidden className="mx-auto size-6 text-accent" />
            <p className="mt-3 text-[15px] font-medium text-text">
              {t("allResolvedTitle")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-text-muted">
              {t("allResolvedRuleBody", { count: detail.resolvedIds.length })}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
