"use client";

import { useMemo } from "react";

import {
  EChart,
  slotColor,
  tooltipStyle,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import {
  formatMoney,
  type CategoryStack,
  type MonthPoint,
} from "@/lib/insights";

/**
 * Where the money went, month by month, as a gradient stacked area.
 *
 * The bands are the categories from "Where it goes" below, in the same fixed
 * colours, so the two panels read as one statement: the pie says how the year
 * split, this says when each slice happened, and the list says what is in it.
 *
 * The bands are expenses only: a stack has to sum to something meaningful, and
 * income stacked on top of spending sums to nothing. The paired-bar version
 * this replaced also carried money *in* and the monthly net, so those two
 * columns move into the data table rather than disappearing — `series` exists
 * for no other reason.
 */

/**
 * Tall enough that the four smallest bands still get a few pixels each. At 300
 * the top of the stack was four hairlines and their separators, which is the
 * separator winning an argument with the data.
 */
const HEIGHT = 360;

function buildOption(stack: CategoryStack, tokens: ChartTokens): EChartsOption {
  return {
    // ECharts' own animation, not Motion — it animates the canvas, not a
    // container, so nothing is hidden if the script never arrives.
    animationDuration: 600,
    // `bottom` has to clear the legend, which floats over the grid rather than
    // reserving space against it — at 4 the month labels sat underneath the
    // legend text. `containLabel` covers the axis labels, not the legend.
    grid: { left: 8, right: 12, top: 8, bottom: 34, containLabel: true },
    tooltip: {
      trigger: "axis",
      // A crosshair, because on a stack the reader is comparing one month
      // across nine bands and needs the column called out.
      axisPointer: { type: "line", lineStyle: { color: tokens.line, width: 1 } },
      ...tooltipStyle(tokens),
      valueFormatter: (value) => formatMoney(Number(value ?? 0)),
      order: "seriesDesc",
    },
    legend: {
      type: "scroll",
      bottom: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      // Legend text wears an ink token, never the series colour — the swatch
      // beside it is what carries identity.
      textStyle: { color: tokens.textMuted, fontSize: 12 },
      pageIconColor: tokens.textMuted,
      pageIconInactiveColor: tokens.line,
      pageTextStyle: { color: tokens.textSubtle },
    },
    xAxis: {
      type: "category",
      data: [...stack.labels],
      boundaryGap: false,
      axisLine: { lineStyle: { color: tokens.line } },
      axisTick: { show: false },
      axisLabel: { color: tokens.textMuted, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      // Rappen on the axis would be five digits of noise; the tooltip and the
      // table carry the exact figures.
      axisLabel: {
        color: tokens.textSubtle,
        fontSize: 10,
        formatter: (value: number) => Math.round(value / 100).toLocaleString("de-CH"),
      },
      splitLine: { lineStyle: { color: tokens.line } },
    },
    series: stack.bands.map((band) => {
      const colour = slotColor(tokens, band.slot);
      return {
        name: band.key,
        type: "line" as const,
        stack: "spend",
        smooth: true,
        showSymbol: false,
        // A stroke in the surface colour is the gap between stacked bands:
        // two neighbours would otherwise share an edge with nothing between
        // them. 1px rather than the 2px a bar chart would take — with nine
        // bands the top four are only a few pixels tall, and a 2px gap
        // between them costs more signal than it buys separation.
        lineStyle: { width: 1, color: tokens.surface },
        areaStyle: {
          // The gradient runs top-to-bottom across each band's own box.
          // The floor is 0.6 rather than the near-zero fade the canonical
          // ECharts example uses: alpha is contrast spent, and the palette's
          // slots were validated against the surface at full opacity. Below
          // about 0.6 the paler slots stop being separable from the ground.
          color: {
            type: "linear" as const,
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: withAlpha(colour, 1) },
              { offset: 1, color: withAlpha(colour, 0.6) },
            ],
          },
        },
        // Dims the other bands on hover, which is the only way to follow one
        // category through a nine-deep stack.
        emphasis: { focus: "series" as const },
        itemStyle: { color: colour },
        data: band.values,
      };
    }),
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
  const option = useMemo(
    () => (tokens ? buildOption(stack, tokens) : null),
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
          label={`Spending by category for each month from ${stack.months[0]} to ${
            stack.months[stack.months.length - 1]
          }. The table below the chart carries the same figures.`}
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
                  {(point?.net ?? 0) < 0 ? "\u2212" : ""}
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
