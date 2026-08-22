"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  EChart,
  slotColor,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import { Section } from "@/components/section";
import { categoryIcon } from "@/lib/category-icons";
import {
  formatMoney,
  monthParts,
  slotsOf,
  MERCHANT_SEGMENTS,
  MONTH_LABELS,
  type CategoryPeriod,
  type CategoryPeriods,
  type CategorySpend,
  type CategoryStack,
} from "@/lib/insights";
import { useIsNarrow } from "@/lib/use-hydrated";

/**
 * The top expense categories as bars — running month or year-to-date, up to
 * ten at a time — with three more layers folded in:
 *
 * - **Hovering a bar splits it into its merchants.** The bar is secretly a
 *   stack the whole time — every segment painted the category's own colour, so
 *   it reads as one solid bar — and the hover repaints the hovered bar's
 *   segments as lightness steps of that colour and opens 2px seams between
 *   them. Because that is a *merged* option update (`notMerge={false}`),
 *   ECharts animates the repaint in place rather than redrawing the chart.
 *   Shades of the one hue, not new hues: the merchants are parts of a single
 *   category, and the palette never grows an eleventh colour.
 * - **A dotted ink line across each bar marks the category's twelve-month
 *   median.**
 *   In the month view that is the median month itself; in the YTD view it is
 *   the median month times the months elapsed — the pace a typical month
 *   would have set. Above the dash means spending ahead of typical.
 * - **A chip per category hides it from the chart.** Hiding one promotes the
 *   next-ranked category into view, which is why the aggregate carries the
 *   full ranking. Hidden chips stay in the row, struck through, so the way
 *   back is always visible.
 *
 * The axis names each bar with its category *icon*; the chips and tooltips
 * carry the words, and the `sr-only` tables carry the figures, so the icon is
 * never the only naming.
 *
 * The bar colours come from `slotsOf(stack)` — the same whole-range map the
 * donut paints from — so a category wears one colour everywhere on the page,
 * whichever period is showing and whatever is hidden. Like the other charts
 * this reads the *unfiltered* rows: "this month" and "this year" are fixed
 * questions, and the ledger's filters must not quietly change which months or
 * which merchants the bars describe.
 */

/** How many bars show at once. The ninth-and-beyond categories wait behind
 * the hide chips rather than crowding the axis. */
const SHOWN_CATEGORIES = 8;

/** Reserved (with the control row) in `app/(dashboard)/loading.tsx` — a
 * canvas cannot reserve its own space. */
const HEIGHT = 300;
/** Extra headroom at the top for the per-bar totals; no legend strip at the
 * bottom — each bar names itself on the axis. */
const GRID = { left: 58, right: 14, top: 30, bottom: 32 };
const GRID_NARROW = { left: 40, right: 10, top: 28, bottom: 30 };

/** Rounds a rappen amount up to a tidy gridline so the axis reads cleanly. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

/**
 * The hovered bar's merchant steps: the biggest merchant keeps the full
 * category colour at the baseline, and each smaller one above it fades towards
 * the panel ground. The floor is 0.3 — the faintest step still has to read as
 * a filled shape, and the seams (not the fills) are what separate neighbours.
 */
function shade(colour: string, index: number, count: number): string {
  if (count <= 1) return colour;
  return withAlpha(colour, 1 - (index * 0.7) / (count - 1));
}

/** The dash's value: the median month, scaled to the period's length. */
function dashValue(category: CategorySpend, monthCount: number): number | null {
  return category.median === null ? null : category.median * monthCount;
}

/**
 * The symbol every dash wears, so the marker names itself instead of leaning
 * on the footnote alone. Ø — the sign German-speaking UIs use for a typical
 * value ("Durchschnitt") — rather than the statistician's x̃, which reads as
 * jargon outside a stats course.
 */
const MEDIAN_SYMBOL = "Ø";

function buildOption(
  period: CategoryPeriod,
  visible: CategorySpend[],
  slots: Map<string, number>,
  tokens: ChartTokens,
  narrow: boolean,
  hovered: number | null,
): EChartsOption {
  const { monthCount } = period;
  // Ten bars is a different chart from five: the bars slim down, and on a
  // phone the per-bar ink (totals, the median symbol) comes off entirely —
  // ten labels in ~26px bands can only collide. Tooltips and the tables
  // still carry every figure, and hiding categories brings the labels back.
  const dense = visible.length > 6;
  const showMarks = !narrow || !dense;
  const barWidth = narrow ? (dense ? 14 : 24) : dense ? 40 : 48;
  const grid = narrow ? GRID_NARROW : GRID;
  const peak = niceCeiling(
    Math.max(
      1,
      ...visible.flatMap((c) => [c.total, dashValue(c, monthCount) ?? 0]),
    ),
  );
  // The y scale in pixels, for the one collision the layout can produce: a
  // dash above the bar top sits exactly where the total label goes, so the
  // label climbs above the dash instead of being struck through by it.
  const plotHeight = HEIGHT - grid.top - grid.bottom;
  const labelDistance = (category: CategorySpend) => {
    const dash = dashValue(category, monthCount);
    const above =
      dash !== null && dash > category.total
        ? ((dash - category.total) / peak) * plotHeight
        : 0;
    return above > 0 ? Math.ceil(above) + 10 : 6;
  };

  // One bar series per merchant *position*, stacked: series `seg` carries each
  // category's seg-th biggest merchant (or a gap once that category runs out).
  // Biggest at the baseline, so the split reads largest-first bottom-up.
  // Always exactly MERCHANT_SEGMENTS series, padded with gaps: this chart
  // updates by *merge*, and a series that vanished between two options would
  // stay painted on the canvas.
  const bars = Array.from({ length: MERCHANT_SEGMENTS }, (_, seg) => ({
    name: `merchant-${seg}`,
    type: "bar" as const,
    stack: "period",
    barWidth,
    data: visible.map((category, index) => {
      const merchant = category.merchants[seg];
      if (!merchant) return { value: null };
      const colour = slotColor(tokens, slots.get(category.key) ?? 0);
      const split = hovered === index;
      const top = seg === category.merchants.length - 1;
      return {
        value: merchant.amount,
        itemStyle: {
          color: split ? shade(colour, seg, category.merchants.length) : colour,
          // The seams that appear on hover: the panel's own grey, grown from
          // nothing, so the solid bar visibly comes apart into segments.
          borderColor: tokens.surfaceMuted,
          borderWidth: split ? 2 : 0,
          borderRadius: split ? 3 : top ? [4, 4, 0, 0] : 0,
        },
        // The period's total rides the top segment, so it sits over the bar
        // in both states. Francs; the footnote says CHF once.
        label: top
          ? {
              show: showMarks,
              position: "top" as const,
              distance: labelDistance(category),
              color: tokens.ink,
              fontSize: 11,
              formatter: () =>
                Math.round(category.total / 100).toLocaleString("de-CH"),
            }
          : undefined,
      };
    }),
  }));

  // The median as a dotted line slightly wider than the bar, so it stays
  // visible where it crosses the fill and cannot be mistaken for a segment
  // seam. Ink, the palette's marker role. The dotting is drawn into the
  // symbol's own path — a canvas symbol has no border style to dot — and
  // `symbolSize` stretches the six-dash pattern to the bar.
  const medians = {
    name: "median",
    type: "scatter" as const,
    symbol:
      "path://M0,0h4v2h-4zM8,0h4v2h-4zM16,0h4v2h-4zM24,0h4v2h-4zM32,0h4v2h-4zM40,0h4v2h-4z",
    symbolSize: [barWidth + (narrow && dense ? 6 : 12), 2] as [number, number],
    itemStyle: { color: tokens.ink },
    // The dash's name-tag, riding its right end — dropped with the other
    // per-bar ink when ten bars share a phone's width (see `showMarks`).
    label: {
      show: showMarks,
      position: "right" as const,
      distance: narrow ? 2 : 4,
      color: tokens.ink,
      fontSize: narrow ? 9 : 10,
      fontStyle: "italic" as const,
      formatter: () => MEDIAN_SYMBOL,
    },
    emphasis: { scale: false },
    z: 10,
    data: visible.map((category) => dashValue(category, monthCount)),
  };

  return {
    animationDuration: 600,
    // The hover repaint. Long enough to read as the bar coming apart, short
    // enough that sweeping across the bars never feels laggy.
    animationDurationUpdate: 250,
    grid,
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: tokens.surface,
      borderColor: tokens.line,
      textStyle: { color: tokens.text, fontSize: 12 },
      formatter: (params) => {
        const point = params as {
          seriesName: string;
          seriesIndex: number;
          dataIndex: number;
        };
        const category = visible[point.dataIndex];
        if (!category) return "";
        const title = `${categoryIcon(category.key)} ${category.key}`;
        if (point.seriesName === "median") {
          const dash = dashValue(category, monthCount) ?? 0;
          return monthCount === 1
            ? `${title} · median month, last 12: ${formatMoney(dash)}`
            : `${title} · median month × ${monthCount}: ${formatMoney(dash)}`;
        }
        const merchant = category.merchants[point.seriesIndex];
        if (!merchant) return "";
        const share =
          category.total > 0
            ? Math.round((merchant.amount / category.total) * 100)
            : 0;
        return `${merchant.merchant}<br/>${formatMoney(merchant.amount)} · ${share}% of ${category.key}`;
      },
    },
    xAxis: {
      type: "category",
      // The icon, not the name: five multi-word labels collide long before
      // five emoji do. The chips above and the tooltips carry the words.
      data: visible.map((category) => categoryIcon(category.key)),
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      axisTick: { show: false },
      axisLabel: { fontSize: narrow ? 14 : 16, interval: 0 },
    },
    yAxis: {
      type: "value",
      max: peak,
      axisLabel: {
        color: withAlpha(tokens.ink, 0.75),
        fontSize: 10,
        // Same treatment as the trend chart: francs, abbreviated to `2.5k` on
        // a phone where the narrow gutter cannot fit `2’500`.
        formatter: (value: number) => {
          const francs = Math.round(value / 100);
          if (!narrow || Math.abs(francs) < 1000) {
            return francs.toLocaleString("de-CH");
          }
          const thousands = francs / 1000;
          return `${Number(thousands.toFixed(1))}k`;
        },
      },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
    },
    series: [...bars, medians],
  };
}

const PERIOD_LABELS = { month: "This month", ytd: "Year to date" } as const;
type PeriodKey = keyof typeof PERIOD_LABELS;

export function TopCategoryBars({
  data,
  stack,
}: {
  data: CategoryPeriods | null;
  stack: CategoryStack;
}) {
  const tokens = useChartTokens();
  const narrow = useIsNarrow();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Moving between two segments of the same bar fires mouseout-then-mouseover;
  // clearing on a short delay (cancelled by the next mouseover) keeps the bar
  // split across that seam instead of snapping shut and re-opening.
  const events = useMemo(() => {
    const cancel = () => {
      if (clearTimer.current) {
        clearTimeout(clearTimer.current);
        clearTimer.current = null;
      }
    };
    return {
      mouseover: (params: unknown) => {
        cancel();
        const point = params as { componentType?: string; dataIndex?: number };
        if (point.componentType === "series" && typeof point.dataIndex === "number") {
          setHovered(point.dataIndex);
        }
      },
      mouseout: () => {
        cancel();
        clearTimer.current = setTimeout(() => setHovered(null), 140);
      },
      globalout: () => {
        cancel();
        setHovered(null);
      },
    };
  }, []);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const period = data?.[periodKey] ?? null;
  const visible = useMemo(
    () =>
      period
        ? period.categories
            .filter((category) => !hidden.has(category.key))
            .slice(0, SHOWN_CATEGORIES)
        : [],
    [period, hidden],
  );

  const slots = useMemo(() => slotsOf(stack), [stack]);
  const option = useMemo(
    () =>
      tokens && period && visible.length > 0
        ? buildOption(period, visible, slots, tokens, narrow, hovered)
        : null,
    [period, visible, slots, tokens, narrow, hovered],
  );

  if (!data || !period || data.month.categories.length === 0) return null;

  const { name, year } = monthParts(period.month);
  const span =
    periodKey === "month"
      ? `${name} ${year}`
      : `Jan–${MONTH_LABELS[period.monthCount - 1]} ${year}`;

  // The chips: the five on show plus anything hidden, in rank order — a
  // hidden category's chip must stay, or there would be no way back.
  const visibleKeys = new Set(visible.map((category) => category.key));
  const chips = period.categories.filter(
    (category) => visibleKeys.has(category.key) || hidden.has(category.key),
  );

  const toggleHidden = (key: string) => {
    setHovered(null);
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dashMeaning =
    periodKey === "month"
      ? "that category’s median month over the last twelve"
      : `that category’s median month over the last twelve, times the ${period.monthCount} months elapsed this year — the pace a typical month would have set`;

  return (
    <Section
      id="top-categories"
      heading="Top categories"
      meta={`${span} · hover a bar to split it by merchant`}
      panelClassName="p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
        {/* The period badge: one control, two states, so the heading never
            has to change. */}
        <div
          role="group"
          aria-label="Period"
          className="flex shrink-0 rounded-full border border-line-strong bg-surface p-0.5"
        >
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={periodKey === key}
              onClick={() => {
                setHovered(null);
                setPeriodKey(key);
              }}
              className={`h-8 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-colors ${
                periodKey === key
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {PERIOD_LABELS[key]}
            </button>
          ))}
        </div>

        {/* One chip per category on show (plus the hidden ones): the icon the
            axis uses, the name the axis dropped, and the hide toggle. */}
        <div className="flex flex-wrap gap-1.5">
          {chips.map((category) => {
            const isHidden = hidden.has(category.key);
            return (
              <button
                key={category.key}
                type="button"
                aria-pressed={!isHidden}
                aria-label={`${isHidden ? "Show" : "Hide"} ${category.key}`}
                onClick={() => toggleHidden(category.key)}
                className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors ${
                  isHidden
                    ? "border-line bg-transparent text-text-subtle line-through opacity-70 hover:opacity-100"
                    : "border-line-strong bg-surface text-text hover:border-accent"
                }`}
              >
                <span aria-hidden>{categoryIcon(category.key)}</span>
                {category.key}
              </button>
            );
          })}
        </div>
      </div>

      {visible.length > 0 ? (
        <EChart
          option={option}
          height={HEIGHT}
          notMerge={false}
          onEvents={events}
          label={`The ${visible.length} biggest spending categories over ${span} in Swiss francs, each bar splitting into its merchants on hover, with a dotted line marking ${dashMeaning}. The tables below the chart carry the same figures.`}
        />
      ) : (
        /* Everything hidden is a state the chips can produce, so it needs a
           way to read as deliberate — and the box keeps the panel's height so
           unhiding does not jolt the page. */
        <div
          className="flex items-center justify-center text-[13px] text-text-muted"
          style={{ height: HEIGHT }}
        >
          Every category is hidden — tap a chip to bring one back.
        </div>
      )}

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails — and the relief the palette's sub-3:1 fills require.
          Two tables because the two facts have different shapes: per-category
          totals against their medians, then the merchant split within each. */}
      {/* No <caption>: the caption box lives outside the table's clipped box,
          so it escapes sr-only's 1px clip and floats visibly on the page. */}
      <table className="sr-only" aria-label={`Top categories, ${span}`}>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">{PERIOD_LABELS[periodKey]}</th>
            <th scope="col">
              {periodKey === "month"
                ? "Median month, last 12 months"
                : `Median month × ${period.monthCount}`}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((category) => {
            const dash = dashValue(category, period.monthCount);
            return (
              <tr key={category.key}>
                <th scope="row">{category.key}</th>
                <td>{formatMoney(category.total)}</td>
                <td>{dash === null ? "No earlier months" : formatMoney(dash)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table
        className="sr-only"
        aria-label={`Spending by merchant within each top category, ${span}`}
      >
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Merchant</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {visible.flatMap((category) =>
            category.merchants.map((merchant) => (
              <tr key={`${category.key}-${merchant.merchant}`}>
                <th scope="row">{category.key}</th>
                <td>{merchant.merchant}</td>
                <td>{formatMoney(merchant.amount)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>

      <p className="mt-3 font-mono text-[11.5px] text-text-subtle">
        Amounts in CHF. The dotted line marked {MEDIAN_SYMBOL} across each bar
        is {dashMeaning}.
      </p>
    </Section>
  );
}
