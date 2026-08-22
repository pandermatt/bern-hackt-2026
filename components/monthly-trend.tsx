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
 * ink line over them. The bars answer "did this month keep money"; the line
 * answers "where does that leave the account".
 *
 * One plot, two y-axes, **zeros aligned**: a balance is a stock and the nets
 * are flows, and the stock is routinely thirty times the flow — on a shared
 * scale the bars squash into slivers, so each measure reads on its own axis
 * (bars left, balance right), both scaled to put zero on the same gridline.
 * That shared zero is what makes the overlay readable — the line above the
 * baseline means solvent, exactly like a bar above it means surplus. The
 * dual-scale caveat stands: never compare the line's *height* to a bar's,
 * only their signs and shapes; the axes on their own sides say which scale is
 * whose, and only the bars' axis draws gridlines so the plot carries one
 * ruler, not two.
 *
 * A second toggle splits that net back into the two flows that made it: money
 * in above the zero line, money out below, both columns on the month's own
 * tick. It is the same encoding read at a different grain — the net view
 * answers "did this month keep money", the split view answers "on what scale"
 * — which is why it is a mode of this chart rather than a second one.
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
 * story): the sign carries the reading twice — position against the zero line
 * and the in/out direction pair — and the split view is that same pair, not a
 * second dimension. One series, so no legend box; the heading and the meta
 * line name it.
 *
 * `--flow-in` / `--flow-out` because a balance is a direction, not a category.
 * The positive bars are Pistachio *fills*, so they wear `--pistachio-edge` —
 * at 2:1 on white the fill alone does not make a shape perceptible.
 */

/**
 * The height is the same on every screen, deliberately: it is what
 * `app/[locale]/dashboard/loading.tsx` reserves, and a canvas cannot reserve its own
 * space. The phone adapts by giving the plot more of that box, not less of it.
 */
const HEIGHT = 320;
/**
 * On a 390px screen the card leaves ~310px of canvas, and a 58px gutter
 * spends a fifth of it on axis labels. The narrow gutters are paid for by the
 * `2.5k` formatter below. Symmetric gutters: the bars' axis reads on the
 * left, the balance's on the right, so the two label columns never stack into
 * what reads as one axis that resets halfway down. The top holds the hovered
 * amounts; the bottom, the month labels.
 */
const GRID = { left: 58, right: 58, top: 26, bottom: 30 };
const GRID_NARROW = { left: 40, right: 40, top: 24, bottom: 26 };

/** Base and hovered column widths. The growth is symmetric about the tick. */
const BAR = { base: 26, hover: 40 };
const BAR_NARROW = { base: 14, hover: 22 };

/**
 * `net` draws the month's balance as one column; `split` draws the money in
 * and the money out that produced it, diverging from the same zero line.
 */
type TrendMode = "net" | "split";

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
  mode: TrendMode,
): EChartsOption {
  // Both views diverge from the same zero line: the net view draws one column
  // per month, the split view draws the two flows that made it — money in
  // above the line, money out below — so the net stays readable as the
  // difference between them.
  const split = mode === "split";
  const ups = months.flatMap((point) =>
    point ? [split ? point.income : point.net] : [],
  );
  const downs = months.flatMap((point) =>
    point ? [split ? -point.expense : point.net] : [],
  );
  // 8% of headroom past the nice gridline, so the hovered bar's amount label
  // never leaves the plot even on the year's tallest bar.
  const peak = niceCeiling(Math.max(1, ...ups) * 1.08);
  const lowest = Math.min(0, ...downs);
  const floor = lowest < 0 ? -niceCeiling(-lowest * 1.08) : 0;
  // The balance axis, zero-aligned with the bars': both axes give the same
  // *fraction* of their range to the region below zero, so the two zeros land
  // on one shared line. Whichever side needs more room below sets the
  // fraction; the other axis extends past its own data to match. The
  // matched-side minimum keeps its nice figure, the stretched one can go
  // un-nice — its label is hidden below when nothing lives down there.
  const balances = months.flatMap((point) => (point ? [point.balance] : []));
  const balHi = Math.max(1, ...balances);
  const balLo = Math.min(0, ...balances);
  const balMax = niceCeiling(balHi * 1.08);
  const below = Math.max(
    floor < 0 ? -floor / peak : 0,
    balLo < 0 ? -balLo / balMax : 0,
  );
  // The split view spends far more of the plot below zero than the net view
  // does, so the balance line gets squeezed into the upper half with it. That
  // is the price of the shared zero, and the shared zero is what makes the
  // overlay readable — the line keeps its own scale and its own axis labels,
  // so it loses height, not resolution.
  const barMin = -Math.round(below * peak);
  const balMin = -Math.round(below * balMax);
  const bar = narrow ? BAR_NARROW : BAR;
  const grid = narrow ? GRID_NARROW : GRID;
  const monthNames = Array.from({ length: 12 }, (_, index) => monthLabel(index));

  // Where a month's bar end and its balance vertex land, as pixels from the
  // plot top — the one collision the overlay can produce is their two hover
  // labels wanting the same spot. When they would, the bar's amount tucks
  // inside the bar and leaves the airspace to the balance.
  const plotHeight = HEIGHT - grid.top - grid.bottom;
  const labelCollides = months.map((point) => {
    if (!point) return false;
    // Only the upper column can reach the line's airspace.
    const top = split ? point.income : point.net;
    const yEnd = ((peak - top) / (peak - barMin)) * plotHeight;
    const yVertex = ((balMax - point.balance) / (balMax - balMin)) * plotHeight;
    return Math.abs(yEnd - yVertex) < 30;
  });

  // Francs, not rappen. The footnote says CHF once. On a narrow screen
  // thousands are abbreviated too — `2.5k` is three characters where `2’500`
  // is five, which is what buys back the smaller left gutter. Shared by both
  // axes so they cannot drift apart in format.
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
    const point = months[dataIndex];
    if (!point) return null;

    const [x, yZero] = api.coord([dataIndex, 0]);
    const isHovered = hovered === dataIndex;
    const width = isHovered ? bar.hover : bar.base;

    // One rounded column from the zero line out to `value`, plus the amount
    // hanging off its data end. In the split view the two columns share the
    // month's tick and grow in opposite directions, so they meet at zero
    // rather than crowd each other sideways.
    const column = (value: number, labelGap: number) => {
      const [, yEnd] = api.coord([dataIndex, value]);
      const positive = value >= 0;
      const top = Math.min(yEnd, yZero);
      // A near-zero month still gets a perceptible sliver to hover.
      const height = Math.max(2, Math.abs(yZero - yEnd));
      const fill = positive
        ? { fill: tokens.flowIn, stroke: tokens.flowInEdge, lineWidth: 1 }
        : { fill: tokens.flowOut };

      return [
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
        // The amount, hanging off the data end. When the balance vertex's
        // label wants the same airspace, this one steps further out so the
        // two stack — amount above balance — instead of overprinting; inside
        // the bar is no refuge, the colliding line crosses exactly there.
        // Always in the tree with empty text when idle, so hover updates morph
        // the rect instead of replacing a lone rect with a rect-plus-label
        // group.
        {
          type: "text" as const,
          silent: true,
          style: {
            x,
            y: positive ? top - labelGap : top + height + labelGap,
            text: isHovered ? signedFrancs(value) : "",
            align: "center" as const,
            verticalAlign: positive ? ("bottom" as const) : ("top" as const),
            fill: tokens.ink,
            fontSize: 11,
          },
        },
      ];
    };

    // Only the upper column can collide with the balance label; the lower one
    // hangs into empty airspace under the zero line either way.
    const gap = isHovered && labelCollides[dataIndex] ? 24 : 6;

    // Cast because the graphic-element option types don't narrow from these
    // literals; the shape is the documented rect/text group.
    return {
      type: "group" as const,
      children: split
        ? [...column(point.income, gap), ...column(-point.expense, 6)]
        : [...column(point.net, gap)],
    } as unknown as CustomSeriesRenderItemReturn;
  };

  return {
    animationDuration: 600,
    // The hover expansion and the year-step morph. Snappy enough that sweeping
    // across columns never feels laggy.
    animationDurationUpdate: 250,
    grid: narrow ? GRID_NARROW : GRID,
    xAxis: {
      type: "category",
      data: monthNames,
      // With two value axes in one grid, "sit on zero" would be ambiguous —
      // and the month labels belong at the bottom regardless of sign.
      axisLine: { onZero: false, lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      axisTick: { show: false },
      axisLabel: {
        color: tokens.ink,
        fontSize: 11,
        interval: narrow ? 1 : 0,
      },
    },
    yAxis: [
      // The bars' axis — the plot's one set of gridlines.
      {
        type: "value",
        max: peak,
        min: barMin,
        axisLabel: {
          color: withAlpha(tokens.ink, 0.75),
          fontSize: 10,
          formatter: francs,
        },
        splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
      },
      // The balance's axis, on the right. No gridlines of its own — two
      // rulers' worth of lines in one plot read as noise — and the stretched
      // below-zero region's labels are hidden while the balance itself never
      // goes there.
      {
        type: "value",
        position: "right",
        max: balMax,
        min: balMin,
        axisLabel: {
          color: withAlpha(tokens.ink, 0.75),
          fontSize: 10,
          formatter: (value: number) =>
            value < 0 && balLo >= 0 ? "" : francs(value),
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        id: "net",
        type: "custom",
        renderItem,
        encode: { x: 0, y: 1 },
        // Unclipped so a tall bar's amount label can use the grid's own top
        // padding; the rects themselves cannot leave the plot, because the
        // axis extents are derived from the same values they draw.
        clip: false,
        data: months.map((point, index) => [
          index,
          point ? (split ? point.income : point.net) : NaN,
        ]),
      },
      // The running balance, on the right-hand axis. No symbols — the hovered
      // month's vertex grows a value label instead, the same interrogation
      // idiom the bars use. Nulls outside the history span end the line
      // rather than inventing a balance for months that never happened.
      // Unclipped so the vertex label can borrow the grid's top padding.
      {
        id: "balance",
        type: "line",
        yAxisIndex: 1,
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

  const [mode, setMode] = useState<TrendMode>("net");
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
    () =>
      tokens
        ? buildOption(months, tokens, narrow, hovered, monthLabel, mode)
        : null,
    [months, tokens, narrow, hovered, monthLabel, mode],
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

  // The same pill idiom the top-categories controls use.
  const pill = (active: boolean) =>
    `h-8 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-text"
    }`;

  return (
    <Section
      id="trend"
      heading={t("heading")}
      meta={t(mode === "split" ? "metaSplit" : "meta")}
      panelClassName="p-4 sm:p-5"
    >
      {/* The year pager and the view toggle — same pill idiom as the
          top-categories controls. Wrapping, because the two groups together
          are wider than a 375px card. */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
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

        <div
          role="group"
          aria-label={t("viewAria")}
          className="flex rounded-full border border-line-strong bg-surface p-0.5"
        >
          {(["net", "split"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => {
                setHovered(null);
                setMode(key);
              }}
              className={pill(mode === key)}
            >
              {t(key === "net" ? "viewNet" : "viewSplit")}
            </button>
          ))}
        </div>
      </div>

      <EChart
        option={option}
        height={HEIGHT}
        notMerge={false}
        onEvents={events}
        label={t(mode === "split" ? "chartLabelSplit" : "chartLabel", { year })}
      />

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. Also the relief a sub-3:1 fill requires. Every year at
          once, so nobody has to operate the stepper to hear the history — and
          both flows in every row, so it answers for either view without
          anyone having to find the toggle first. */}
      {/* No <caption>: the caption box lives outside the table's clipped box,
          so it escapes sr-only's 1px clip and floats visibly on the page. */}
      <div className="sr-only">
        <table aria-label={t("tableLabel")}>
          <thead>
            <tr>
              <th scope="col">{t("month")}</th>
              <th scope="col">{t("moneyIn")}</th>
              <th scope="col">{t("moneyOut")}</th>
              <th scope="col">{t("net")}</th>
              <th scope="col">{t("balance")}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.month}>
                <th scope="row">{point.month}</th>
                <td>{signedMoney(point.income)}</td>
                <td>{signedMoney(-point.expense)}</td>
                <td>{signedMoney(point.net)}</td>
                <td>{signedMoney(point.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-mono text-[11.5px] text-text-subtle">
        {t(mode === "split" ? "footnoteSplit" : "footnote")}
      </p>
    </Section>
  );
}
