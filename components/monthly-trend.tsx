"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EChart,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type CustomSeriesRenderItem,
  type CustomSeriesRenderItemReturn,
  type EChartsOption,
} from "@/components/echart";
import { Section } from "@/components/section";
import { formatMoney, type MonthPoint } from "@/lib/insights";
import { useIsNarrow } from "@/lib/use-hydrated";

/**
 * The month's net balance — money in minus money out — as bars diverging from
 * a zero line, one year at a time, with the **running account balance** as an
 * ink line in its own slim panel above the bars. The bars answer "did this
 * month keep money"; the line answers "where does that leave the account".
 *
 * Two aligned panels, not one plot and not two y-axes: a balance is a stock
 * and the nets are flows, and the stock is routinely thirty times the flow —
 * on a shared scale the bars squash into slivers, and a second axis on the
 * same plot is the dual-axis chart this codebase does not draw. The panels
 * share the month axis (and the hover), so a column reads vertically through
 * both.
 *
 * A stepper pages between the years the statements cover, and hovering a
 * column widens it and hangs its amount off the data end — the hover feedback
 * *is* the tooltip, so there is no second floating box saying the same thing.
 * The hovered month's balance rides the line's vertex the same way.
 *
 * The line wears `--chart-ink`, the palette's annotation role — a balance is
 * neither a category nor a direction, and the only line in the chart needs no
 * colour identity; the meta line and the footnote name it.
 *
 * The bars are a `custom` series, not a `bar` series, because the expansion is
 * per column: a bar series has one `barWidth` for all its marks, and every
 * multi-series workaround (overlaid series, pictorial bars) either expands
 * off-centre or loses the rounded data end. `renderItem` draws each month as
 * its own rounded rect, so the hovered one can grow symmetrically in place —
 * `transition: ["shape"]` is what animates the growth.
 *
 * Deliberately **not** broken down by category (the donut below owns that
 * story), and deliberately balance-only: the sign carries the reading twice —
 * position against the zero line and the in/out direction pair. One series, so
 * no legend box; the heading names it.
 *
 * `--flow-in` / `--flow-out` because a balance is a direction, not a category.
 * The positive bars are Pistachio *fills*, so they wear `--pistachio-edge` —
 * at 2:1 on white the fill alone does not make a shape perceptible.
 */

/**
 * The height is the same on every screen, deliberately: it is what
 * `app/(dashboard)/loading.tsx` reserves, and a canvas cannot reserve its own
 * space. The phone adapts by giving the plot more of that box, not less of it.
 */
const HEIGHT = 320;
/**
 * On a 390px screen the card leaves ~310px of canvas, and a 58px left gutter
 * spends a fifth of it on axis labels. The narrow gutter is paid for by the
 * `2.5k` formatter below. The balance panel sits on top (its `top` leaves
 * room for the hovered vertex's amount label); the bars panel takes the rest,
 * with the bottom holding the month labels. `PANEL_GAP` keeps the balance
 * panel's gridlines and the tallest bar's hover label apart.
 */
const BALANCE_PANEL = { left: 58, right: 14, top: 26, height: 72 };
const BALANCE_PANEL_NARROW = { left: 40, right: 10, top: 24, height: 60 };
const PANEL_GAP = 22;
const GRID = { left: 58, right: 14, bottom: 30 };
const GRID_NARROW = { left: 40, right: 10, bottom: 26 };

/** Base and hovered column widths. The growth is symmetric about the tick. */
const BAR = { base: 26, hover: 40 };
const BAR_NARROW = { base: 14, hover: 22 };

/** Rounds a rappen amount up to a tidy gridline so the axis reads cleanly. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

/** Unsigned `formatMoney` plus a real minus glyph — the app-wide convention. */
function signedMoney(rappen: number): string {
  return `${rappen < 0 ? "−" : ""}${formatMoney(rappen)}`;
}

/** The hover label: whole francs, real minus — the footnote says CHF once. */
function signedFrancs(rappen: number): string {
  const francs = Math.round(Math.abs(rappen) / 100).toLocaleString("de-CH");
  return rappen < 0 ? `−${francs}` : francs;
}

function buildOption(
  months: (MonthPoint | null)[],
  tokens: ChartTokens,
  narrow: boolean,
  hovered: number | null,
  monthLabel: (index: number) => string,
): EChartsOption {
  const nets = months.flatMap((point) => (point ? [point.net] : []));
  // 8% of headroom past the nice gridline, so the hovered bar's amount label
  // never leaves the plot even on the year's tallest bar.
  const peak = niceCeiling(Math.max(1, ...nets) * 1.08);
  const lowest = Math.min(0, ...nets);
  const floor = lowest < 0 ? -niceCeiling(-lowest * 1.08) : 0;
  const bar = narrow ? BAR_NARROW : BAR;
  const balGrid = narrow ? BALANCE_PANEL_NARROW : BALANCE_PANEL;
  const barGrid = {
    ...(narrow ? GRID_NARROW : GRID),
    top: balGrid.top + balGrid.height + PANEL_GAP,
  };
  const monthNames = Array.from({ length: 12 }, (_, index) => monthLabel(index));

  // Francs, not rappen. The footnote says CHF once. On a narrow screen
  // thousands are abbreviated too — `2.5k` is three characters where `2’500`
  // is five, which is what buys back the smaller left gutter. Shared by both
  // panels' axes so they cannot drift apart in format.
  const francs = (value: number) => {
    const whole = Math.round(value / 100);
    if (!narrow || Math.abs(whole) < 1000) {
      return whole.toLocaleString("de-CH").replace("-", "−");
    }
    const thousands = whole / 1000;
    // A trailing `.0` costs a character and says nothing.
    return `${Number(thousands.toFixed(1))}k`.replace("-", "−");
  };

  const renderItem: CustomSeriesRenderItem = (params, api) => {
    const { dataIndex } = params;
    const net = api.value(1) as number;
    if (!Number.isFinite(net)) return null;

    const [x, yEnd] = api.coord([dataIndex, net]);
    const [, yZero] = api.coord([dataIndex, 0]);
    const positive = net >= 0;
    const isHovered = hovered === dataIndex;
    const width = isHovered ? bar.hover : bar.base;
    const top = Math.min(yEnd, yZero);
    // A near-zero month still gets a perceptible sliver to hover.
    const height = Math.max(2, Math.abs(yZero - yEnd));
    const fill = positive
      ? { fill: tokens.flowIn, stroke: tokens.flowInEdge, lineWidth: 1 }
      : { fill: tokens.flowOut };

    // Cast because the graphic-element option types don't narrow from this
    // literal; the shape is the documented rect/text group.
    return {
      type: "group" as const,
      children: [
        {
          type: "rect" as const,
          shape: {
            x: x - width / 2,
            y: top,
            width,
            height,
            // The rounded end is the data end, so it flips on a negative bar.
            r: positive ? [4, 4, 0, 0] : [0, 0, 4, 4],
          },
          style: fill,
          // Pin the hover state to the normal style: the width change is the
          // hover feedback, and the default emphasis lift would repaint the
          // fill off its token on top of it.
          emphasis: { style: fill },
          // Width and value changes morph in place — this is the expansion.
          transition: ["shape" as const, "style" as const],
          enterFrom: { shape: { y: yZero, height: 0 } },
        },
        // The amount, hanging off the data end. Always in the tree with empty
        // text when idle, so hover updates morph the rect instead of replacing
        // a lone rect with a rect-plus-label group.
        {
          type: "text" as const,
          silent: true,
          style: {
            x,
            y: positive ? top - 6 : top + height + 6,
            text: isHovered ? signedFrancs(net) : "",
            align: "center" as const,
            verticalAlign: positive ? ("bottom" as const) : ("top" as const),
            fill: tokens.ink,
            fontSize: 11,
          },
        },
      ],
    } as unknown as CustomSeriesRenderItemReturn;
  };

  return {
    animationDuration: 600,
    // The hover expansion and the year-step morph. Snappy enough that sweeping
    // across columns never feels laggy.
    animationDurationUpdate: 250,
    // Panel 0 is the balance strip, panel 1 the bars. They share the left
    // gutter, so the two plots align column for column.
    grid: [balGrid, barGrid],
    xAxis: [
      // The balance panel's month bands — hidden, the bottom axis names them.
      { gridIndex: 0, type: "category", data: monthNames, show: false },
      {
        gridIndex: 1,
        type: "category",
        data: monthNames,
        axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
        axisTick: { show: false },
        axisLabel: {
          color: tokens.ink,
          fontSize: 11,
          interval: narrow ? 1 : 0,
        },
      },
    ],
    yAxis: [
      {
        gridIndex: 0,
        type: "value",
        // Auto-scaled around the data, not zero-based: a slim strip showing a
        // stock is a sparkline, and pinning it to zero flattens the drift that
        // is the whole story. A line has no area to lie about.
        scale: true,
        // A slim panel affords two bands, no more.
        splitNumber: 2,
        axisLabel: {
          color: withAlpha(tokens.ink, 0.75),
          fontSize: 10,
          formatter: francs,
        },
        splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.12) } },
      },
      {
        gridIndex: 1,
        type: "value",
        max: peak,
        min: floor,
        axisLabel: {
          color: withAlpha(tokens.ink, 0.75),
          fontSize: 10,
          formatter: francs,
        },
        splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
      },
    ],
    series: [
      {
        id: "net",
        type: "custom",
        xAxisIndex: 1,
        yAxisIndex: 1,
        renderItem,
        encode: { x: 0, y: 1 },
        // Unclipped so a tall bar's amount label can use the grid's own top
        // padding; the rects themselves cannot leave the plot, because the
        // axis extents are derived from the same values they draw.
        clip: false,
        data: months.map((point, index) => [index, point ? point.net : NaN]),
      },
      // The running balance, in its own panel. No symbols — the hovered
      // month's vertex grows a value label instead, the same interrogation
      // idiom the bars use. Nulls outside the history span end the line
      // rather than inventing a balance for months that never happened.
      // Unclipped so the vertex label can borrow the panel's top padding.
      {
        id: "balance",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        clip: false,
        smooth: false,
        // A label rides its point's symbol, so the symbols have to exist —
        // they are simply size zero until their month is hovered, when the
        // vertex grows a dot to hang the amount off.
        showSymbol: true,
        symbolSize: (_value: unknown, params: unknown) =>
          (params as { dataIndex: number }).dataIndex === hovered ? 7 : 0,
        connectNulls: false,
        lineStyle: { color: withAlpha(tokens.ink, 0.8), width: 2 },
        itemStyle: { color: tokens.ink },
        // One series-level label whose formatter answers only for the hovered
        // month — per-item label toggles do not survive merged updates.
        label: {
          show: true,
          position: "top",
          distance: 6,
          color: tokens.ink,
          fontSize: 10.5,
          formatter: (params: unknown) => {
            const { dataIndex } = params as { dataIndex: number };
            const point = months[dataIndex];
            return hovered === dataIndex && point
              ? signedFrancs(point.balance)
              : "";
          },
        },
        data: months.map((point) => (point ? point.balance : null)),
      },
      // A custom series cannot carry a markLine, so an empty bar series holds
      // the zero baseline the bars diverge from — heavier than the grid so
      // "above or below" is readable at a glance.
      {
        id: "baseline",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        silent: true,
        data: [],
        markLine: {
          silent: true,
          symbol: "none",
          animation: false,
          label: { show: false },
          lineStyle: {
            color: withAlpha(tokens.ink, 0.45),
            width: 1,
            type: "solid" as const,
          },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
}

export function MonthlyTrend({ series }: { series: MonthPoint[] }) {
  const t = useTranslations("Trend");
  const tMonths = useTranslations("Months");
  const tokens = useChartTokens();
  const narrow = useIsNarrow();

  // The years the statements cover, ascending. The stepper walks this list —
  // it never offers a year with no data.
  const years = useMemo(
    () => [...new Set(series.map((point) => point.month.slice(0, 4)))].sort(),
    [series],
  );
  const [chosenYear, setChosenYear] = useState<string | null>(null);
  const year = chosenYear ?? years[years.length - 1];
  const yearIndex = years.indexOf(year);

  const [hovered, setHovered] = useState<number | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sweeping across a column's edge fires mouseout-then-mouseover; clearing on
  // a short delay (cancelled by the next mouseover) keeps the expansion from
  // snapping shut and re-opening between neighbours.
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

  // Always twelve slots, January to December, empty months as gaps — the
  // x axis keeps one shape whichever year is showing, so stepping morphs the
  // bars instead of reflowing the plot.
  const months = useMemo<(MonthPoint | null)[]>(() => {
    const slots: (MonthPoint | null)[] = Array.from({ length: 12 }, () => null);
    for (const point of series) {
      if (point.month.slice(0, 4) === year) {
        slots[Number(point.month.slice(5, 7)) - 1] = point;
      }
    }
    return slots;
  }, [series, year]);

  // The axis labels come from the catalog rather than from `point.label`, which
  // `lib/insights.ts` fills in English. That module is pure and has no locale
  // to read, so the translation happens at the one place that does.
  const monthLabel = useMemo(
    () => (index: number) => tMonths(`short${index + 1}`),
    [tMonths],
  );

  const option = useMemo(
    () => (tokens ? buildOption(months, tokens, narrow, hovered, monthLabel) : null),
    [months, tokens, narrow, hovered, monthLabel],
  );

  if (series.length === 0) return null;

  const stepYear = (delta: number) => {
    const next = years[yearIndex + delta];
    if (!next) return;
    setHovered(null);
    setChosenYear(next);
  };

  const stepButton =
    "flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors hover:text-text disabled:cursor-default disabled:opacity-40 disabled:hover:text-text-muted";

  return (
    <Section
      id="trend"
      heading={t("heading")}
      meta={t("meta")}
      panelClassName="p-4 sm:p-5"
    >
      {/* The year pager — same pill idiom as the top-categories controls. */}
      <div className="flex items-center pb-3">
        <div
          role="group"
          aria-label={t("yearAria")}
          className="flex items-center rounded-full border border-line-strong bg-surface p-0.5"
        >
          <button
            type="button"
            aria-label={t("prevYear")}
            disabled={yearIndex <= 0}
            onClick={() => stepYear(-1)}
            className={stepButton}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span
            aria-live="polite"
            className="min-w-12 text-center font-mono text-[13px] font-medium tabular-nums"
          >
            {year}
          </span>
          <button
            type="button"
            aria-label={t("nextYear")}
            disabled={yearIndex >= years.length - 1}
            onClick={() => stepYear(1)}
            className={stepButton}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <EChart
        option={option}
        height={HEIGHT}
        notMerge={false}
        onEvents={events}
        label={t("chartLabel", { year })}
      />

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. Also the relief a sub-3:1 fill requires. Every year at
          once, so nobody has to operate the stepper to hear the history. */}
      {/* No <caption>: the caption box lives outside the table's clipped box,
          so it escapes sr-only's 1px clip and floats visibly on the page. */}
      <table className="sr-only" aria-label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("month")}</th>
            <th scope="col">{t("net")}</th>
            <th scope="col">{t("balance")}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.month}>
              <th scope="row">{point.month}</th>
              <td>{signedMoney(point.net)}</td>
              <td>{signedMoney(point.balance)}</td>
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
      </div>

      <p className="mt-3 font-mono text-[11.5px] text-text-subtle">
        {t("footnote")}
      </p>
    </Section>
  );
}
