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
 * Two shapes over the same spokes: what was actually spent that month, drawn
 * as a translucent fill, and the limit the account holder set, drawn as a
 * dashed outline with no fill. Where the fill pushes past the outline, that
 * category is over budget — which is the whole reason this is a radar rather
 * than a row of bars.
 *
 * **The rings are francs, on one scale shared by every spoke**, and the rim is
 * refitted to each month. That is what makes the two shapes readable as
 * shapes: a spoke sitting far out is a large amount of money wherever it is on
 * the dial. The cost is that a small category's ring sits close to the hub,
 * where "half the budget" and "twice it" are a few pixels apart — which is why
 * the percentage is printed under every category name. Read the shape for
 * scale and the number for the verdict; neither alone is the whole chart.
 */

const HEIGHT = 520;

/** Spent as a share of the limit — or of the suggestion, when none is set. */
function share(row: BudgetRow): number {
  const reference = row.limitMinor ?? row.suggestedMinor;
  return reference > 0 ? (row.usedMinor / reference) * 100 : 0;
}

/**
 * How far past the largest budget one month is allowed to stretch the dial.
 *
 * The rim follows each month's own peak, so a quiet month draws a dial it
 * actually fills instead of a big empty one — but only up to here. Fit it to
 * the peak unconditionally and a single runaway category (CHF 6'800 against
 * limits averaging CHF 770) pushes every dashed ring into a knot at the hub,
 * which is the one thing the chart exists to show. Past the cap the spending
 * clamps to the rim, the outer tick grows a `+`, and the real figure is
 * printed under the category name, in the tooltip, and in the table.
 */
const OUTLIER_CAP = 2.5;

/**
 * A rim just above the month's largest figure, on a round franc step.
 *
 * `1 / 2 / 2.5 / 5` per decade is the usual set, picked so the dial lands on
 * four to six rings: fewer and the shapes float in empty space, more and the
 * rings start reading as noise behind them.
 */
function scale(
  peakMinor: number,
  topBudgetMinor: number,
): { max: number; splitNumber: number } {
  const target = Math.max(
    10000,
    Math.min(peakMinor * 1.08, topBudgetMinor * OUTLIER_CAP),
  );
  const magnitude = 10 ** Math.floor(Math.log10(target / 4));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = steps.find((s) => target / s <= 6) ?? steps[steps.length - 1];
  const splitNumber = Math.ceil(target / step);
  return { max: splitNumber * step, splitNumber };
}

/**
 * The colour of the percentage under a category name.
 *
 * An unset category is measured against a *suggestion*, so it is deliberately
 * not scored — calling a number "over" against a limit nobody chose would be
 * inventing a verdict.
 */
function verdict(row: BudgetRow, pct: number): string {
  if (row.limitMinor === null) return "idle";
  if (pct === 0) return "idle";
  if (pct > 100) return "over";
  if (pct >= 90) return "close";
  return "under";
}

function buildOption(rows: BudgetRow[], tokens: ChartTokens): EChartsOption {
  const spent = rows.map(share);
  const used = rows.map((row) => row.usedMinor);
  const budget = rows.map((row) => row.limitMinor ?? row.suggestedMinor);
  const topBudget = Math.max(0, ...budget);
  const { max, splitNumber } = scale(Math.max(topBudget, ...used), topBudget);
  const clipped = used.some((amount) => amount > max);

  // Looked up by name from the axis-name formatter, which is handed the
  // indicator rather than the row.
  const byName = new Map(
    rows.map((row, i) => [row.category, { row, pct: spent[i] }]),
  );

  const indicator = rows.map((row, i) => ({
    // Rich text is `{style|text}`, so a brace in a category name would parse
    // as markup. None of the taxonomy has one; this keeps it that way.
    name: row.category.replace(/[{}]/g, ""),
    max,
    // Tick labels on the top spoke only. Repeating 0/50/100/150/200 around
    // all eight is the same five numbers eight times over the drawing.
    // Per-indicator options win over the radar-level ones (they are merged
    // without overwrite), which the public `RadarIndicatorOption` type does
    // not model — hence the cast below.
    ...(i === 0 ? {} : { axisLabel: { show: false } }),
  }));

  return {
    animationDuration: 600,
    tooltip: {
      trigger: "item",
      ...tooltipStyle(tokens),
      formatter: () => {
        // One panel for the whole shape: a radar's per-point tooltip fires on
        // the polygon, not the spoke, so naming a single category would be a
        // guess.
        const lines = rows.map((row, i) => {
          const pct = spent[i];
          const limit = row.limitMinor;
          const right =
            limit === null
              ? `<span style="opacity:.7">no limit</span>`
              : `${formatMoney(row.usedMinor)} / ${formatMoney(limit)} · ${Math.round(pct)}%`;
          const colour =
            limit === null
              ? tokens.textMuted
              : pct > 100
                ? tokens.danger
                : tokens.text;
          return `<span style="opacity:.8">${row.category}</span><span style="float:right;padding-left:18px;color:${colour}">${right}</span>`;
        });
        return lines.join("<br/>");
      },
    },
    legend: {
      bottom: 0,
      itemGap: 26,
      itemWidth: 24,
      itemHeight: 10,
      textStyle: { color: tokens.textMuted, fontSize: 12.5 },
      data: [
        { name: "Spent this month", icon: "roundRect" },
        // Two blocks filling the full icon box, so the legend swatch reads as
        // the same dashed rule the chart draws. A stroke-based path would not
        // — legend icons are filled with the item colour, never stroked.
        { name: "Your budget", icon: "path://M0,0 h10 v10 h-10 z M14,0 h10 v10 h-10 z" },
      ],
    },
    radar: {
      indicator: indicator as { name: string; max: number }[],
      center: ["50%", "48%"],
      // Room for a two-line axis name at every compass point.
      radius: "65%",
      splitNumber,
      axisName: {
        // Category on top, its share of budget underneath — the reading most
        // people came for, without having to measure a radius by eye.
        formatter: (name?: string) => {
          const entry = name ? byName.get(name) : undefined;
          if (!entry) return name ?? "";
          return `{name|${name}}\n{${verdict(entry.row, entry.pct)}|${Math.round(entry.pct)}%}`;
        },
        rich: {
          name: { color: tokens.ink, fontSize: 12.5, lineHeight: 19 },
          // `--positive` and `--danger` rather than the chart fills: these are
          // 12px glyphs, and #a5c400 on white is 2:1.
          over: { color: tokens.danger, fontSize: 13.5, fontWeight: 600, lineHeight: 18 },
          close: { color: tokens.positive, fontSize: 13.5, fontWeight: 600, lineHeight: 18 },
          under: { color: tokens.accent, fontSize: 13.5, fontWeight: 600, lineHeight: 18 },
          idle: { color: tokens.textSubtle, fontSize: 13.5, fontWeight: 600, lineHeight: 18 },
        },
      },
      axisNameGap: 12,
      axisLabel: {
        show: true,
        // No "0%" at the hub: the centre is self-evidently zero, and any spoke
        // that reaches it puts the shape straight through the label.
        showMinLabel: false,
        showMaxLabel: true,
        color: tokens.textMuted,
        fontSize: 11,
        // Francs, not rappen, and grouped the Swiss way. The card's subhead
        // names the currency, as it does on every other chart in the app. The
        // rim absorbs anything above it, so its label has to say so rather
        // than claim the shape stops there.
        formatter: (value: number) =>
          `${Math.round(value / 100).toLocaleString("de-CH")}${
            value >= max && clipped ? "+" : ""
          }`,
        // The rings run under these numbers; a plate of page colour keeps them
        // readable without moving them off the spoke.
        backgroundColor: tokens.surface,
        padding: [1, 3],
      },
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.12) } },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.14) } },
      // Plain ground. Banded rings compete with the two shapes for the same
      // reading, and the shapes are the point.
      splitArea: { show: false },
    },
    series: [
      {
        type: "radar",
        symbol: "circle",
        symbolSize: 7,
        data: [
          {
            name: "Spent this month",
            // Clamped to the rim; the real figure is under the category name,
            // in the tooltip, and in the table.
            value: used.map((amount) => Math.min(amount, max)),
            // Brand lime as a *series* colour, not as `--flow-in`. Nothing on
            // this chart encodes direction — both shapes are spending — so
            // reusing the money-in hue here claims no meaning it shouldn't.
            areaStyle: { color: withAlpha(tokens.series[1], 0.22) },
            lineStyle: { width: 2.5, color: tokens.series[1] },
            itemStyle: { color: tokens.series[1] },
          },
          {
            name: "Your budget",
            // A threshold, not a quantity: outline only, no `areaStyle`.
            value: budget,
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
        label="Spending against budget for each category this month, in Swiss francs, with the share of each limit printed beside its category. The table below carries the same figures."
      />

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. */}
      <table
        className="sr-only"
        aria-label="Spending against budget, by category"
      >
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Spent</th>
            <th scope="col">Budget</th>
            <th scope="col">Share of budget</th>
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
              <td>{Math.round(share(row))}%</td>
              <td>{formatMoney(row.suggestedMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
