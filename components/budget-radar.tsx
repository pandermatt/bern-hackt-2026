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
import { formatMoney, type BudgetRow } from "@/lib/insights";

/**
 * Budget against actual, as a radar.
 *
 * Two shapes over the same spokes: the limits the account holder set, drawn as
 * an outline only, and what they actually spent that month, drawn as a
 * translucent fill. Where the filled shape pushes past the outline, that
 * category is over budget — which is the whole reason this is a radar rather
 * than a row of bars.
 *
 * **Each spoke is scaled to itself.** Rent and Pets differ by two orders of
 * magnitude, and one shared maximum would flatten every small category into
 * the centre. Per-axis maxima cost the ability to compare spokes to each
 * other, which is not what the chart is for — the comparison that matters is
 * fill against outline on the same spoke, and that survives.
 */

const HEIGHT = 420;

function buildOption(rows: BudgetRow[], tokens: ChartTokens): EChartsOption {
  const indicator = rows.map((row) => {
    const reference = row.limitMinor ?? row.suggestedMinor;
    return {
      name: row.category,
      // Headroom above the larger of the two, so an over-budget month has
      // somewhere to go instead of clipping to the rim.
      max: Math.max(1, reference, row.usedMinor) * 1.18,
    };
  });

  return {
    animationDuration: 600,
    tooltip: {
      trigger: "item",
      ...tooltipStyle(tokens),
      formatter: () => {
        // One panel for the whole shape: a radar's per-point tooltip fires on
        // the polygon, not the spoke, so naming a single category would be a
        // guess.
        const lines = rows.map((row) => {
          const limit = row.limitMinor;
          const over = limit !== null && row.usedMinor > limit;
          const right =
            limit === null
              ? `<span style="opacity:.7">no limit</span>`
              : `${formatMoney(row.usedMinor)} / ${formatMoney(limit)}`;
          return `<span style="opacity:.8">${row.category}</span><span style="float:right;padding-left:18px;color:${
            over ? tokens.flowOut : tokens.text
          }">${right}</span>`;
        });
        return lines.join("<br/>");
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
    radar: {
      indicator,
      center: ["50%", "47%"],
      radius: "66%",
      // Ticks would be meaningless with a different scale per spoke.
      axisLabel: { show: false },
      axisName: { color: tokens.ink, fontSize: 11.5 },
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.2) } },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.16) } },
      splitArea: {
        show: true,
        areaStyle: { color: [withAlpha(tokens.ink, 0.02), "transparent"] },
      },
    },
    series: [
      {
        type: "radar",
        data: [
          {
            name: "Spent this month",
            value: rows.map((row) => row.usedMinor),
            // Filled, and translucent enough that the limit outline stays
            // readable underneath it.
            areaStyle: { color: withAlpha(tokens.flowOut, 0.3) },
            lineStyle: { width: 2, color: tokens.flowOut },
            itemStyle: { color: tokens.flowOut },
            symbolSize: 5,
          },
          {
            name: "Your budget",
            // A threshold, not a quantity: outline only, no `areaStyle`.
            value: rows.map((row) => row.limitMinor ?? row.suggestedMinor),
            lineStyle: { width: 2, color: tokens.accent, type: "dashed" as const },
            itemStyle: { color: tokens.accent },
            symbolSize: 5,
          },
        ],
      },
    ],
  };
}

export function BudgetRadar({ rows }: { rows: BudgetRow[] }) {
  const tokens = useChartTokens();
  const option = useMemo(
    () => (tokens ? buildOption(rows, tokens) : null),
    [rows, tokens],
  );

  if (rows.length === 0) return null;

  return (
    <>
      <EChart
        option={option}
        height={HEIGHT}
        label="Budget against actual spending for each category this month. The table below carries the same figures."
      />

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. */}
      <table className="sr-only">
        <caption>Budget against actual, by category</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Spent</th>
            <th scope="col">Budget</th>
            <th scope="col">Suggested</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category}>
              <th scope="row">{row.category}</th>
              <td>{formatMoney(row.usedMinor)}</td>
              <td>
                {row.limitMinor === null ? "Not set" : formatMoney(row.limitMinor)}
              </td>
              <td>{formatMoney(row.suggestedMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
