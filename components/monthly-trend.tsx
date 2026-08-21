"use client";

import { useMemo } from "react";

import {
  EChart,
  inkOn,
  slotColor,
  tooltipStyle,
  useChartTokens,
  withAlpha,
  type ChartSize,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import {
  formatMoney,
  type CategoryStack,
  type MonthPoint,
} from "@/lib/insights";

/**
 * Where the money went, month by month — a stacked bar with the "variation"
 * ribbons from ECharts' stacked-bar example.
 *
 * Bars carry **actual francs**, not shares, so a column's height is that
 * month's spending and September's spike is visible as a spike. The ribbons
 * between columns join each band's segment to the next month's, so a category
 * widening or narrowing over the year is a shape rather than a comparison you
 * have to do by eye.
 *
 * Bands are expenses only: a stack has to sum to something meaningful, and
 * income stacked on spending sums to nothing. The paired-bar chart two
 * revisions back also carried money *in* and the monthly net, so those columns
 * stay in the data table — `series` exists for no other reason.
 */

const HEIGHT = 360;

/**
 * Explicit numeric insets, and **no `containLabel`**. The variation ribbons are
 * `graphic` elements positioned in pixel space off these numbers, so the grid
 * has to be somewhere this file can compute; `containLabel` resolves the plot
 * box after layout and would slide the bars out from under them. `left` is cut
 * for a five-figure franc tick, `bottom` for the month labels plus the legend.
 */
const GRID = { left: 58, right: 14, top: 14, bottom: 54 };

/**
 * A segment shorter than this share of the plot is thinner than its own label.
 * Measured against the axis maximum, not the column — on an unnormalized chart
 * a category can be 90% of a quiet month and still be a sliver.
 */
const LABEL_THRESHOLD = 0.05;

/**
 * Rounds a rappen amount up to a tidy gridline.
 *
 * The axis maximum has to be pinned rather than left to ECharts, because the
 * ribbons are drawn in pixel space and can only line up with the bars if this
 * file and the axis agree on the scale.
 */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

function buildOption(
  stack: CategoryStack,
  tokens: ChartTokens,
  size: ChartSize,
): EChartsOption {
  const { months, labels, bands } = stack;

  const totals = months.map((_, index) =>
    bands.reduce((sum, band) => sum + (band.values[index] ?? 0), 0),
  );
  // The tallest column decides the scale, for the axis and the ribbons alike.
  const yMax = niceCeiling(Math.max(1, ...totals));
  /** A value as a fraction of the plot height — the ribbons' only geometry. */
  const fractionOf = (band: (typeof bands)[number], index: number) =>
    (band.values[index] ?? 0) / yMax;

  // ── the variation ribbons ──
  // Same construction as the ECharts example: for each gap between columns,
  // walk the stack from the baseline up and emit one polygon per band joining
  // its left edge to its right edge.
  const gridWidth = size.width - GRID.left - GRID.right;
  const gridHeight = size.height - GRID.top - GRID.bottom;
  const categoryWidth = gridWidth / Math.max(1, months.length);
  const barPadding = (categoryWidth - categoryWidth * 0.6) / 2;

  const elements =
    gridWidth > 0 && gridHeight > 0
      ? months.flatMap((_, column) => {
          if (column === 0) return [];
          const leftX = GRID.left + categoryWidth * column - barPadding;
          const rightX = leftX + barPadding * 2;
          let leftY = GRID.top + gridHeight;
          let rightY = leftY;

          return bands.map((band) => {
            const leftHeight = fractionOf(band, column - 1) * gridHeight;
            const rightHeight = fractionOf(band, column) * gridHeight;
            const points = [
              [leftX, leftY],
              [leftX, leftY - leftHeight],
              [rightX, rightY - rightHeight],
              [rightX, rightY],
              [leftX, leftY],
            ];
            leftY -= leftHeight;
            rightY -= rightHeight;
            return {
              type: "polygon" as const,
              // Decoration over the bars, and never a hit target — hovering
              // one would otherwise swallow the axis tooltip.
              silent: true,
              shape: { points },
              style: { fill: withAlpha(slotColor(tokens, band.slot), 0.25) },
            };
          });
        })
      : [];

  return {
    animationDuration: 600,
    grid: GRID,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: withAlpha(tokens.ink, 0.08) } },
      ...tooltipStyle(tokens),
      // Francs lead, because that is what the bar now measures; the share of
      // the month stays as context, which the bar height no longer gives.
      formatter: (params) => {
        const rows = Array.isArray(params) ? params : [params];
        const index = rows[0]?.dataIndex ?? 0;
        const head = `${months[index]} · ${formatMoney(totals[index] ?? 0)}`;
        const body = rows
          .slice()
          .reverse()
          .map((row) => {
            const band = bands.find((candidate) => candidate.key === row.seriesName);
            const amount = band?.values[index] ?? 0;
            if (amount <= 0) return "";
            const total = totals[index] ?? 0;
            const pct = total > 0 ? ((amount / total) * 100).toFixed(1) : "0.0";
            return `${row.marker}${row.seriesName}<span style="float:right;padding-left:18px"><strong>${formatMoney(amount)}</strong> · ${pct}%</span><br/>`;
          })
          .join("");
        return `${head}<br/>${body}`;
      },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      // The ribbons are precomputed pixel geometry over every band, and
      // ECharts does not re-run the builder on a legend toggle — hiding a
      // series would leave its ribbon painted over the bars that no longer
      // include it. So the legend is a key here, not a filter.
      selectedMode: false,
      textStyle: { color: tokens.textMuted, fontSize: 12 },
      pageIconColor: tokens.textMuted,
      pageIconInactiveColor: tokens.line,
      pageTextStyle: { color: tokens.textSubtle },
    },
    xAxis: {
      type: "category",
      data: [...labels],
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      axisTick: { show: false },
      // The palette's dark neutral in its stated role, rather than the app ink.
      axisLabel: { color: tokens.ink, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      // Pinned, not auto: the ribbons are drawn from this same number, and an
      // axis that picked its own maximum would slide out from under them.
      max: yMax,
      axisLabel: {
        color: withAlpha(tokens.ink, 0.75),
        fontSize: 10,
        // Francs, not rappen, and no currency prefix — the footnote says CHF
        // once and five digits per tick is enough.
        formatter: (value: number) =>
          Math.round(value / 100).toLocaleString("de-CH"),
      },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
    },
    series: bands.map((band) => {
      const fill = slotColor(tokens, band.slot);
      return {
      name: band.key,
      type: "bar" as const,
      stack: "total",
      barWidth: "60%",
      itemStyle: { color: fill },
      label: {
        show: true,
        // Chosen from the fill's luminance, not fixed: this ramp runs from
        // Primary teal to Soft yellow, and one ink cannot cover both ends.
        color: inkOn(fill),
        fontSize: 10,
        // Selective, not on every segment — most of the ten are a few pixels
        // tall in any given month.
        formatter: (params: { value?: unknown }) => {
          const value = Number(params.value) || 0;
          return value / yMax >= LABEL_THRESHOLD
            ? Math.round(value / 100).toLocaleString("de-CH")
            : "";
        },
      },
      data: months.map((_, index) => band.values[index] ?? 0),
      };
    }),
    graphic: { elements },
  };
}

export function MonthlyTrend({
  stack,
  series,
}: {
  stack: CategoryStack;
  /** Same months as `stack`, carrying the figures the bands cannot show. */
  series: MonthPoint[];
}) {
  const tokens = useChartTokens();
  // A builder rather than an option: the ribbons need the canvas's pixel size,
  // and `EChart` re-runs this on every resize.
  const option = useMemo(
    () =>
      tokens ? (size: ChartSize) => buildOption(stack, tokens, size) : null,
    [stack, tokens],
  );
  const byMonth = useMemo(
    () => new Map(series.map((point) => [point.month, point])),
    [series],
  );

  if (stack.bands.length === 0) return null;

  return (
    <section className="card p-5" aria-labelledby="trend-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="trend-heading" className="text-[15px] font-semibold text-text">
          Month by month
        </h2>
        <p className="text-[12.5px] text-text-muted">
          Spending by category, stacked
        </p>
      </div>

      <div className="mt-4">
        <EChart
          option={option}
          height={HEIGHT}
          label={`Spending in Swiss francs by category for each month from ${stack.months[0]} to ${
            stack.months[stack.months.length - 1]
          }. Each column is that month's total, split by category. The table below the chart carries the same figures.`}
        />
      </div>

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. Also the relief the palette's sub-3:1 fills require. */}
      <table className="sr-only">
        <caption>Spending by category, by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            {stack.bands.map((band) => (
              <th key={band.key} scope="col">
                {band.key}
              </th>
            ))}
            <th scope="col">Total out</th>
            <th scope="col">In</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {stack.months.map((month, index) => {
            const point = byMonth.get(month);
            return (
              <tr key={month}>
                <th scope="row">{month}</th>
                {stack.bands.map((band) => (
                  <td key={band.key}>{formatMoney(band.values[index] ?? 0)}</td>
                ))}
                <td>{formatMoney(point?.expense ?? 0)}</td>
                <td>{formatMoney(point?.income ?? 0)}</td>
                <td>
                  {(point?.net ?? 0) < 0 ? "−" : ""}
                  {formatMoney(point?.net ?? 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 font-mono text-[11.5px] text-text-subtle">
        Amounts in CHF. Money out only — transfers between your own accounts are
        excluded.
      </p>
    </section>
  );
}
