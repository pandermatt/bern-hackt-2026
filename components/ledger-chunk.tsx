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

import type { Transaction } from "@/db/schema";
import type { AnomalyInsight, AnomalySeverity } from "@/lib/anomaly-engine";
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

/**
 * Badge border and text per severity. The engine has always computed severity;
 * nothing rendered it, so a routine "new merchant" note and a four-times-over
 * duplicate charge arrived looking identical.
 */
const SEVERITY_CLASSES: Record<AnomalySeverity, string> = {
  high: "border-danger/50 text-danger",
  medium: "border-brand text-brand-ink",
  low: "border-line-strong text-text-muted",
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
  const isOnlyNewMerchant =
    hasAnomaly && anomalies.every((a) => a.rule_id === "NEW_MERCHANT");

  /*
   * Severest first, then capped. Month-level findings — a savings-rate shift, a
   * category shift — attach to the month's largest charges, so the one big
   * transaction that triggered several of them collects every badge at once:
   * eight, on the worst row of a year of real statements. Ordering by severity
   * means the cap drops the least urgent, and the rest stay reachable on the
   * "+N more" tooltip.
   */
  const rankedAnomalies = [...anomalies].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );
  const shownAnomalies = rankedAnomalies.slice(0, MAX_VISIBLE_BADGES);
  const hiddenAnomalies = rankedAnomalies.slice(MAX_VISIBLE_BADGES);
  const hiddenCount = hiddenAnomalies.length;

  /*
   * A wash fading out to the right, in tokens rather than the literal rgba
   * stops this carried before: those were a light blue and a light yellow
   * painted straight onto a #1c1c1c surface in dark mode. `--accent-soft` and
   * `--brand-soft` are each theme's own version of the same idea, so the row
   * now follows the ground it sits on.
   *
   * Teal for a new merchant, Supernova for everything else — the same
   * informational-versus-noteworthy split the sky/yellow pair was making.
   * Hover pushes the transparent stop further right, which deepens the wash
   * without a second set of colour values to keep in step.
   */
  const anomalyRowClasses = isOnlyNewMerchant
    ? "border-l-4 border-l-accent bg-[linear-gradient(90deg,var(--accent-soft)_0%,transparent_55%)] hover:bg-[linear-gradient(90deg,var(--accent-soft)_0%,transparent_80%)]"
    : "border-l-4 border-l-brand bg-[linear-gradient(90deg,var(--brand-soft)_0%,transparent_55%)] hover:bg-[linear-gradient(90deg,var(--brand-soft)_0%,transparent_80%)]";

  return (
    <li
      className={`flex flex-col gap-1 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:gap-3 sm:px-5 ${
        hasAnomaly ? anomalyRowClasses : "hover:bg-surface-hover"
      }`}
    >
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
              const isNewMerchant = anomaly.rule_id === "NEW_MERCHANT";

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
                    isNewMerchant
                      ? "border-accent/40 text-accent"
                      : SEVERITY_CLASSES[anomaly.severity]
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
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
            className={`mt-0.5 text-[11.5px] font-medium leading-tight ${
              isOnlyNewMerchant ? "text-accent" : "text-brand-ink"
            }`}
          >
            {anomalies[0].description}
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
          they scroll past. */}
      <div className="sticky top-16 z-10 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 bg-bg pt-6 pb-2.5">
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

        {totals && (
          <p className="flex items-baseline gap-3 font-mono text-[12px] tabular-nums">
            <span className="text-positive">
              {/* Named for anyone who cannot see the colour or the sign. */}
              <span className="sr-only">{t("moneyIn")} </span>+{formatMoney(totals.income)}
            </span>
            <span className="text-text-muted">
              <span className="sr-only">{t("moneyOut")} </span>−{formatMoney(totals.expense)}
            </span>
          </p>
        )}
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
