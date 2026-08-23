"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EChart,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import {
  budgetScale,
  BUDGET_RING,
  shareOf,
  type BudgetScale,
} from "@/lib/budget-scale";
import { formatMoney, type BudgetRow } from "@/lib/insights";
import { useMediaQuery } from "@/lib/use-media-query";
import { useCategoryLabel } from "@/lib/use-category-label";

/**
 * Budget against actual, as a radar.
 *
 * Two shapes over the same spokes: what was actually spent that month, drawn
 * as a translucent fill, and the budget it was spent against, drawn as a
 * dashed outline with no fill. Where the fill pushes past the outline, that
 * category is over budget — which is the whole reason this is a radar rather
 * than a row of bars.
 *
 * **Every spoke is normalised against its own budget**, so the rings are
 * percentages and the outline is a *circle* at 100%. Categories are budgeted
 * an order of magnitude apart — CHF 120 of transport beside CHF 1'200 of
 * groceries — and on one shared franc dial that outline is a ten-pointed star
 * whose spikes say nothing about how the month went: the reader has to measure
 * each pair of spokes by eye before the shape means anything. Against a circle
 * there is one thing to look for, and it reads at a glance.
 *
 * What that costs is magnitude: a radius no longer says how much money. The
 * effective francs spent are printed under each name, coloured by how the
 * category stands against its budget, and the tooltip and `sr-only` table
 * carry the limit and the share the shape is drawn from.
 *
 * A month with a runaway category bends the scale rather than clipping it; the
 * rings stay percentages either way. `lib/budget-scale.ts` owns the arithmetic
 * and the argument for it, and hands back the two conversions this file draws
 * through.
 */

const HEIGHT = 520;

/**
 * The phone layout.
 *
 * A radar is bounded by the *narrower* side, so on a 320px canvas the dial can
 * never use a 520px box — leaving the desktop height in place just adds dead
 * space above and below. The radius has to come down further still: eight axis
 * names radiate outward from it, and "Marketplace" ran off the right edge of
 * the canvas at the desktop proportions.
 */
const COMPACT = {
  height: 370,
  nameSize: 11,
  valueSize: 12,
  nameGap: 8,
  tickSize: 9.5,
  /**
   * Only the rim gets a number. Six of them queue up one short spoke, and the
   * series is drawn over the axis, so the middle ones end up with a polygon
   * through them. The amounts under each name carry the reading anyway.
   */
  ticksOnlyRim: true,
} as const;

const ROOMY = {
  height: HEIGHT,
  nameSize: 12.5,
  valueSize: 13.5,
  nameGap: 12,
  tickSize: 11,
  ticksOnlyRim: false,
} as const;

type Layout = typeof COMPACT | typeof ROOMY;

/**
 * Breaks a long category name at its last space.
 *
 * Only helps names that *have* a space — "Marketplace" is one word and stays
 * one line, which is what the radius has to be sized for.
 */
function nameLines(name: string): string[] {
  if (name.length <= 11) return [name];
  const at = name.lastIndexOf(" ");
  return at > 0 ? [name.slice(0, at), name.slice(at + 1)] : [name];
}

/**
 * The family the axis names are drawn in.
 *
 * Pinned rather than left to the ECharts default so that `textWidth` below is
 * measuring the same font the canvas paints. If these two ever disagree the
 * radius is computed against the wrong label width, which is exactly the bug
 * this whole mechanism exists to avoid.
 */
const NAME_FONT = "sans-serif";

/** One reused offscreen context; creating a canvas per label is not free. */
let ruler: CanvasRenderingContext2D | null = null;

function textWidth(text: string, size: number, weight: number): number {
  ruler ??= document.createElement("canvas").getContext("2d");
  // No 2d context is not a crash: fall back to a generous estimate, which
  // costs a slightly small dial rather than a clipped label.
  if (!ruler) return text.length * size * 0.6;
  ruler.font = `${weight} ${size}px ${NAME_FONT}`;
  return ruler.measureText(text).width;
}

/**
 * The dial's radius, in pixels, from the space actually available.
 *
 * A percentage cannot do this job. ECharts resolves `radius: "52%"` against
 * `min(width, height) / 2`, but what has to fit outside the dial is a *text
 * label*, and text does not scale with the container — so one percentage that
 * frames the dial nicely at 402px clips "Marketplace" at 320px and wastes
 * space at 1280px. Measuring the box, measuring the widest label, and
 * subtracting is the only version of this that holds at every width.
 */
function radiusFor(
  boxWidth: number,
  names: string[],
  values: string[],
  layout: Layout,
): number {
  const labelWidth = names.reduce((widest, displayed, i) => {
    const name = Math.max(
      ...nameLines(displayed).map((line) =>
        textWidth(line, layout.nameSize, 400),
      ),
    );
    // The amount is bolder and usually the wider of the two, so it is measured
    // per row rather than guessed from a placeholder.
    const value = textWidth(values[i], layout.valueSize, 600);
    return Math.max(widest, name, value);
  }, 0);

  const byWidth = boxWidth / 2 - layout.nameGap - labelWidth;
  // Two lines of name plus the amount, and the legend along the bottom.
  const byHeight =
    layout.height / 2 - layout.nameGap - layout.nameSize * 3.4 - 26;
  return Math.max(44, Math.min(byWidth, byHeight));
}

/**
 * Spent as basis points of the limit — or of the suggestion, when none is set.
 *
 * What the spoke is drawn at, what the tooltip's share is, and what scores the
 * colour of the amount printed under the category name — one figure, so the
 * shape and its scoring can never disagree.
 */
function share(row: BudgetRow): number {
  return shareOf(row.usedMinor, row.limitMinor ?? row.suggestedMinor);
}

/**
 * The colour of the amount under a category name.
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

/**
 * The strings the option builder needs, resolved by the component.
 *
 * `useTranslations` is a hook and the builder is not a component, so the
 * translated text is handed down as functions — the same shape the dashboard's
 * category chart uses.
 */
type ChartText = {
  spentSeries: string;
  budgetSeries: string;
  noLimitTip: () => string;
  againstLimitTip: (used: string, limit: string, share: number) => string;
};

function buildOption(
  rows: BudgetRow[],
  names: string[],
  values: string[],
  tokens: ChartTokens,
  layout: Layout,
  radius: number,
  dial: BudgetScale,
  text: ChartText,
): EChartsOption {
  // Basis points of each category's own budget, and the same figure as a
  // percentage for everything that prints one.
  const shares = rows.map(share);
  const spent = shares.map((bp) => bp / 100);
  const { max, splitNumber, toDial, toPercent } = dial;

  // Looked up by name from the axis-name formatter, which is handed the
  // indicator rather than the row — so this is keyed on the *displayed* name,
  // not on `row.category`, or a translated spoke finds nothing.
  const byName = new Map(
    rows.map((row, i) => [names[i], { row, pct: spent[i], value: values[i] }]),
  );

  const indicator = rows.map((row, i) => ({
    name: names[i],
    // Dial units, not percentages — the rings are only evenly spaced in
    // *percent* on an unbent scale, and `toPercent` is what turns a tick back
    // into a figure.
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
      // Tooltip chrome is inlined per chart: the shared `tooltipStyle` helper
      // this used to spread went away when the dashboard charts were rewritten,
      // and every other chart now carries its own.
      backgroundColor: tokens.surface,
      borderColor: tokens.line,
      borderWidth: 1,
      padding: [8, 10] as [number, number],
      textStyle: { color: tokens.text, fontSize: 12 },
      extraCssText:
        "box-shadow: 0 4px 12px -2px rgba(0,0,0,0.18); border-radius: 8px;",
      formatter: () => {
        // One panel for the whole shape: a radar's per-point tooltip fires on
        // the polygon, not the spoke, so naming a single category would be a
        // guess.
        const lines = rows.map((row, i) => {
          const pct = spent[i];
          const limit = row.limitMinor;
          const right =
            limit === null
              ? `<span style="opacity:.7">${text.noLimitTip()}</span>`
              : text.againstLimitTip(
                  formatMoney(row.usedMinor),
                  formatMoney(limit),
                  Math.round(pct),
                );
          const colour =
            limit === null
              ? tokens.textMuted
              : pct > 100
                ? tokens.danger
                : tokens.text;
          return `<span style="opacity:.8">${names[i]}</span><span style="float:right;padding-left:18px;color:${colour}">${right}</span>`;
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
        { name: text.spentSeries, icon: "roundRect" },
        // Two blocks filling the full icon box, so the legend swatch reads as
        // the same dashed rule the chart draws. A stroke-based path would not
        // — legend icons are filled with the item colour, never stroked.
        {
          name: text.budgetSeries,
          icon: "path://M0,0 h10 v10 h-10 z M14,0 h10 v10 h-10 z",
        },
      ],
    },
    radar: {
      indicator: indicator as { name: string; max: number }[],
      center: ["50%", "48%"],
      // Room for a two-line axis name at every compass point.
      radius,
      splitNumber,
      axisName: {
        // Category on top, the effective francs spent underneath — the number
        // the normalised radius deliberately stopped carrying. The colour
        // still scores it against the budget, and the share itself lives in
        // the tooltip and the `sr-only` table.
        formatter: (name?: string) => {
          const entry = name ? byName.get(name) : undefined;
          if (!entry) return name ?? "";
          // One token per line: a `\n` *inside* a rich token is not a line
          // break, so a wrapped name has to be emitted as separate tokens.
          const lines = nameLines(name ?? "").map((line) => `{name|${line}}`);
          const value = `{${verdict(entry.row, entry.pct)}|${entry.value}}`;
          return [...lines, value].join("\n");
        },
        rich: {
          name: {
            color: tokens.ink,
            fontFamily: NAME_FONT,
            fontSize: layout.nameSize,
            lineHeight: layout.nameSize + 5,
          },
          // `--positive` and `--danger` rather than the chart fills: these are
          // 12px glyphs, and #a5c400 on white is 2:1.
          over: {
            color: tokens.danger,
            fontFamily: NAME_FONT,
            fontSize: layout.valueSize,
            fontWeight: 600,
            lineHeight: layout.valueSize + 5,
          },
          close: {
            color: tokens.positive,
            fontFamily: NAME_FONT,
            fontSize: layout.valueSize,
            fontWeight: 600,
            lineHeight: layout.valueSize + 5,
          },
          under: {
            color: tokens.accent,
            fontFamily: NAME_FONT,
            fontSize: layout.valueSize,
            fontWeight: 600,
            lineHeight: layout.valueSize + 5,
          },
          idle: {
            color: tokens.textSubtle,
            fontFamily: NAME_FONT,
            fontSize: layout.valueSize,
            fontWeight: 600,
            lineHeight: layout.valueSize + 5,
          },
        },
      },
      axisNameGap: layout.nameGap,
      axisLabel: {
        // Below this the dial is small enough that the rim number sits on top
        // of whichever axis name is nearest the top spoke. The `sr-only` table
        // still carries every figure exactly.
        show: layout.ticksOnlyRim ? radius >= 60 : true,
        // No "0%" at the hub: the centre is self-evidently zero, and any spoke
        // that reaches it puts the shape straight through the label.
        showMinLabel: false,
        showMaxLabel: true,
        color: tokens.textMuted,
        fontSize: layout.tickSize,
        // Share of budget, so the ring at 100% is the dashed circle and every
        // other ring reads against it. No `+` on the rim: the scale bends to
        // fit the month's largest figure rather than clamping it, so every ring
        // is the figure it says.
        formatter: (value: number) =>
          layout.ticksOnlyRim && value < max
            ? ""
            : `${Math.round(toPercent(value))}%`,
        // The rings run under these numbers; a plate of the panel's own colour
        // keeps them readable without moving them off the spoke. That is
        // `--surface-muted`, not `--surface`: the radar sits on the grey
        // section panel now, and a white plate there is a visible chip behind
        // every tick rather than a hole in the rings.
        backgroundColor: tokens.surfaceMuted,
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
            name: text.spentSeries,
            value: shares.map(toDial),
            // Brand lime as a *series* colour, not as `--flow-in`. Nothing on
            // this chart encodes direction — both shapes are spending — so
            // reusing the money-in hue here claims no meaning it shouldn't.
            areaStyle: { color: withAlpha(tokens.series[1], 0.22) },
            lineStyle: { width: 2.5, color: tokens.series[1] },
            itemStyle: { color: tokens.series[1] },
          },
          {
            name: text.budgetSeries,
            // A threshold, not a quantity: outline only, no `areaStyle`. One
            // value for every spoke, because normalising is what turns this
            // from a star into the ring the fill is read against — and it
            // lands on a gridline by construction, never between two.
            value: rows.map(() => toDial(BUDGET_RING)),
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
  const t = useTranslations("Budget");
  // Category names are data, stored in English and translated only where they
  // are shown — so the stored key keeps matching the colour slot and the saved
  // limit in either language.
  const categoryLabel = useCategoryLabel();
  const tokens = useChartTokens();
  // Tailwind's `sm`, so the chart changes shape at the same width the page
  // around it does. This picks the type sizes; the radius is measured.
  const compact = useMediaQuery("(max-width: 639.98px)");
  const layout = compact ? COMPACT : ROOMY;

  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setBoxWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The name each spoke wears. Resolved once and shared by the sizer and the
  // builder: the dial's radius is computed from the width of these labels, so
  // measuring the English key while painting the German one sizes the chart
  // against a string it never draws.
  //
  // Rich text is `{style|text}`, so a brace would parse as markup. None of the
  // taxonomy has one, in either language, and this keeps it that way.
  const names = useMemo(
    () => rows.map((row) => categoryLabel(row.category).replace(/[{}]/g, "")),
    [rows, categoryLabel],
  );

  // The effective francs each spoke prints under its name — shared by the
  // sizer and the builder for the same reason `names` is: the radius is
  // computed from the width of exactly these strings.
  const values = useMemo(
    () => rows.map((row) => formatMoney(row.usedMinor)),
    [rows],
  );

  const text = useMemo<ChartText>(
    () => ({
      spentSeries: t("seriesSpent"),
      budgetSeries: t("seriesBudget"),
      noLimitTip: () => t("tipNoLimit"),
      againstLimitTip: (used, limit, share) =>
        t("tipAgainstLimit", { used, limit, share }),
    }),
    [t],
  );

  // Refitted whenever the month changes, which is the whole point of it — a
  // quiet month draws a dial that stops just past the budget circle, and a
  // month with a runaway category draws one that bends rather than clamping
  // the outlier onto the rim.
  const dial = useMemo(() => budgetScale(rows.map(share)), [rows]);

  const option = useMemo(
    () =>
      tokens && boxWidth > 0
        ? buildOption(
            rows,
            names,
            values,
            tokens,
            layout,
            radiusFor(boxWidth, names, values, layout),
            dial,
            text,
          )
        : null,
    [rows, names, values, tokens, layout, boxWidth, dial, text],
  );

  if (rows.length === 0) return null;

  return (
    <div ref={box}>
      <EChart
        option={option}
        height={layout.height}
        label={t("chartLabel")}
      />

      {/* A bent scale that does not say so is a lie told with a straight
          face: every ring is still labelled with its percentage, but they no
          longer climb in equal steps, and the shape reads differently because
          of it. Only shown on the months that are actually compressed — a
          standing caveat on a dial that is linear would be its own kind of
          wrong. */}
      {dial.compressed && (
        <p className="mx-auto -mt-1 max-w-[52ch] text-center text-[12px] leading-snug text-text-muted">
          {t("radarCompressed")}
        </p>
      )}

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. */}
      <div className="sr-only">
        <table aria-label={t("tableLabel")}>
          <thead>
            <tr>
              <th scope="col">{t("tableCategory")}</th>
              <th scope="col">{t("tableSpent")}</th>
              <th scope="col">{t("tableBudget")}</th>
              <th scope="col">{t("tableShare")}</th>
              <th scope="col">{t("tableSuggested")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.category}>
                <th scope="row">{names[i]}</th>
                <td>{formatMoney(row.usedMinor)}</td>
                <td>
                  {row.limitMinor === null
                    ? t("notSet")
                    : formatMoney(row.limitMinor)}
                </td>
                <td>{Math.round(share(row) / 100)}%</td>
                <td>{formatMoney(row.suggestedMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
