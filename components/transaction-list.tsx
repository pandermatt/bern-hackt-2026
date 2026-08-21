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

function TransactionRow({
  row,
  anomalies = [],
}: {
  row: Transaction;
  anomalies?: AnomalyInsight[];
}) {
  const inflow = row.amountMinor > 0;
  const foreign = row.currency !== "CHF";
  const hasAnomaly = anomalies.length > 0;
  const isOnlyNewMerchant =
    hasAnomaly && anomalies.every((a) => a.rule_id === "NEW_MERCHANT");

  // Row gradient: Light blue for NEW_MERCHANT; theme yellow (#ffcc00) for other anomalies
  const anomalyRowClasses = isOnlyNewMerchant
    ? "bg-[linear-gradient(90deg,rgba(224,242,254,0.75)_0%,rgba(224,242,254,0.40)_25%,rgba(224,242,254,0)_50%)] hover:bg-[linear-gradient(90deg,rgba(224,242,254,0.90)_0%,rgba(224,242,254,0.55)_25%,rgba(224,242,254,0.05)_60%)] border-l-4 border-l-sky-400"
    : "bg-[linear-gradient(90deg,rgba(255,204,0,0.30)_0%,rgba(255,204,0,0.18)_25%,rgba(255,204,0,0)_50%)] hover:bg-[linear-gradient(90deg,rgba(255,204,0,0.40)_0%,rgba(255,204,0,0.24)_25%,rgba(255,204,0,0.04)_60%)] border-l-4 border-l-[#ffcc00]";

  return (
    <li
      className={`flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 transition-colors sm:px-5 ${
        hasAnomaly ? anomalyRowClasses : "hover:bg-surface-hover"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[14px] font-medium text-text">
            {row.merchant}
          </p>

          {/* Anomaly Lucide Icons & Badges */}
          {anomalies.map((anomaly) => {
            const Icon = getLucideIcon(anomaly.icon);
            const isNewMerchant = anomaly.rule_id === "NEW_MERCHANT";

            return (
              <span
                key={anomaly.rule_id}
                title={`${anomaly.title}: ${anomaly.description}`}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium shadow-2xs transition-transform hover:scale-105 ${
                  isNewMerchant
                    ? "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                    : "border-[#ffcc00] bg-[#fff9db] text-[#5c4700]"
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isNewMerchant ? "text-sky-600 dark:text-sky-400" : "text-[#8c6b00]"
                  }`}
                />
                <span className="font-mono text-[10px] font-semibold">
                  {anomaly.rule_id}
                </span>
              </span>
            );
          })}
        </div>

        <p className="mt-0.5 truncate text-[12.5px] text-text-muted">
          {row.description}
        </p>

        {/* Anomaly Highlight Note */}
        {hasAnomaly && (
          <p
            className={`mt-0.5 text-[11.5px] font-medium leading-tight ${
              isOnlyNewMerchant
                ? "text-sky-700 dark:text-sky-400"
                : "text-[#805d00]"
            }`}
          >
            {anomalies[0].description}
          </p>
        )}
      </div>

      <div className="hidden shrink-0 sm:block">
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11.5px] font-medium text-text-muted">
          {row.category}
        </span>
      </div>

      <div className="w-[10ch] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-text-subtle">
        {formatDay(row.bookedOn)}
      </div>

      <div className="w-[13ch] shrink-0 text-right">
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ffcc00] bg-[#fff9db] px-2.5 py-0.5 text-[11px] font-medium text-[#664d00]">
              <Sparkles className="h-3 w-3 text-[#997300]" />
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
