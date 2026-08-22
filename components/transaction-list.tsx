import { Suspense } from "react";
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
  Sparkles,
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

import { EmptyState } from "@/components/empty-state";
import {
  LEDGER_ANCHOR_ID,
  TransactionPagination,
} from "@/components/transaction-pagination";
import type { Transaction } from "@/db/schema";
import type { AnomalyInsight, AnomalySeverity } from "@/lib/anomaly-engine";
import { formatDay, formatMoney } from "@/lib/insights";

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

function getHighestSeverity(anomalies: AnomalyInsight[]): AnomalySeverity | null {
  if (!anomalies || anomalies.length === 0) return null;
  if (anomalies.some((a) => a.severity === "high")) return "high";
  if (anomalies.some((a) => a.severity === "medium")) return "medium";
  return "low";
}

/**
 * The amount, rendered twice per row — once inside the stacked mobile layout and
 * once as its own column from `sm` up. Only one is ever displayed, and
 * `display: none` takes the other out of the accessibility tree too, so nothing
 * is announced twice.
 */
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
  const hasAnomaly = anomalies.length > 0;
  const isOnlyNewMerchant =
    hasAnomaly && anomalies.every((a) => a.rule_id === "NEW_MERCHANT");

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
      className={`flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0 transition-colors sm:flex-row sm:items-center sm:gap-3 sm:px-5 ${
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
            {anomalies.map((anomaly) => {
              const Icon = getLucideIcon(anomaly.icon);
              const isNewMerchant = anomaly.rule_id === "NEW_MERCHANT";

              return (
                <span
                  key={anomaly.rule_id}
                  title={`${anomaly.title}: ${anomaly.description}`}
                  /* `bg-surface`, not the soft tint the row already wears — a
                     chip filled with its own background colour would dissolve
                     into the wash behind it. On the tinted row a plain surface
                     reads as raised, which is what a badge wants anyway. */
                  className={`inline-flex items-center gap-1.5 rounded-md border bg-surface px-2 py-0.5 text-[11px] font-medium shadow-2xs transition-transform hover:scale-105 ${
                    isNewMerchant
                      ? "border-accent/40 text-accent"
                      : "border-brand text-brand-ink"
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isNewMerchant ? "text-accent" : "text-brand-ink"
                    }`}
                  />
                  <span className="font-mono text-[10px] font-semibold">
                    {anomaly.rule_id}
                  </span>
                </span>
              );
            })}
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
          <span className="font-mono tabular-nums">{formatDay(row.bookedOn)}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{row.category}</span>
        </p>
      </div>

      <div className="hidden shrink-0 sm:block">
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11.5px] font-medium text-text-muted">
          {row.category}
        </span>
      </div>

      <div className="hidden w-[10ch] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-text-subtle sm:block">
        {formatDay(row.bookedOn)}
      </div>

      <div className="hidden w-[13ch] shrink-0 text-right sm:block">
        <Amount row={row} />
      </div>
    </li>
  );
}

export function TransactionList({
  rows,
  anomalies = [],
  page,
  pageCount,
  totalCount,
}: {
  /** Just the current page — at most `PAGE_SIZE` rows. */
  rows: Transaction[];
  anomalies?: AnomalyInsight[];
  page: number;
  pageCount: number;
  /** Rows across every page of the current filter, for the header count. */
  totalCount: number;
}) {
  // Index anomalies by transaction id for O(1) lookup
  const anomaliesByTxId = new Map<number, AnomalyInsight[]>();
  for (const a of anomalies) {
    for (const id of a.transaction_ids) {
      const list = anomaliesByTxId.get(id) ?? [];
      list.push(a);
      anomaliesByTxId.set(id, list);
    }
  }

  const flaggedInPage = rows.filter((r) => anomaliesByTxId.has(r.id)).length;

  return (
    /* `scroll-mt-20` clears the sticky h-16 header — without it, paging
       scrolls the card's top edge underneath the header. */
    <section
      id={LEDGER_ANCHOR_ID}
      className="card scroll-mt-20 overflow-hidden"
      aria-labelledby="ledger-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <h2 id="ledger-heading" className="text-[15px] font-semibold text-text">
            Transactions
          </h2>
          {flaggedInPage > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand bg-brand-soft px-2.5 py-0.5 text-[11px] font-medium text-brand-ink">
              <Sparkles className="h-3 w-3 text-brand-ink" />
              <span>{flaggedInPage} anomaly insights</span>
            </span>
          )}
        </div>
        <p className="font-mono text-[12px] tabular-nums text-text-muted">
          {totalCount.toLocaleString("de-CH")}{" "}
          {totalCount === 1 ? "line" : "lines"}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul>
          {rows.map((row) => (
            <TransactionRow
              key={row.id}
              row={row}
              anomalies={anomaliesByTxId.get(row.id) ?? []}
            />
          ))}
        </ul>
      )}

      {/* TransactionPagination reads useSearchParams, which needs a boundary
          it can suspend against. */}
      <Suspense fallback={null}>
        <TransactionPagination page={page} pageCount={pageCount} />
      </Suspense>
    </section>
  );
}
