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
 * **The scale is percent of budget, not francs.** Rent and Pets differ by two
 * orders of magnitude, so a shared franc axis flattens every small category
 * into the centre, and a per-spoke franc axis makes the rings meaningless.
 * Dividing by each category's own limit fixes both: every spoke now means the
 * same thing at the same radius, the budget is the 100% ring on every one of
 * them, and the rings can carry real tick labels again.
 */

const HEIGHT = 440;

/** The ring the budget sits on. Everything is measured against it. */
const BUDGET = 100;

/**
 * The rim, fixed at twice the budget.
 *
 * Letting it follow the data was the obvious first try and it does not work:
 * one 600% category squashes the 100% ring — the only ring anyone reads — into
 * a blob at the centre, and every other spoke with it. A fixed frame costs the
 * ability to see *how far* past the rim an outlier went, which the printed
 * percentage under the category name gives back exactly, and buys two things
 * the auto-scale cannot: the rings never move, so a month can be compared to
 * the one before it, and a vertex on the rim always means the same thing.
 */
const RIM = 2 * BUDGET;

/** Spent as a share of the limit — or of the suggestion, when none is set. */
function share(row: BudgetRow): number {
  const reference = row.limitMinor ?? row.suggestedMinor;
  return reference > 0 ? (row.usedMinor / reference) * 100 : 0;
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
  if (pct > BUDGET) return "over";
  if (pct >= 90) return "close";
  return "under";
}

function buildOption(rows: BudgetRow[], tokens: ChartTokens): EChartsOption {
  const spent = rows.map(share);
  const clipped = spent.some((pct) => pct > RIM);

  // Looked up by name from the axis-name formatter, which is handed the
  // indicator rather than the row.
  const byName = new Map(
    rows.map((row, i) => [row.category, { row, pct: spent[i] }]),
  );

  const indicator = rows.map((row, i) => ({
    // Rich text is `{style|text}`, so a brace in a category name would parse
    // as markup. None of the taxonomy has one; this keeps it that way.
    name: row.category.replace(/[{}]/g, ""),
    max: RIM,
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
              : pct > BUDGET
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
      radius: "62%",
      splitNumber: RIM / 50,
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
        // The rim absorbs everything above it, so its label has to say so
        // rather than claim the shape stops there.
        formatter: (value: number) =>
          value >= RIM && clipped ? `${value}%+` : `${value}%`,
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
            // Clamped to the rim; the true figure is under the category name,
            // in the tooltip, and in the table.
            value: spent.map((pct) => Math.min(pct, RIM)),
            // Brand lime as a *series* colour, not as `--flow-in`. Nothing on
            // this chart encodes direction — both shapes are spending — so
            // reusing the money-in hue here claims no meaning it shouldn't.
            areaStyle: { color: withAlpha(tokens.series[1], 0.22) },
            lineStyle: { width: 2.5, color: tokens.series[1] },
            itemStyle: { color: tokens.series[1] },
          },
          {
            name: "Your budget",
            // A threshold, not a quantity: outline only, no `areaStyle`. And
            // it is the same ring on every spoke, because that is what
            // dividing by the limit means.
            value: rows.map(() => BUDGET),
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
        label="Spending against budget for each category this month, as a percentage of the limit set for it. The dashed ring is the budget; the scale stops at twice it. The table below carries the same figures."
      />

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. */}
      <table className="sr-only">
        <caption>Spending against budget, by category</caption>
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
