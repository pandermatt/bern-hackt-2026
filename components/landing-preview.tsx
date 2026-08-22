"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EChart,
  slotColor,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import { categoryIcon } from "@/lib/category-icons";
import { formatMoney } from "@/lib/insights";
import {
  DEMO_BUDGET,
  DEMO_CATEGORIES,
  DEMO_FINDINGS,
  DEMO_MONTHS,
  demoTotals,
  type DemoFinding,
} from "@/lib/landing-demo";
import { useIsNarrow } from "@/lib/use-hydrated";

/**
 * The landing page's dashboard preview: four of the app's own charts, on the
 * invented figures in `lib/landing-demo.ts`.
 *
 * This replaced a mock — a stacked bar built from `div` widths, a list of four
 * made-up transactions, and three headline figures that did not add up to
 * either. The design notes already said what was wrong with that: *if a
 * preview advertises the dashboard, point it at `var(--chart-N)` so it cannot
 * drift from the real thing.* So this one draws through
 * `components/echart.tsx`, the app's single ECharts boundary, reads its
 * palette out of the cascade like every other chart, and shows the four
 * readings the four tabs actually offer:
 *
 * - **flow** — the month's net as bars off a zero line, the running balance as
 *   an ink line on a second, zero-aligned axis (`components/monthly-trend.tsx`).
 * - **categories** — the donut (`components/top-category-bars.tsx`).
 * - **budget** — spent against limit as two shapes over shared spokes
 *   (`components/budget-radar.tsx`).
 * - **anomalies** — a year of expenses as dots, four of them flagged.
 *
 * Simplified where the real charts earn their complexity from real data: the
 * flow bars are a plain `bar` series rather than the trend chart's per-column
 * `custom` renderer, and there is no year stepper over a single demo year.
 * What is *not* simplified is the accessibility contract — every view ships an
 * `aria-label` and an `sr-only` table of the same figures, because a chart
 * without its table is not finished, and because half the categorical ramp is
 * under 3:1 on white.
 */

const VIEWS = ["flow", "categories", "budget", "anomalies"] as const;
type View = (typeof VIEWS)[number];

/** One height for every view, so switching tabs never resizes the card. */
const HEIGHT = 300;
/** Symmetric gutters: the nets read on the left, the balance on the right. */
const GRID = { left: 54, right: 54, top: 26, bottom: 28 };
const GRID_NARROW = { left: 38, right: 38, top: 24, bottom: 26 };

/** Rounds a rappen amount up to a tidy gridline so the axis reads cleanly. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

/** Whole francs, grouped the Swiss way, with a real minus glyph. */
function francs(rappen: number): string {
  return Math.round(rappen / 100)
    .toLocaleString("de-CH")
    .replace("-", "−");
}

/** Unsigned `formatMoney` plus a real minus — the app-wide convention. */
function signedMoney(rappen: number): string {
  return `${rappen < 0 ? "−" : ""}${formatMoney(rappen)}`;
}

/**
 * The translated strings the option builders need. `useTranslations` is a
 * hook and an option builder is not a component — the same hand-off
 * `components/top-category-bars.tsx` makes.
 */
type PreviewText = {
  monthName: (index: number) => string;
  categoryName: (key: string) => string;
  netSeries: string;
  balanceSeries: string;
  spentSeries: string;
  limitSeries: string;
  ordinarySeries: string;
  flaggedSeries: string;
  wedgeTip: (amount: string, share: number) => string;
};

/** The tooltip chrome every view shares. The card's ground is `--surface`. */
function tooltipBase(tokens: ChartTokens) {
  return {
    confine: true,
    backgroundColor: tokens.surface,
    borderColor: tokens.line,
    textStyle: { color: tokens.text, fontSize: 12 },
  };
}

function buildFlowOption(
  tokens: ChartTokens,
  narrow: boolean,
  text: PreviewText,
): EChartsOption {
  const grid = narrow ? GRID_NARROW : GRID;
  const nets = DEMO_MONTHS.map((point) => point.net);
  const balances = DEMO_MONTHS.map((point) => point.balance);

  const peak = niceCeiling(Math.max(...nets) * 1.08);
  const lowest = Math.min(0, ...nets);
  const floor = lowest < 0 ? -niceCeiling(-lowest * 1.08) : 0;
  const balMax = niceCeiling(Math.max(...balances) * 1.08);
  const balLo = Math.min(0, ...balances);
  // Both axes give the same *fraction* of their range to the region below
  // zero, which is what puts the two zeros on one shared gridline — the whole
  // reason the line above the baseline can be read like a bar above it.
  const below = Math.max(
    floor < 0 ? -floor / peak : 0,
    balLo < 0 ? -balLo / balMax : 0,
  );

  return {
    animationDuration: 600,
    grid,
    tooltip: {
      ...tooltipBase(tokens),
      trigger: "axis",
      axisPointer: { type: "none" },
    },
    xAxis: {
      type: "category",
      data: DEMO_MONTHS.map((_, index) => text.monthName(index)),
      axisLine: {
        onZero: false,
        lineStyle: { color: withAlpha(tokens.ink, 0.35) },
      },
      axisTick: { show: false },
      axisLabel: {
        color: tokens.ink,
        fontSize: 11,
        interval: narrow ? 1 : 0,
      },
    },
    yAxis: [
      {
        type: "value",
        max: peak,
        min: -Math.round(below * peak),
        axisLabel: {
          color: withAlpha(tokens.ink, 0.75),
          fontSize: 10,
          formatter: francs,
        },
        splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
      },
      // The balance's own axis. No gridlines — two rulers' worth of lines in
      // one plot read as noise.
      {
        type: "value",
        position: "right",
        max: balMax,
        min: -Math.round(below * balMax),
        axisLabel: {
          color: withAlpha(tokens.ink, 0.75),
          fontSize: 10,
          formatter: (value: number) => (value < 0 ? "" : francs(value)),
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        id: "net",
        name: text.netSeries,
        type: "bar",
        barWidth: narrow ? 12 : 22,
        tooltip: { valueFormatter: (value) => signedMoney(Number(value)) },
        data: DEMO_MONTHS.map((point) => ({
          value: point.net,
          itemStyle:
            point.net >= 0
              ? {
                  // Pistachio is 2:1 on white: a fill of it needs its edge to
                  // be perceptible at all.
                  color: tokens.flowIn,
                  borderColor: tokens.flowInEdge,
                  borderWidth: 1,
                  borderRadius: [4, 4, 0, 0] as [number, number, number, number],
                }
              : {
                  color: tokens.flowOut,
                  borderRadius: [0, 0, 4, 4] as [number, number, number, number],
                },
        })),
        markLine: {
          silent: true,
          symbol: "none",
          animation: false,
          label: { show: false },
          lineStyle: { color: withAlpha(tokens.ink, 0.45), width: 1 },
          data: [{ yAxis: 0 }],
        },
      },
      {
        id: "balance",
        name: text.balanceSeries,
        type: "line",
        yAxisIndex: 1,
        smooth: false,
        symbol: "circle",
        symbolSize: 5,
        tooltip: { valueFormatter: (value) => signedMoney(Number(value)) },
        // Ink, the palette's annotation role: a balance is neither a category
        // nor a direction, and it is the only line in the plot.
        lineStyle: { color: withAlpha(tokens.ink, 0.8), width: 2 },
        itemStyle: { color: tokens.ink },
        data: balances,
      },
    ],
  };
}

function buildCategoriesOption(
  tokens: ChartTokens,
  narrow: boolean,
  text: PreviewText,
): EChartsOption {
  const total = DEMO_CATEGORIES.reduce((sum, entry) => sum + entry.total, 0);

  return {
    animationDuration: 600,
    tooltip: {
      ...tooltipBase(tokens),
      trigger: "item",
      formatter: (params: unknown) => {
        const point = params as { name: string; value: number };
        const share = total > 0 ? Math.round((point.value / total) * 100) : 0;
        return `${categoryIcon(point.name)} ${text.categoryName(point.name)}<br/>${text.wedgeTip(
          formatMoney(point.value),
          share,
        )}`;
      },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      icon: "roundRect",
      itemWidth: 9,
      itemHeight: 9,
      itemGap: 10,
      textStyle: { color: tokens.textMuted, fontSize: 11 },
      pageIconColor: tokens.textMuted,
      pageIconInactiveColor: tokens.line,
      pageTextStyle: { color: tokens.textSubtle },
      // The legend's names are the raw category keys — they have to be, they
      // key the slot map and the icon lookup — so only the label is translated.
      formatter: (name: string) => text.categoryName(name),
    },
    series: [
      {
        type: "pie",
        radius: ["52%", "72%"] as [string, string],
        center: ["50%", "42%"] as [string, string],
        padAngle: 2,
        itemStyle: {
          borderRadius: 5,
          // The preview card's ground, not the dashboard's grey panel: a wedge
          // border filled with the wrong ground disappears.
          borderColor: tokens.surface,
          borderWidth: 1,
        },
        label: {
          show: !narrow,
          color: tokens.ink,
          fontSize: 11,
          // Icon and share only — language-neutral by construction; the legend
          // below carries the names.
          formatter: (params) => {
            const point = params as { name: string; percent?: number };
            return `${categoryIcon(point.name)} ${(point.percent ?? 0).toFixed(0)}%`;
          },
        },
        labelLine: {
          length: 8,
          length2: 10,
          lineStyle: { color: withAlpha(tokens.ink, 0.4) },
        },
        labelLayout: { hideOverlap: true },
        emphasis: { scaleSize: 6 },
        data: DEMO_CATEGORIES.map((entry) => ({
          name: entry.key,
          value: entry.total,
          itemStyle: { color: slotColor(tokens, entry.slot) },
        })),
      },
    ],
  };
}

function buildBudgetOption(
  tokens: ChartTokens,
  narrow: boolean,
  text: PreviewText,
): EChartsOption {
  // One scale for every spoke, so a spoke reaching further out really is more
  // money — the reading the radar exists for.
  const max = niceCeiling(
    Math.max(...DEMO_BUDGET.flatMap((row) => [row.usedMinor, row.limitMinor])) *
      1.05,
  );

  return {
    animationDuration: 600,
    tooltip: {
      ...tooltipBase(tokens),
      trigger: "item",
    },
    legend: {
      bottom: 0,
      icon: "roundRect",
      itemWidth: 9,
      itemHeight: 9,
      itemGap: 14,
      textStyle: { color: tokens.textMuted, fontSize: 11 },
    },
    radar: {
      center: ["50%", "46%"] as [string, string],
      radius: narrow ? "52%" : "56%",
      // The spoke's own name is the category key, so the formatter below can
      // look the row back up from it.
      indicator: DEMO_BUDGET.map((row) => ({ name: row.key, max })),
      axisName: {
        /*
         * Category on top, its share of the limit underneath — the same two
         * lines `components/budget-radar.tsx` draws, and for the same reason:
         * a spoke's radius is a length nobody measures by eye, so the verdict
         * has to be printed. On a phone the name comes off and the icon
         * carries the identity; the table under the chart carries the words
         * either way.
         *
         * One rich token per line: a `\n` *inside* a token is not a line
         * break.
         */
        formatter: (name?: string) => {
          const row = DEMO_BUDGET.find((entry) => entry.key === name);
          if (!row) return name ?? "";
          const percent = Math.round((row.usedMinor / row.limitMinor) * 100);
          const label = narrow
            ? categoryIcon(row.key)
            : `${categoryIcon(row.key)} ${text.categoryName(row.key)}`;
          const verdict = row.usedMinor > row.limitMinor ? "over" : "under";
          return `{name|${label}}\n{${verdict}|${percent}%}`;
        },
        rich: {
          name: {
            color: tokens.ink,
            fontSize: narrow ? 10 : 11.5,
            lineHeight: (narrow ? 10 : 11.5) + 5,
          },
          // `--danger` and `--accent`, not the chart fills: these are 11px
          // glyphs, and half the ramp is under 3:1 as type.
          over: {
            color: tokens.danger,
            fontSize: narrow ? 10 : 11.5,
            fontWeight: 600,
            lineHeight: (narrow ? 10 : 11.5) + 5,
          },
          under: {
            color: tokens.accent,
            fontSize: narrow ? 10 : 11.5,
            fontWeight: 600,
            lineHeight: (narrow ? 10 : 11.5) + 5,
          },
        },
      },
      axisLabel: { show: false },
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.12) } },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.14) } },
      splitArea: { show: false },
    },
    series: [
      {
        type: "radar",
        symbol: "circle",
        symbolSize: 6,
        data: [
          {
            name: text.spentSeries,
            value: DEMO_BUDGET.map((row) => row.usedMinor),
            // A series colour, not `--flow-in`: both shapes here are spending,
            // so nothing on this chart encodes direction.
            areaStyle: { color: withAlpha(tokens.series[1], 0.22) },
            lineStyle: { width: 2.5, color: tokens.series[1] },
            itemStyle: { color: tokens.series[1] },
          },
          {
            name: text.limitSeries,
            value: DEMO_BUDGET.map((row) => row.limitMinor),
            // A threshold, not a quantity: outline only, no `areaStyle`.
            lineStyle: {
              width: 2.5,
              color: tokens.accent,
              type: [7, 5] as number[],
            },
            itemStyle: { color: tokens.accent },
          },
        ],
      },
    ],
  };
}

/**
 * Where a dot sits inside its month.
 *
 * Deterministic, not random: a scatter re-rolled on every render would crawl
 * under the reader's cursor, and a seeded generator is more machinery than
 * spreading fifty dots deserves. The month index plus a stable offset from the
 * dot's position in the list is enough to keep a month's dots from stacking
 * into one vertical line.
 */
function jitter(index: number): number {
  return (((index * 7) % 9) - 4) / 11;
}

function buildAnomaliesOption(
  tokens: ChartTokens,
  narrow: boolean,
  text: PreviewText,
): EChartsOption {
  const grid = narrow
    ? { ...GRID_NARROW, right: 12 }
    : { ...GRID, right: 16 };
  const max = niceCeiling(
    Math.max(...DEMO_FINDINGS.map((finding) => finding.amountMinor)) * 1.08,
  );

  const dot = (finding: DemoFinding, index: number) => [
    finding.month - 0.5 + jitter(index),
    finding.amountMinor,
  ];

  const flagged = DEMO_FINDINGS.map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding.kind !== "none")
    .map(({ finding, index }) => ({
      value: dot(finding, index),
      itemStyle: {
        // The engine's `kind` axis, minus the yellow: `--brand` is 1.5:1 on
        // white, and a mark that has to be told apart from its neighbours
        // cannot be drawn in it.
        color: finding.kind === "alert" ? tokens.danger : tokens.accent,
      },
    }));

  return {
    animationDuration: 600,
    grid,
    tooltip: {
      ...tooltipBase(tokens),
      trigger: "item",
      formatter: (params: unknown) => {
        const point = params as { value: [number, number]; seriesName: string };
        const month = text.monthName(
          Math.min(11, Math.max(0, Math.round(point.value[0] - 0.5))),
        );
        return `${month}<br/>${point.seriesName}: ${formatMoney(point.value[1])}`;
      },
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 12,
      interval: 1,
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      axisTick: { show: false },
      axisLabel: {
        color: tokens.ink,
        fontSize: 11,
        // The tick sits on the month boundary; the label names the month that
        // follows it, which is where that month's dots are.
        formatter: (value: number) =>
          value >= 12 || (narrow && value % 2 === 1)
            ? ""
            : text.monthName(value),
        align: "left",
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      max,
      axisLabel: {
        color: withAlpha(tokens.ink, 0.75),
        fontSize: 10,
        formatter: francs,
      },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
    },
    series: [
      {
        id: "ordinary",
        name: text.ordinarySeries,
        type: "scatter",
        symbolSize: 8,
        itemStyle: { color: withAlpha(tokens.ink, 0.3) },
        data: DEMO_FINDINGS.flatMap((finding, index) =>
          finding.kind === "none" ? [dot(finding, index)] : [],
        ),
      },
      {
        id: "flagged",
        name: text.flaggedSeries,
        type: "scatter",
        symbolSize: 14,
        emphasis: { scale: 1.3 },
        data: flagged,
      },
    ],
  };
}

export function LandingPreview() {
  const t = useTranslations("Landing");
  const tMonths = useTranslations("Months");
  const tCategories = useTranslations("Categories");
  const tokens = useChartTokens();
  const narrow = useIsNarrow();

  const [view, setView] = useState<View>("flow");
  /** The flow chart's hovered month — what the three tiles report. */
  const [hovered, setHovered] = useState<number | null>(null);
  /** The anomalies view's clicked dot, as an index into `DEMO_FINDINGS`. */
  const [pinned, setPinned] = useState<number | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const text = useMemo<PreviewText>(
    () => ({
      monthName: (index) => tMonths(`short${index + 1}`),
      // The ledger's fallback idiom: an unknown key renders raw rather than
      // throwing a missing-message error.
      categoryName: (key) => (tCategories.has(key) ? tCategories(key) : key),
      netSeries: t("previewNetSeries"),
      balanceSeries: t("previewBalanceSeries"),
      spentSeries: t("previewSpentSeries"),
      limitSeries: t("previewLimitSeries"),
      ordinarySeries: t("previewOrdinarySeries"),
      flaggedSeries: t("previewFlaggedSeries"),
      wedgeTip: (amount, share) => t("previewWedgeTip", { amount, share }),
    }),
    [t, tMonths, tCategories],
  );

  const option = useMemo(() => {
    if (!tokens) return null;
    if (view === "flow") return buildFlowOption(tokens, narrow, text);
    if (view === "categories") return buildCategoriesOption(tokens, narrow, text);
    if (view === "budget") return buildBudgetOption(tokens, narrow, text);
    return buildAnomaliesOption(tokens, narrow, text);
  }, [tokens, narrow, view, text]);

  // A fresh object each render is fine and deliberate: `EChart` reads the
  // event *names* once at init and looks the handlers up through a ref, so
  // these may close over this render's `view` without re-binding anything.
  const events = {
    mouseover: (params: unknown) => {
      if (view !== "flow") return;
      if (clearTimer.current) clearTimeout(clearTimer.current);
      const point = params as { componentType?: string; dataIndex?: number };
      if (point.componentType === "series" && typeof point.dataIndex === "number") {
        setHovered(point.dataIndex);
      }
    },
    // Sweeping across a bar's edge fires mouseout-then-mouseover; clearing on
    // a short delay keeps the tiles from flickering back to the year total
    // between two neighbouring columns.
    mouseout: () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setHovered(null), 140);
    },
    globalout: () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setHovered(null);
    },
    click: (params: unknown) => {
      if (view !== "anomalies") return;
      const point = params as { seriesId?: string; dataIndex?: number };
      if (point.seriesId !== "flagged" || typeof point.dataIndex !== "number") {
        return;
      }
      const flagged = DEMO_FINDINGS.map((finding, index) => ({ finding, index }))
        .filter(({ finding }) => finding.kind !== "none")
        .map(({ index }) => index);
      setPinned(flagged[point.dataIndex] ?? null);
    },
  };

  const year = demoTotals();
  const month = hovered !== null && view === "flow" ? DEMO_MONTHS[hovered] : null;
  const shown = month ?? year;
  const period = month
    ? t("previewPeriodMonth", { month: text.monthName(hovered ?? 0) })
    : t("previewPeriodYear");

  const pinnedFinding = pinned !== null ? DEMO_FINDINGS[pinned] : null;
  const caption = pinnedFinding?.captionKey
    ? t(pinnedFinding.captionKey)
    : t(
        view === "flow"
          ? "previewFlowHint"
          : view === "categories"
            ? "previewCategoriesHint"
            : view === "budget"
              ? "previewBudgetHint"
              : "previewAnomaliesHint",
      );

  const chartLabel = t(
    view === "flow"
      ? "previewFlowLabel"
      : view === "categories"
        ? "previewCategoriesLabel"
        : view === "budget"
          ? "previewBudgetLabel"
          : "previewAnomaliesLabel",
  );

  const pill = (active: boolean) =>
    `h-8 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-text"
    }`;

  const tile = (label: string, value: string, tone: string) => (
    <div key={label} className="rounded-xl border border-line/80 bg-surface p-3.5 shadow-2xs sm:p-4">
      <span className="text-[11px] font-medium tracking-[0.08em] text-text-subtle uppercase">
        {label}
      </span>
      <p className={`mt-1 font-mono text-lg font-bold tabular-nums sm:text-xl ${tone}`}>
        {value}
      </p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-line/90 bg-surface-hover/70 p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xs sm:p-7">
      {/* Window chrome. Decorative, and it says so — the three lights are not
          controls and carry no meaning a reader has to catch. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/80 pb-4">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="flex size-3 rounded-full bg-danger/80" />
          <span aria-hidden className="flex size-3 rounded-full bg-brand/80" />
          <span aria-hidden className="flex size-3 rounded-full bg-positive/80" />
          <span className="ml-2 font-mono text-xs font-medium text-text-subtle">
            {t("previewFile")}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-line/60 bg-surface px-3 py-1 text-xs font-semibold text-text-muted shadow-2xs">
          <Wallet className="size-3.5 text-accent" aria-hidden />
          <span>{t("previewCurrency")}</span>
        </div>
      </div>

      {/* The view switch — the same pill idiom the dashboard's own chart
          controls wear, so the preview looks like the thing it advertises. */}
      <div
        role="group"
        aria-label={t("previewViewAria")}
        className="mt-4 flex flex-wrap gap-0.5 rounded-2xl border border-line-strong bg-surface p-0.5 sm:w-fit sm:rounded-full"
      >
        {VIEWS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => {
              setHovered(null);
              setPinned(null);
              setView(key);
            }}
            className={pill(view === key)}
          >
            {t(`previewTab${key[0].toUpperCase()}${key.slice(1)}`)}
          </button>
        ))}
      </div>

      {/* Three figures for the whole demo year — or for one month, while a
          column of the flow chart is under the cursor.

          No `aria-live` on this line, unlike the caption below: it changes on
          every mouse *hover*, and a live region that fires per column is a
          screen reader talking over itself. The sr-only table carries the
          figures either way. */}
      <p className="mt-4 text-[11.5px] font-medium text-text-subtle">{period}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {tile(t("previewInflow"), `+ ${formatMoney(shown.income)}`, "text-positive")}
        {tile(t("previewSpending"), `− ${formatMoney(shown.expense)}`, "text-text")}
        {tile(
          t("previewNet"),
          `${shown.net < 0 ? "−" : "+"} ${formatMoney(shown.net)}`,
          shown.net < 0 ? "text-danger" : "text-accent",
        )}
      </div>

      <div className="mt-4 rounded-xl border border-line/80 bg-surface p-3 shadow-2xs sm:p-4">
        <EChart
          option={option}
          height={HEIGHT}
          onEvents={events}
          label={chartLabel}
        />

        {/* The same figures, for screen readers, for JS-off, and for anyone
            the canvas fails — and the relief the palette's sub-3:1 fills
            require. No <caption>: the caption box escapes `sr-only`'s clip. */}
        <div className="sr-only">
          {view === "flow" && (
            <table aria-label={chartLabel}>
              <thead>
                <tr>
                  <th scope="col">{t("previewMonth")}</th>
                  <th scope="col">{t("previewNetSeries")}</th>
                  <th scope="col">{t("previewBalanceSeries")}</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_MONTHS.map((point, index) => (
                  <tr key={point.month}>
                    <th scope="row">{text.monthName(index)}</th>
                    <td>{signedMoney(point.net)}</td>
                    <td>{signedMoney(point.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {view === "categories" && (
            <table aria-label={chartLabel}>
              <thead>
                <tr>
                  <th scope="col">{t("previewCategory")}</th>
                  <th scope="col">{t("previewAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_CATEGORIES.map((entry) => (
                  <tr key={entry.key}>
                    <th scope="row">{text.categoryName(entry.key)}</th>
                    <td>{formatMoney(entry.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {view === "budget" && (
            <table aria-label={chartLabel}>
              <thead>
                <tr>
                  <th scope="col">{t("previewCategory")}</th>
                  <th scope="col">{t("previewSpentSeries")}</th>
                  <th scope="col">{t("previewLimitSeries")}</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_BUDGET.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{text.categoryName(row.key)}</th>
                    <td>{formatMoney(row.usedMinor)}</td>
                    <td>{formatMoney(row.limitMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {view === "anomalies" && (
            <table aria-label={chartLabel}>
              <thead>
                <tr>
                  <th scope="col">{t("previewMonth")}</th>
                  <th scope="col">{t("previewAmount")}</th>
                  <th scope="col">{t("previewKind")}</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_FINDINGS.map((finding, index) => (
                  <tr key={`${finding.month}-${index}`}>
                    <th scope="row">{text.monthName(finding.month - 1)}</th>
                    <td>{formatMoney(finding.amountMinor)}</td>
                    <td>
                      {finding.captionKey
                        ? t(finding.captionKey)
                        : t("previewKindNone")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* What to try, or — once a flagged dot has been clicked — what the scan
          would have said about it. */}
      <p className="mt-3 font-mono text-[11.5px] text-text-subtle" aria-live="polite">
        {caption}
      </p>
      <p className="mt-1 text-[11.5px] text-text-subtle">{t("previewDemoNote")}</p>
    </div>
  );
}
