import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUp,
  Banknote,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  ChartNoAxesCombined,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  Gauge,
  Layers,
  MapPin,
  PiggyBank,
  Plane,
  RefreshCw,
  Repeat2,
  Store,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Undo2,
  UserPlus,
  Wallet,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { MerchantAvatar } from "@/components/merchant-avatar";
import type { Transaction } from "@/db/schema";
import type {
  AnomalyInsight,
  AnomalyKind,
  AnomalySeverity,
} from "@/lib/anomaly-engine";
import { formatDay, formatMoney, type MonthTotal } from "@/lib/insights";

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

const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  "lucide:arrow-up": ArrowUp,
  "lucide:circle-dollar-sign": CircleDollarSign,
  "lucide:store": Store,
  "lucide:tag": Tag,
  "lucide:repeat-2": Repeat2,
  "lucide:chart-no-axes-combined": ChartNoAxesCombined,
  "lucide:calendar-plus": CalendarPlus,
  "lucide:refresh-cw": RefreshCw,
  "lucide:calendar-x": CalendarX,
  "lucide:clock-3": Clock3,
  "lucide:calendar-clock": CalendarClock,
  "lucide:gauge": Gauge,
  "lucide:copy": Copy,
  "lucide:map-pin": MapPin,
  "lucide:plane": Plane,
  "lucide:user-plus": UserPlus,
  "lucide:arrow-left-right": ArrowLeftRight,
  "lucide:wallet": Wallet,
  "lucide:wallet-cards": WalletCards,
  "lucide:trending-down": TrendingDown,
  "lucide:piggy-bank": PiggyBank,
  "lucide:target": Target,
  "lucide:undo-2": Undo2,
  "lucide:banknote": Banknote,
  "lucide:credit-card": CreditCard,
  "lucide:trending-up": TrendingUp,
  "lucide:layers": Layers,
  "lucide:triangle-alert": TriangleAlert,
};

function getLucideIcon(iconName: string): LucideIcon {
  return LUCIDE_ICON_MAP[iconName] ?? AlertTriangle;
}

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
  const rankedAnomalies = [...anomalies].sort(
    (a, b) =>
      KIND_RANK[b.kind] - KIND_RANK[a.kind] ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  /*
   * One kind drives the wash, the first badge and the sentence, so the three
   * cannot disagree. This used to branch on `rule_id === "NEW_MERCHANT"`, which
   * stopped matching the moment the narrative layer began merging findings
   * under a combined id — the teal row was, in practice, only reachable when
   * the LLM was switched off.
   */
  const rowKind = rankedAnomalies[0]?.kind ?? "info";
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
            {shownAnomalies.map((anomaly, index) => {
              const Icon = getLucideIcon(anomaly.icon);

              return (
                <span
                  /* Not keyed on `rule_id` alone: one transaction can carry two
                     findings from the same rule — an airline billing two
                     different amounts twice over on one day — and React then
                     sees duplicate keys. */
                  key={`${anomaly.rule_id}-${index}`}
                  title={`${anomaly.title}: ${anomaly.description}`}
                  /* `bg-surface`, not the soft tint the row already wears — a
                     chip filled with its own background colour would dissolve
                     into the wash behind it. On the tinted row a plain surface
                     reads as raised, which is what a badge wants anyway. */
                  className={`inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-0.5 text-[11px] font-medium shadow-2xs transition-transform hover:scale-105 ${
                    KIND_CLASSES[anomaly.kind]
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {/* Carries the kind for anyone the colour does not reach. */}
                  <span className="sr-only">{KIND_LABELS[anomaly.kind]} </span>
                  {/* The finding's own words. This used to print `rule_id`, so
                      the row read UNUSUAL_FINANCIAL_IMPACT in monospace at a
                      person who wanted to know what happened to their money. */}
                  <span className="font-medium">{anomaly.title}</span>
                </span>
              );
            })}
            {hiddenCount > 0 && (
              <span
                title={hiddenAnomalies.map((a) => `${a.title}: ${a.description}`).join("\n")}
                className="inline-flex items-center rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted shadow-2xs"
              >
                +{hiddenCount} {t("more")}
              </span>
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
            {rankedAnomalies[0].description}
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
 * One month's rows, under a heading carrying that month's money in and out.
 *
 * The figures are the **whole month** under the current filter, not this page's
 * slice of it: at `PAGE_SIZE = 50` a month usually spans two pages, and a
 * subtotal that only counted the visible rows would report a different number
 * for the same month depending on where you happened to be. The wording says
 * "in" and "out" rather than "total" for the same reason.
 *
 * The heading sticks under the app header while you scroll its rows — which is
 * most of the point of having it. That only works because the card uses
 * `overflow-clip` rather than `overflow-hidden`; see the note there.
 */
function MonthGroup({
  month,
  rows,
  totals,
  anomaliesByTxId,
  showHeading,
  roundTop,
  roundBottom,
}: {
  month: string;
  rows: Transaction[];
  totals: MonthTotal | undefined;
  anomaliesByTxId: Map<number, AnomalyInsight[]>;
  /** False when a previous chunk already headed this month. */
  showHeading: boolean;
  /** False when this panel continues one the chunk before it opened. */
  roundTop: boolean;
  /** False when the next chunk carries the rest of this month. */
  roundBottom: boolean;
}) {
  const t = useTranslations("Ledger");
  const tMonths = useTranslations("Months");
  const headingId = `ledger-month-${month}`;

  return (
    <>
      {showHeading && (
      <>
      {/* `top-16` is the app header's own height; `z-10` keeps this under it
          rather than over it (that header is `z-50`). `bg-bg` — the page's own
          ground, not `--surface` — because there is no card behind this any
          more; it still has to be opaque or the rows would show through it as
          they scroll past.

          **Every heading in the ledger is pinned at this same offset, all at
          once.** They are siblings of one another and of the panels — a month
          can span chunks, so no month can own a wrapper to be sticky within —
          which means their shared containing block is the whole ledger
          section. Nothing releases August when September arrives; September
          simply paints over it, being later in the DOM, and the illusion holds
          only for as long as every one of these boxes is exactly as tall as
          the last.

          That is what `flex-col` below `sm` is for. Wrapping made the height
          depend on the month's *name*: "September 2025" pushed the figures
          onto a second line where "August 2025" kept them beside the heading,
          so the taller September box showed a sliver of itself below the
          shorter August one that was supposed to be covering it. Two lines
          always, on every month, and the boxes agree. From `sm` there is room
          for one line and they agree that way instead. */}
      <div className="sticky top-16 z-10 flex flex-col items-start gap-y-0.5 bg-bg pt-6 pb-2.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3">
        {/* The month is what you scan for; the year only disambiguates it, so
            it rides along at the body size. `leading-none` keeps the big type
            sitting on the same baseline as the figures opposite. */}
        <h3
          id={headingId}
          className="text-[26px] leading-none font-semibold tracking-tight text-text sm:text-[30px]"
        >
          {tMonths(`long${Number(month.slice(5, 7))}`)}{" "}
          <span className="text-[15px] font-medium text-text-muted">
            {month.slice(0, 4)}
          </span>
        </h3>

        {/* Unconditional, where this used to be `totals &&`. `monthTotals`
            skips transfers, so a month whose only line is a credit-card
            payment has no entry at all — and a heading that quietly drops its
            second line is the height mismatch above, back again. Zero is also
            the honest figure: these two exclude transfers by definition,
            exactly as the trend chart's do. */}
        <p className="flex items-baseline gap-3 font-mono text-[12px] tabular-nums">
          <span className="text-positive">
            {/* Named for anyone who cannot see the colour or the sign. */}
            <span className="sr-only">{t("moneyIn")} </span>+{formatMoney(totals?.income ?? 0)}
          </span>
          <span className="text-text-muted">
            <span className="sr-only">{t("moneyOut")} </span>−{formatMoney(totals?.expense ?? 0)}
          </span>
        </p>
      </div>

      </>
      )}

      {/* The month's rows as one panel: the grey ground and the top radius both
          live here rather than on a wrapper, because a radius on an ancestor
          would not clip this list's own background. `overflow-clip` is what
          makes the corners actually cut the first and last rows — including the
          `border-l` an anomaly row wears. Dividers are the card's surface
          showing through, so they read as white lines rather than grey
          borders. */}
      <ul
        className={`divide-y divide-surface overflow-clip bg-surface-muted ${
          roundTop ? "rounded-t-lg" : ""
        } ${roundBottom ? "rounded-b-lg" : ""}`}
      >
        {rows.map((row) => (
          <TransactionRow
            key={row.id}
            row={row}
            anomalies={anomaliesByTxId.get(row.id) ?? []}
          />
        ))}
      </ul>
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
  const anomaliesByTxId = new Map<number, AnomalyInsight[]>();
  for (const a of anomalies) {
    for (const id of a.transaction_ids) {
      const list = anomaliesByTxId.get(id) ?? [];
      list.push(a);
      anomaliesByTxId.set(id, list);
    }
  }

  const groups = groupByMonth(rows);

  return (
    <>
      {groups.map((group, index) => (
        <MonthGroup
          key={group.month}
          month={group.month}
          rows={group.rows}
          totals={monthTotals[group.month]}
          anomaliesByTxId={anomaliesByTxId}
          showHeading={index > 0 || !continuesFrom}
          roundTop={index > 0 || !continuesFrom}
          roundBottom={index < groups.length - 1 || !continuesInto}
        />
      ))}
    </>
  );
}
