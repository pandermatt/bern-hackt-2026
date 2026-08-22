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
import { formatMoney, type BudgetRow } from "@/lib/insights";
import { useMediaQuery } from "@/lib/use-media-query";
import { useCategoryLabel } from "@/lib/use-category-label";

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
  percentSize: 12,
  nameGap: 8,
  tickSize: 9.5,
  /**
   * Only the rim gets a number. Six of them queue up one short spoke, and the
   * series is drawn over the axis, so the middle ones end up with a polygon
   * through them. The percentages under each name carry the reading anyway.
   */
  ticksOnlyRim: true,
} as const;

const ROOMY = {
  height: HEIGHT,
  nameSize: 12.5,
  percentSize: 13.5,
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
  layout: Layout,
): number {
  const labelWidth = names.reduce((widest, displayed) => {
    const name = Math.max(
      ...nameLines(displayed).map((line) =>
        textWidth(line, layout.nameSize, 400),
      ),
    );
    // The percentage is bolder and can be the wider of the two on a short name.
    const share = textWidth("724%", layout.percentSize, 600);
    return Math.max(widest, name, share);
  }, 0);

  const byWidth = boxWidth / 2 - layout.nameGap - labelWidth;
  // Two lines of name plus the percentage, and the legend along the bottom.
  const byHeight =
    layout.height / 2 - layout.nameGap - layout.nameSize * 3.4 - 26;
  return Math.max(44, Math.min(byWidth, byHeight));
}

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
  tokens: ChartTokens,
  layout: Layout,
  radius: number,
  text: ChartText,
): EChartsOption {
  const spent = rows.map(share);
  const used = rows.map((row) => row.usedMinor);
  const budget = rows.map((row) => row.limitMinor ?? row.suggestedMinor);
  const topBudget = Math.max(0, ...budget);
  const { max, splitNumber } = scale(Math.max(topBudget, ...used), topBudget);
  const clipped = used.some((amount) => amount > max);

  // Looked up by name from the axis-name formatter, which is handed the
  // indicator rather than the row — so this is keyed on the *displayed* name,
  // not on `row.category`, or a translated spoke finds nothing.
  const byName = new Map(
    rows.map((row, i) => [names[i], { row, pct: spent[i] }]),
  );

  const indicator = rows.map((row, i) => ({
    name: names[i],
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
        // Category on top, its share of budget underneath — the reading most
        // people came for, without having to measure a radius by eye.
        formatter: (name?: string) => {
          const entry = name ? byName.get(name) : undefined;
          if (!entry) return name ?? "";
          // One token per line: a `\n` *inside* a rich token is not a line
          // break, so a wrapped name has to be emitted as separate tokens.
          const lines = nameLines(name ?? "").map((line) => `{name|${line}}`);
          const share = `{${verdict(entry.row, entry.pct)}|${Math.round(entry.pct)}%}`;
          return [...lines, share].join("\n");
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
            fontSize: layout.percentSize,
            fontWeight: 600,
            lineHeight: layout.percentSize + 5,
          },
          close: {
            color: tokens.positive,
            fontFamily: NAME_FONT,
            fontSize: layout.percentSize,
            fontWeight: 600,
            lineHeight: layout.percentSize + 5,
          },
          under: {
            color: tokens.accent,
            fontFamily: NAME_FONT,
            fontSize: layout.percentSize,
            fontWeight: 600,
            lineHeight: layout.percentSize + 5,
          },
          idle: {
            color: tokens.textSubtle,
            fontFamily: NAME_FONT,
            fontSize: layout.percentSize,
            fontWeight: 600,
            lineHeight: layout.percentSize + 5,
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
        // Francs, not rappen, and grouped the Swiss way. The card's subhead
        // names the currency, as it does on every other chart in the app. The
        // rim absorbs anything above it, so its label has to say so rather
        // than claim the shape stops there.
        formatter: (value: number) =>
          layout.ticksOnlyRim && value < max
            ? ""
            : `${Math.round(value / 100).toLocaleString("de-CH")}${
                value >= max && clipped ? "+" : ""
              }`,
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
            name: text.budgetSeries,
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

  const option = useMemo(
    () =>
      tokens && boxWidth > 0
        ? buildOption(
            rows,
            names,
            tokens,
            layout,
            radiusFor(boxWidth, names, layout),
            text,
          )
        : null,
    [rows, names, tokens, layout, boxWidth, text],
  );

  if (rows.length === 0) return null;

  return (
    <div ref={box}>
      <EChart
        option={option}
        height={layout.height}
        label={t("chartLabel")}
      />

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
                <td>{Math.round(share(row))}%</td>
                <td>{formatMoney(row.suggestedMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
