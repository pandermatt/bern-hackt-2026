"use client";

import { useMemo } from "react";

import {
  EChart,
  tooltipStyle,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import { formatMoney, type MonthPoint } from "@/lib/insights";

/**
 * Money in against money out, month by month, as two overlaid areas.
 *
 * Deliberately **not** broken down by category. The category story is told
 * twice already, below: the donut splits the year and "Where it goes" ranks it.
 * This chart answers the one question those cannot — whether a month earned
 * more than it spent — and a nine-band stack was drowning that in detail.
 *
 * The areas overlap rather than stack. Stacking income on top of spending sums
 * to a number that means nothing; overlaying them makes the gap between the
 * two curves the thing you actually read, which is the month's net.
 */

const HEIGHT = 320;
const GRID = { left: 58, right: 14, top: 16, bottom: 46 };

/** Rounds a rappen amount up to a tidy gridline so the axis reads cleanly. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

function buildOption(series: MonthPoint[], tokens: ChartTokens): EChartsOption {
  const peak = niceCeiling(
    Math.max(1, ...series.flatMap((point) => [point.income, point.expense])),
  );

  const area = (colour: string) => ({
    color: {
      type: "linear" as const,
      x: 0, y: 0, x2: 0, y2: 1,
      // Thin on purpose. Two overlapping fills multiply where they cross, and
      // at 0.45 the shared region went muddy enough to read as a third colour.
      // The strokes carry the series; the fill is only there to say which side
      // of the line is "under".
      colorStops: [
        { offset: 0, color: withAlpha(colour, 0.28) },
        { offset: 1, color: withAlpha(colour, 0.03) },
      ],
    },
  });

  const line = (name: string, colour: string, values: number[]) => ({
    name,
    type: "line" as const,
    smooth: true,
    // The stroke carries the series; the fill only shades the space under it,
    // which is why the fill can be transparent enough for both to show.
    lineStyle: { width: 2, color: colour },
    itemStyle: { color: colour },
    areaStyle: area(colour),
    showSymbol: false,
    // A visible dot at the hovered month, so the crosshair reading is exact.
    symbol: "circle",
    symbolSize: 7,
    emphasis: { focus: "series" as const },
    data: values,
  });

  return {
    animationDuration: 600,
    grid: GRID,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      ...tooltipStyle(tokens),
      formatter: (params) => {
        const rows = Array.isArray(params) ? params : [params];
        const index = rows[0]?.dataIndex ?? 0;
        const point = series[index];
        if (!point) return "";
        const negative = point.net < 0;
        return [
          `${point.month}`,
          `${rows[0]?.marker ?? ""}In<span style="float:right;padding-left:18px"><strong>${formatMoney(point.income)}</strong></span>`,
          `${rows[1]?.marker ?? ""}Out<span style="float:right;padding-left:18px"><strong>${formatMoney(point.expense)}</strong></span>`,
          // The gap between the curves, named.
          `<span style="opacity:.75">Net</span><span style="float:right;padding-left:18px;color:${
            negative ? tokens.flowOut : tokens.flowIn
          }"><strong>${negative ? "−" : "+"}${formatMoney(point.net)}</strong></span>`,
        ].join("<br/>");
      },
    },
    legend: {
      bottom: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 16,
      textStyle: { color: tokens.textMuted, fontSize: 12 },
    },
    xAxis: {
      type: "category",
      data: series.map((point) => point.label),
      boundaryGap: false,
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      axisTick: { show: false },
      axisLabel: { color: tokens.ink, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      max: peak,
      axisLabel: {
        color: withAlpha(tokens.ink, 0.75),
        fontSize: 10,
        // Francs, not rappen. The footnote says CHF once.
        formatter: (value: number) =>
          Math.round(value / 100).toLocaleString("de-CH"),
      },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
    },
    series: [
      line("In", tokens.flowIn, series.map((point) => point.income)),
      line("Out", tokens.flowOut, series.map((point) => point.expense)),
    ],
  };
}

export function MonthlyTrend({ series }: { series: MonthPoint[] }) {
  const tokens = useChartTokens();
  const option = useMemo(
    () => (tokens ? buildOption(series, tokens) : null),
    [series, tokens],
  );

  if (series.length === 0) return null;

  return (
    <section className="card p-5" aria-labelledby="trend-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="trend-heading" className="text-[15px] font-semibold text-text">
          Month by month
        </h2>
        <p className="text-[12.5px] text-text-muted">
          Money in against money out, in CHF
        </p>
      </div>

      <div className="mt-4">
        <EChart
          option={option}
          height={HEIGHT}
          label={`Money in and money out in Swiss francs for each month from ${series[0].month} to ${
            series[series.length - 1].month
          }. The table below the chart carries the same figures.`}
        />
      </div>

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. Also the relief a sub-3:1 fill requires. */}
      <table className="sr-only">
        <caption>Money in and out, by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">In</th>
            <th scope="col">Out</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.month}>
              <th scope="row">{point.month}</th>
              <td>{formatMoney(point.income)}</td>
              <td>{formatMoney(point.expense)}</td>
              <td>
                {point.net < 0 ? "−" : ""}
                {formatMoney(point.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
