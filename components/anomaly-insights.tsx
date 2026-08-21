"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUp,
  Banknote,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronUp,
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
  ShieldAlert,
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

import type { AnomalyInsight, AnomalySeverity } from "@/lib/anomaly-engine";

const ICON_MAP: Record<string, LucideIcon> = {
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

function getIconComponent(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? AlertTriangle;
}

const SEVERITY_STYLES: Record<
  AnomalySeverity,
  { badge: string; border: string; bg: string; iconColor: string }
> = {
  high: {
    badge: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
    border: "border-red-200 dark:border-red-900/50",
    bg: "bg-red-50/40 dark:bg-red-950/10",
    iconColor: "text-red-600 dark:text-red-400",
  },
  medium: {
    badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    border: "border-amber-200 dark:border-amber-900/50",
    bg: "bg-amber-50/40 dark:bg-amber-950/10",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  low: {
    badge: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    border: "border-slate-200 dark:border-slate-800",
    bg: "bg-slate-50/40 dark:bg-slate-900/20",
    iconColor: "text-slate-600 dark:text-slate-400",
  },
};

export function AnomalyInsightsSection({
  anomalies,
}: {
  anomalies: AnomalyInsight[];
}) {
  const [filterSeverity, setFilterSeverity] = useState<"all" | AnomalySeverity>("all");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const filteredAnomalies = useMemo(() => {
    if (filterSeverity === "all") return anomalies;
    return anomalies.filter((a) => a.severity === filterSeverity);
  }, [anomalies, filterSeverity]);

  const counts = useMemo(() => {
    return {
      total: anomalies.length,
      high: anomalies.filter((a) => a.severity === "high").length,
      medium: anomalies.filter((a) => a.severity === "medium").length,
      low: anomalies.filter((a) => a.severity === "low").length,
    };
  }, [anomalies]);

  if (!anomalies || anomalies.length === 0) {
    return (
      <div className="card p-5 border border-dashed border-border/80">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-text">
              Statistical Anomaly Engine
            </h2>
            <p className="text-[13px] text-text-muted">
              No statistical anomalies or behavioral deviations detected in the current transaction set.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="card p-5 space-y-4" aria-labelledby="anomalies-heading">
      {/* Header & Filter Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 id="anomalies-heading" className="text-[16px] font-semibold text-text">
                Deterministic Anomaly Detection
              </h2>
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {counts.total} Insights
              </span>
            </div>
            <p className="text-[12.5px] text-text-muted">
              Mathematical deviations computed against your historical transaction baselines (MAD, percentiles & intervals).
            </p>
          </div>
        </div>

        {/* Severity Filter Pills */}
        <div className="flex items-center gap-1.5 self-start sm:self-center">
          <button
            type="button"
            onClick={() => setFilterSeverity("all")}
            className={`cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
              filterSeverity === "all"
                ? "bg-text text-bg font-semibold"
                : "bg-surface text-text-muted hover:text-text hover:bg-surface-hover"
            }`}
          >
            All ({counts.total})
          </button>
          {counts.high > 0 && (
            <button
              type="button"
              onClick={() => setFilterSeverity("high")}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                filterSeverity === "high"
                  ? "bg-red-600 text-white font-semibold"
                  : "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300"
              }`}
            >
              High ({counts.high})
            </button>
          )}
          {counts.medium > 0 && (
            <button
              type="button"
              onClick={() => setFilterSeverity("medium")}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                filterSeverity === "medium"
                  ? "bg-amber-600 text-white font-semibold"
                  : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
              }`}
            >
              Medium ({counts.medium})
            </button>
          )}
          {counts.low > 0 && (
            <button
              type="button"
              onClick={() => setFilterSeverity("low")}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                filterSeverity === "low"
                  ? "bg-slate-700 text-white font-semibold dark:bg-slate-200 dark:text-slate-900"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              Low ({counts.low})
            </button>
          )}
        </div>
      </div>

      {/* Anomalies List */}
      <div className="grid gap-2.5 sm:grid-cols-1">
        {filteredAnomalies.map((insight, idx) => {
          const Icon = getIconComponent(insight.icon);
          const style = SEVERITY_STYLES[insight.severity];
          const isExpanded = expandedIndex === idx;

          return (
            <div
              key={`${insight.rule_id}-${idx}`}
              className={`rounded-lg border transition-all ${style.border} ${style.bg} p-3.5`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white shadow-xs dark:bg-slate-800 ${style.iconColor}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[13.5px] text-text">
                        {insight.title}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider ${style.badge}`}
                      >
                        {insight.severity}
                      </span>
                      <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[10.5px] text-text-subtle dark:bg-white/10">
                        {insight.rule_id}
                      </code>
                    </div>

                    <p className="text-[13px] leading-snug text-text">
                      {insight.description}
                    </p>
                  </div>
                </div>

                {/* Toggle Details Button */}
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                  className="cursor-pointer inline-flex items-center gap-1 rounded px-2 py-1 text-[11.5px] font-medium text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                  aria-expanded={isExpanded}
                >
                  <span>{isExpanded ? "Hide data" : "Evidence"}</span>
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {/* Supporting Numerical Metrics Panel */}
              {isExpanded && (
                <div className="mt-3 border-t border-black/5 pt-2.5 dark:border-white/5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle mb-1.5">
                    Deterministic Supporting Metrics & Proof
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {Object.entries(insight.supporting_metrics).map(([key, val]) => (
                      <div
                        key={key}
                        className="rounded bg-white/70 p-2 text-[12px] shadow-2xs dark:bg-slate-900/60"
                      >
                        <span className="block font-mono text-[10.5px] text-text-subtle truncate">
                          {key}
                        </span>
                        <span className="font-mono font-medium text-text tabular-nums">
                          {typeof val === "object" ? JSON.stringify(val) : String(val)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {insight.transaction_ids.length > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-text-muted">
                      <ArrowDownRight className="h-3.5 w-3.5" />
                      <span>
                        Referenced Transaction IDs:{" "}
                        <strong className="font-mono text-text">
                          {insight.transaction_ids.join(", ")}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
