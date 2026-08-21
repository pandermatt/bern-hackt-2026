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
import { formatMoney, type CategoryStack } from "@/lib/insights";

/**
 * The year in one shape: how the whole range's spending divides between
 * categories.
 *
 * Deliberately **not** filtered. It answers "what does my year look like",
 * which is a question the ledger's filters would destroy the moment someone
 * narrows to a month — the same reasoning that keeps the trend chart on the
 * unfiltered set. The list below it is the filtered view of the same figures,
 * and the two are colour-matched by category so moving between them is free.
 */

const HEIGHT = 320;
/**
 * Below this share a wedge is thinner than its own leader line, so the labels
 * are placed selectively rather than on all nine. The legend and the table
 * name the rest.
 */
const LABEL_THRESHOLD = 0.04;

function buildOption(stack: CategoryStack, tokens: ChartTokens): EChartsOption {
  return {
    animationDuration: 600,
    tooltip: {
      trigger: "item",
      ...tooltipStyle(tokens),
      formatter: (params) => {
        const point = params as { name: string; value: number; percent?: number };
        return `${point.name}<br/><strong>${formatMoney(point.value)}</strong> · ${
          point.percent?.toFixed(1) ?? "0"
        }%`;
      },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      textStyle: { color: tokens.textMuted, fontSize: 12 },
      pageIconColor: tokens.textMuted,
      pageIconInactiveColor: tokens.line,
      pageTextStyle: { color: tokens.textSubtle },
    },
    series: [
      {
        type: "pie",
        // A donut, so the middle can carry the total rather than a bare hole.
        // The inner radius is set by the centre label, not by taste: the hole
        // has to be wider than "CHF 92'969.40" renders at 15px mono, or the
        // total sits on top of the ring.
        radius: ["55%", "74%"] as [string, string],
        center: ["50%", "45%"] as [string, string],
        // Wedges are drawn in data order, which is rank order, so the pie and
        // the list below it run in the same sequence.
        // The requested separation. It does the same job the 2px surface
        // stroke does on the stacked area: two neighbouring wedges never
        // share an edge, which is what lets adjacent hues stay legible.
        padAngle: 2,
        itemStyle: {
          borderRadius: 5,
          borderColor: tokens.surface,
          borderWidth: 1,
        },
        label: {
          // Dark neutral, the palette's text/connector role.
          color: tokens.ink,
          fontSize: 11.5,
          formatter: (params) => {
            const point = params as { name: string; percent?: number };
            return `${point.name}  ${(point.percent ?? 0).toFixed(0)}%`;
          },
        },
        labelLine: { length: 10, length2: 12, lineStyle: { color: withAlpha(tokens.ink, 0.4) } },
        // Never let two labels stack on top of each other; drop one instead.
        labelLayout: { hideOverlap: true },
        emphasis: {
          scaleSize: 6,
          label: { color: tokens.text, fontWeight: "bold" },
        },
        data: stack.bands.map((band) => ({
          name: band.key,
          value: band.total,
          itemStyle: { color: slotColor(tokens, band.slot) },
          label: {
            show: stack.total > 0 && band.total / stack.total >= LABEL_THRESHOLD,
          },
        })),
      },
    ],
  };
}

export function CategoryPie({ stack }: { stack: CategoryStack }) {
  const tokens = useChartTokens();
  const option = useMemo(
    () => (tokens ? buildOption(stack, tokens) : null),
    [stack, tokens],
  );

  if (stack.bands.length === 0) return null;

  const span =
    stack.months.length > 0
      ? `${stack.months[0]} to ${stack.months[stack.months.length - 1]}`
      : "";

  return (
    <section className="card p-5" aria-labelledby="pie-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="pie-heading" className="text-[15px] font-semibold text-text">
          The whole year
        </h2>
        <p className="text-[12.5px] text-text-muted">
          Every category, unfiltered · {span}
        </p>
      </div>

      <div className="relative mt-4">
        <EChart
          option={option}
          height={HEIGHT}
          label={`Share of total spending by category over ${span}. The table below the chart carries the same figures.`}
        />

        {/* The donut's middle, as real HTML rather than an ECharts graphic: it
            is in the server-rendered markup, wears the type tokens, and stays
            selectable. `45%` matches the series' own centre. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-[45%] -translate-y-1/2 text-center"
          aria-hidden
        >
          <p className="text-[11.5px] font-medium tracking-wide text-text-subtle uppercase">
            Total out
          </p>
          <p className="font-mono text-[15px] font-medium tabular-nums text-text">
            {formatMoney(stack.total)}
          </p>
        </div>
      </div>

      <table className="sr-only">
        <caption>Share of spending by category, whole range</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Total</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {stack.bands.map((band) => (
            <tr key={band.key}>
              <th scope="row">{band.key}</th>
              <td>{formatMoney(band.total)}</td>
              <td>
                {stack.total > 0
                  ? ((band.total / stack.total) * 100).toFixed(1)
                  : "0.0"}
                %
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
