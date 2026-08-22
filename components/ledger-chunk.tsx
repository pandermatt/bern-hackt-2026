import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";

import { AnomalyIcon } from "@/components/anomaly-icon";
import { MerchantAvatar } from "@/components/merchant-avatar";
import { MonthHeading } from "@/components/month-heading";
import type { Transaction } from "@/db/schema";
import { Link } from "@/i18n/navigation";
import type {
  AnomalyInsight,
  AnomalyKind,
  AnomalySeverity,
} from "@/lib/anomaly-engine";
import { useAnomalyText } from "@/lib/anomaly-text";
import { formatMoney, type MonthTotal } from "@/lib/insights";

/**
 * One chunk of the ledger: whole months of rows, each month a rounded panel
 * under its own heading.
 *
 * A server component on both paths — the first chunk is rendered by the page,
 * and every later one by `app/actions/ledger.tsx`, which returns this element
 * for the client feed to append. That is what lets the ledger scroll for ever
 * without any transaction ever becoming client state: what crosses is rendered
 * output, never the rows.
 *
 * It lives apart from `transaction-list.tsx` to keep the imports acyclic —
 * the feed is a client component that imports the action, and the action
 * imports this.
 */

const SEVERITY_RANK: Record<AnomalySeverity, number> = { high: 3, medium: 2, low: 1 };

const KIND_RANK: Record<AnomalyKind, number> = { alert: 3, warning: 2, info: 1 };

/**
 * Badge border and text per kind.
 *
 * Kind, not severity: severity says how far from baseline a number sits, which
 * is not the same question as how much a person should worry. A CHF 6'000 bike
 * is `high` severity and still only a `warning` — nobody needs to be alarmed by
 * their own purchase.
 *
 * Teal reads as informational and is the only brand colour legible as text.
 * Supernova stays a border with `--brand-ink` carrying the type, because the
 * yellow itself is under 2:1 on white. Red is the system danger colour.
 */
const KIND_CLASSES: Record<AnomalyKind, string> = {
  alert: "border-danger/50 text-danger",
  warning: "border-brand text-brand-ink",
  info: "border-accent/40 text-accent",
};

/**
 * The row's left border and wash.
 *
 * A fade to the right in tokens rather than literal rgba: `--accent-soft`,
 * `--brand-soft` and `--danger-soft` are each theme's own version of the same
 * tint, so the row follows the ground it sits on. Hover pushes the transparent
 * stop further right, which deepens the wash without a second set of values to
 * keep in step.
 */
const KIND_ROW_CLASSES: Record<AnomalyKind, string> = {
  alert:
    "border-l-4 border-l-danger bg-[linear-gradient(90deg,var(--danger-soft)_0%,transparent_55%)] hover:bg-[linear-gradient(90deg,var(--danger-soft)_0%,transparent_80%)]",
  warning:
    "border-l-4 border-l-brand bg-[linear-gradient(90deg,var(--brand-soft)_0%,transparent_55%)] hover:bg-[linear-gradient(90deg,var(--brand-soft)_0%,transparent_80%)]",
  info: "border-l-4 border-l-accent bg-[linear-gradient(90deg,var(--accent-soft)_0%,transparent_55%)] hover:bg-[linear-gradient(90deg,var(--accent-soft)_0%,transparent_80%)]",
};

/** Colour of the sentence printed under the row, matching its wash. */
const KIND_TEXT_CLASSES: Record<AnomalyKind, string> = {
  alert: "text-danger",
  warning: "text-brand-ink",
  info: "text-accent",
};

/**
 * Spoken before the finding's title, so the classification survives for anyone
 * who cannot see the colour it is otherwise carried by. Hue alone would make
 * this a colour-only distinction.
 */
const KIND_LABELS: Record<AnomalyKind, string> = {
  alert: "Alert:",
  warning: "Heads-up:",
  info: "Note:",
};

/** Beyond this a row stops being a ledger entry and becomes a badge cloud. */
const MAX_VISIBLE_BADGES = 3;

/**
 * A panel that opens from a badge, on the browser's own popover machinery.
 *
 * Deliberately not a Radix popover. The ledger scrolls for ever, so one popover
 * component per badge would be three hydrated client roots per row without
 * bound — on a page whose whole architecture (`transaction-feed.tsx` passing
 * rendered chunks, `app/actions/ledger.tsx` returning JSX) exists so that rows
 * never become client state. `popover` needs no JavaScript at all, and because
 * the top layer sits outside the document flow it escapes `MonthGroup`'s
 * `overflow-clip`, which would otherwise cut the panel off. Escape and
 * click-outside come free with `popover="auto"`.
 */
function Panel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div
      id={id}
      popover="auto"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-4 text-left shadow-lg backdrop:bg-black/30"
    >
      {children}
    </div>
  );
}

/** What one finding means, and the way through to everything it touches. */
function FindingPanel({
  id,
  anomaly,
  transactionId,
}: {
  id: string;
  anomaly: AnomalyInsight;
  transactionId: number;
}) {
  const t = useTranslations("Anomalies");
  const anomalyText = useAnomalyText();
  const { title, description } = anomalyText(anomaly);
  // Keyed by rule id, so a finding left over from an older engine renders
  // without an explanation rather than throwing.
  const explain = useTranslations("AnomalyRules");
  const explanation = explain.has(anomaly.rule_id) ? explain(anomaly.rule_id) : null;

  return (
    <Panel id={id}>
      <p className="flex items-start gap-2 text-[14px] font-semibold text-text">
        {/* Muted, where the badge that opened this panel draws the same glyph in
            its kind colour: the colour has already been read by the time the
            panel is open, and repeating it here only shouts. `mt-0.5` sits the
            icon on the title's cap line. */}
        <AnomalyIcon name={anomaly.icon} className="mt-0.5 size-4 shrink-0 text-text-muted" />
        <span>{title}</span>
      </p>

      {explanation && (
        <p className="mt-2 text-[13px] leading-relaxed text-text-muted">{explanation}</p>
      )}

      {/* The finding's own words, which carry the numbers — the reason the
          stored evidence blob is not rendered here as well. */}
      <p className="mt-2 border-t border-line pt-2 text-[12.5px] text-text-muted">
        {description}
      </p>

      <Link
        href={{
          pathname: `/anomalies/${anomaly.rule_id}`,
          query: { tx: String(transactionId) },
        }}
        className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline"
      >
        {t("seeAll")} →
      </Link>
    </Panel>
  );
}

function Amount({ row }: { row: Transaction }) {
  const inflow = row.amountMinor > 0;
  const foreign = row.currency !== "CHF";

  return (
    <>
      <p
        className={`font-mono text-[13.5px] tabular-nums ${
          inflow ? "text-positive" : "text-text"
        }`}
      >
        {inflow ? "+" : "−"}
        {formatMoney(row.amountMinor)}
      </p>
      {foreign && (
        <p className="font-mono text-[11px] text-text-subtle">
          {formatMoney(row.originalAmountMinor, row.currency)}
        </p>
      )}
    </>
  );
}

/**
 * Two layouts, one row.
 *
 * From `sm` up this is the column table it has always been: description,
 * category, date, amount. Below `sm` those columns cannot coexist — a `w-[10ch]`
 * date and a `w-[13ch]` amount leave ~140px on a 375px screen for the merchant,
 * the description *and* the anomaly badges, so everything truncates to nothing.
 * The mobile layout stacks instead: merchant against amount, then the badges,
 * then the description, then date · category on one muted line.
 */
function TransactionRow({
  row,
  anomalies = [],
}: {
  row: Transaction;
  anomalies?: AnomalyInsight[];
}) {
  const t = useTranslations("Ledger");
  const tCategories = useTranslations("Categories");
  const tMonths = useTranslations("Months");
  // A finding is stored as the rule that found it and the values it needs, so
  // its words are chosen here rather than at scan time — see lib/anomaly-text.ts.
  const anomalyText = useAnomalyText();

  // Booked dates are `YYYY-MM-DD` text, never a `Date` — see the note on
  // `formatDay` in lib/insights.ts. The month name comes from the catalog and
  // the surrounding shape (`3 Jan 2025` against `3. Jan 2025`) from the `day`
  // message, so the whole date follows the language rather than half of it.
  const [year, month, day] = row.bookedOn.split("-");
  const bookedOn = tMonths("day", {
    day: Number(day),
    month: tMonths(`short${Number(month)}`),
    year,
  });

  // A category the catalog does not know falls through as itself. The stored
  // value stays the English key — it is what `?categories=` matches on.
  const category = tCategories.has(row.category) ? tCategories(row.category) : row.category;

  const hasAnomaly = anomalies.length > 0;
  /*
   * Most concerning first, then capped. Month-level findings — a savings-rate
   * shift, a category shift — attach to the month's largest charges, so the one
   * big transaction that triggered several of them collects every badge at
   * once: eight, on the worst row of a year of real statements. Ordering means
   * the cap drops the least urgent, and the rest stay reachable on the
   * "+N more" tooltip.
   *
   * Kind leads and severity breaks ties, which is what keeps an `alert` off the
   * hidden list. The two orderings cannot contradict each other because kind is
   * only ever escalated, never lowered, away from what severity derived.
   */
  const rankedAnomalies = [...anomalies]
    .sort(
      (a, b) =>
        KIND_RANK[b.kind] - KIND_RANK[a.kind] ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )
    // Paired with its words here rather than looked up at each of the three
    // places that print them, so the badge, the panel and the sentence cannot
    // end up quoting different sources.
    .map((anomaly) => ({ anomaly, text: anomalyText(anomaly) }));

  /*
   * One kind drives the wash, the first badge and the sentence, so the three
   * cannot disagree. This used to branch on `rule_id === "NEW_MERCHANT"`, which
   * stopped matching the moment the narrative layer began merging findings
   * under a combined id — the teal row was, in practice, only reachable when
   * the LLM was switched off.
   */
  const rowKind = rankedAnomalies[0]?.anomaly.kind ?? "info";
  const shownAnomalies = rankedAnomalies.slice(0, MAX_VISIBLE_BADGES);
  const hiddenAnomalies = rankedAnomalies.slice(MAX_VISIBLE_BADGES);
  const hiddenCount = hiddenAnomalies.length;

  const anomalyRowClasses = KIND_ROW_CLASSES[rowKind];

  return (
    <li
      className={`flex flex-col gap-1 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:gap-3 sm:px-5 ${
        hasAnomaly ? anomalyRowClasses : "hover:bg-surface-hover"
      }`}
    >
      {/* A plain sibling rather than a wrapper, which works precisely because
          the tile is hidden below `sm`: there the <li> is `flex-col` and an
          avatar would stack *above* the text, but it never renders. From `sm`
          up the <li> is `flex-row sm:items-center`, so it lands inline ahead of
          the text block with no extra element.

          Hidden on mobile by the layout note above: a 32px tile plus its gap
          takes a third of the ~140px the merchant name, the description and the
          badges already fight over at 375px. */}
      <MerchantAvatar name={row.merchant} className="hidden sm:inline-flex" />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[14px] font-medium text-text">
            {row.merchant}
          </p>
          {/* Mobile only; from `sm` this leaves for the column at the end. */}
          <div className="shrink-0 text-right sm:hidden">
            <Amount row={row} />
          </div>
        </div>

        {/* Their own row rather than sharing a `flex-wrap` with the merchant
            name, which on a phone pushed a truncated name and a full-width
            badge onto the same cramped line. */}
        {hasAnomaly && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {shownAnomalies.map(({ anomaly, text }, index) => {
              /* Not keyed on `rule_id` alone: one transaction can carry two
                 findings from the same rule — an airline billing two different
                 amounts twice over on one day — and React then sees duplicate
                 keys. The panel needs the same uniqueness for its element id. */
              const key = `${anomaly.rule_id}-${index}`;
              const panelId = `finding-${row.id}-${key}`;

              return (
                <Fragment key={key}>
                  <button
                    type="button"
                    popoverTarget={panelId}
                    /* `bg-surface`, not the soft tint the row already wears — a
                       chip filled with its own background colour would dissolve
                       into the wash behind it. On the tinted row a plain surface
                       reads as raised, which is what a badge wants anyway. */
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-surface px-2 py-0.5 text-[11px] font-medium shadow-2xs transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      KIND_CLASSES[anomaly.kind]
                    }`}
                  >
                    <AnomalyIcon name={anomaly.icon} className="h-3.5 w-3.5 shrink-0" />
                    {/* Carries the kind for anyone the colour does not reach. */}
                    <span className="sr-only">{KIND_LABELS[anomaly.kind]} </span>
                    {/* The finding's own words. This used to print `rule_id`, so
                        the row read UNUSUAL_FINANCIAL_IMPACT in monospace at a
                        person who wanted to know what happened to their money. */}
                    <span className="font-medium">{text.title}</span>
                  </button>

                  {/* The native title attribute this replaces was unreachable on
                      touch and unstyleable. */}
                  <FindingPanel id={panelId} anomaly={anomaly} transactionId={row.id} />
                </Fragment>
              );
            })}
            {hiddenCount > 0 && (
              <>
                <button
                  type="button"
                  popoverTarget={`finding-${row.id}-more`}
                  className="inline-flex cursor-pointer items-center rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted shadow-2xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  +{hiddenCount} {t("more")}
                </button>
                <Panel id={`finding-${row.id}-more`}>
                  <ul className="divide-y divide-line">
                    {hiddenAnomalies.map(({ anomaly, text }, index) => (
                      <li key={`${anomaly.rule_id}-${index}`} className="py-2.5 first:pt-0 last:pb-0">
                        <Link
                          href={{
                            pathname: `/anomalies/${anomaly.rule_id}`,
                            query: { tx: String(row.id) },
                          }}
                          className="block hover:underline"
                        >
                          <span className="flex items-start gap-1.5 text-[13px] font-medium text-text">
                            <AnomalyIcon
                              name={anomaly.icon}
                              className="mt-0.5 size-3.5 shrink-0 text-text-muted"
                            />
                            {text.title}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-text-muted">
                            {text.description}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </>
            )}
          </div>
        )}

        <p className="mt-0.5 truncate text-[12.5px] text-text-muted">
          {row.description}
        </p>

        {hasAnomaly && (
          <p
            className={`mt-0.5 text-[11.5px] font-medium leading-tight ${KIND_TEXT_CLASSES[rowKind]}`}
          >
            {/* `rankedAnomalies`, not `anomalies`: the sentence has to be the
                same finding the wash and the first badge are showing. */}
            {rankedAnomalies[0].text.description}
          </p>
        )}

        {/* Date and category, folded onto one line. Both are standalone columns
            from `sm` up, where there is room for them. */}
        <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-text-subtle sm:hidden">
          <span className="font-mono tabular-nums">{bookedOn}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{category}</span>
        </p>
      </div>

      <div className="hidden shrink-0 sm:block">
        {/* `bg-surface`, not `bg-surface-muted`: the body is now that same
            grey, and a chip filled with its own ground is no chip at all —
            before this it was visible only on the hovered row. */}
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11.5px] font-medium text-text-muted">
          {category}
        </span>
      </div>

      <div className="hidden w-[12ch] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-text-subtle sm:block">
        {bookedOn}
      </div>

      <div className="hidden w-[13ch] shrink-0 text-right sm:block">
        <Amount row={row} />
      </div>
    </li>
  );
}

/**
 * Fans each finding out over the transactions it implicates.
 *
 * An insight can name several rows, and a row can collect several insights —
 * this is the lookup both the ledger and the calendar's expanded day read.
 */
function byTransactionId(
  anomalies: AnomalyInsight[],
): Map<number, AnomalyInsight[]> {
  const map = new Map<number, AnomalyInsight[]>();
  for (const a of anomalies) {
    for (const id of a.transaction_ids) {
      const list = map.get(id) ?? [];
      list.push(a);
      map.set(id, list);
    }
  }
  return map;
}

/**
 * A panel of transaction rows.
 *
 * The ledger's month panels and the calendar's expanded day are the same list,
 * so they are the same component — the anomaly wash, the kind-ranked badges and
 * the "+N more" chip all come along free, and a change to a row lands in both
 * views at once.
 *
 * `overflow-clip` rather than `overflow-hidden` is what lets the ledger's
 * headings stay sticky above this; the radius has to live on the list itself
 * because a radius on an ancestor would not clip this background.
 */
export function DayRows({
  rows,
  anomalies,
  className = "divide-surface rounded-lg bg-surface-muted",
}: {
  rows: Transaction[];
  anomalies: AnomalyInsight[];
  /**
   * Ground, corners **and the divider colour** — the three travel together. On
   * the ledger's grey panel the dividers are `--surface` showing through, so
   * they read as white lines rather than grey borders; inside the calendar the
   * panel is itself `--surface`, where that same rule would draw white on
   * white. The ledger also varies the radius at chunk seams, which is the other
   * reason this is the caller's to decide.
   */
  className?: string;
}) {
  const anomaliesByTxId = byTransactionId(anomalies);

  return (
    <ul className={`divide-y overflow-clip ${className}`}>
      {rows.map((row) => (
        <TransactionRow
          key={row.id}
          row={row}
          anomalies={anomaliesByTxId.get(row.id) ?? []}
        />
      ))}
    </ul>
  );
}

/**
 * One month's rows, under a heading carrying that month's money in and out.
 *
 * The figures are the **whole month** under the current filter, not this page's
 * slice of it: at `PAGE_SIZE = 50` a month usually spans two pages, and a
 * subtotal that only counted the visible rows would report a different number
 * for the same month depending on where you happened to be. The wording says
 * "in" and "out" rather than "total" for the same reason.
 */
function MonthGroup({
  month,
  rows,
  totals,
  anomalies,
  showHeading,
  roundTop,
  roundBottom,
}: {
  month: string;
  rows: Transaction[];
  totals: MonthTotal | undefined;
  anomalies: AnomalyInsight[];
  /** False when a previous chunk already headed this month. */
  showHeading: boolean;
  /** False when this panel continues one the chunk before it opened. */
  roundTop: boolean;
  /** False when the next chunk carries the rest of this month. */
  roundBottom: boolean;
}) {
  return (
    <>
      {showHeading && (
        <MonthHeading month={month} totals={totals} id={`ledger-month-${month}`} />
      )}

      <DayRows
        rows={rows}
        anomalies={anomalies}
        className={`divide-surface bg-surface-muted ${
          roundTop ? "rounded-t-lg" : ""
        } ${roundBottom ? "rounded-b-lg" : ""}`}
      />
    </>
  );
}

/**
 * Splits the page into consecutive runs of one month.
 *
 * Rows arrive `desc(bookedOn), asc(id)` from the database, so a month is
 * already a contiguous block — this is one pass with no sort, and it keeps the
 * ledger's existing order rather than imposing its own.
 */
function groupByMonth(rows: Transaction[]): { month: string; rows: Transaction[] }[] {
  const groups: { month: string; rows: Transaction[] }[] = [];

  for (const row of rows) {
    const month = row.bookedOn.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.month === month) last.rows.push(row);
    else groups.push({ month, rows: [row] });
  }

  return groups;
}


export function LedgerChunk({
  rows,
  anomalies,
  monthTotals,
  continuesFrom = false,
  continuesInto = false,
}: {
  rows: Transaction[];
  anomalies: AnomalyInsight[];
  /** Money in and out per `YYYY-MM` across the whole filtered set. */
  monthTotals: Record<string, MonthTotal>;
  /** This chunk opens mid-month; the chunk before it already drew the heading,
   * so this one draws neither a heading nor a top radius and the two panels
   * read as one. */
  continuesFrom?: boolean;
  /** This chunk closes mid-month; the next one carries the rest. */
  continuesInto?: boolean;
}) {
  const groups = groupByMonth(rows);

  return (
    <>
      {groups.map((group, index) => (
        <MonthGroup
          key={group.month}
          month={group.month}
          rows={group.rows}
          totals={monthTotals[group.month]}
          anomalies={anomalies}
          showHeading={index > 0 || !continuesFrom}
          roundTop={index > 0 || !continuesFrom}
          roundBottom={index < groups.length - 1 || !continuesInto}
        />
      ))}
    </>
  );
}
