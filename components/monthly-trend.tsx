"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import {
  EChart,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import { Section } from "@/components/section";
import { formatMoney, type MonthPoint } from "@/lib/insights";
import { useIsNarrow } from "@/lib/use-hydrated";

/**
 * Money in against money out, month by month, as two overlaid areas.
 *
 * Deliberately **not** broken down by category. The donut below tells the
 * category story. This chart answers the one question it cannot — whether a
 * month earned more than it spent — and a nine-band stack was drowning that in
 * detail.
 *
 * The areas overlap rather than stack. Stacking income on top of spending sums
 * to a number that means nothing; overlaying them makes the gap between the
 * two curves the thing you actually read, which is the month's net.
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
 * `2.5k` formatter below.
 */
const GRID = { left: 58, right: 14, top: 16, bottom: 46 };
const GRID_NARROW = { left: 40, right: 10, top: 16, bottom: 40 };

/** Rounds a rappen amount up to a tidy gridline so the axis reads cleanly. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

function buildOption(
  series: MonthPoint[],
  tokens: ChartTokens,
  narrow: boolean,
  labels: { month: (point: MonthPoint) => string; in: string; out: string },
): EChartsOption {
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
    symbol: "circle",
    symbolSize: 7,
    emphasis: { focus: "series" as const },
    data: values,
  });

  return {
    animationDuration: 600,
    grid: narrow ? GRID_NARROW : GRID,
    legend: {
      bottom: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: narrow ? 12 : 16,
      textStyle: { color: tokens.textMuted, fontSize: 12 },
    },
    xAxis: {
      type: "category",
      data: series.map(labels.month),
      boundaryGap: false,
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      axisTick: { show: false },
      axisLabel: { color: tokens.ink, fontSize: 11, interval: narrow ? 1 : "auto" },
    },
    yAxis: {
      type: "value",
      max: peak,
      axisLabel: {
        color: withAlpha(tokens.ink, 0.75),
        fontSize: 10,
        // Francs, not rappen. The footnote says CHF once. On a narrow screen
        // thousands are abbreviated too — `2.5k` is three characters where
        // `2’500` is five, which is what buys back the smaller left gutter.
        formatter: (value: number) => {
          const francs = Math.round(value / 100);
          if (!narrow || Math.abs(francs) < 1000) {
            return francs.toLocaleString("de-CH");
          }
          const thousands = francs / 1000;
          // A trailing `.0` costs a character and says nothing.
          return `${Number(thousands.toFixed(1))}k`;
        },
      },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
    },
    series: [
      line(labels.in, tokens.flowIn, series.map((point) => point.income)),
      line(labels.out, tokens.flowOut, series.map((point) => point.expense)),
    ],
  };
}

export function MonthlyTrend({ series }: { series: MonthPoint[] }) {
  const t = useTranslations("Trend");
  const tMonths = useTranslations("Months");
  const tokens = useChartTokens();
  const narrow = useIsNarrow();

  // The axis labels come from the catalog rather than from `point.label`, which
  // `lib/insights.ts` fills in English. That module is pure and has no locale
  // to read, so the translation happens at the one place that does.
  const labels = useMemo(
    () => ({
      month: (point: MonthPoint) => tMonths(`short${Number(point.month.slice(5, 7))}`),
      in: t("seriesIn"),
      out: t("seriesOut"),
    }),
    [t, tMonths],
  );

  const option = useMemo(
    () => (tokens ? buildOption(series, tokens, narrow, labels) : null),
    [series, tokens, narrow, labels],
  );

  if (series.length === 0) return null;

  return (
    <Section
      id="trend"
      heading={t("heading")}
      meta={t("meta")}
      panelClassName="p-4 sm:p-5"
    >
      <EChart
        option={option}
        height={HEIGHT}
        label={t("chartLabel", {
          first: series[0].month,
          last: series[series.length - 1].month,
        })}
      />

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails. Also the relief a sub-3:1 fill requires. */}
      {/* No <caption>: the caption box lives outside the table's clipped box,
          so it escapes sr-only's 1px clip and floats visibly on the page. */}
      <table className="sr-only" aria-label={t("tableLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("month")}</th>
            <th scope="col">{t("in")}</th>
            <th scope="col">{t("out")}</th>
            <th scope="col">{t("net")}</th>
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

      <p className="mt-3 font-mono text-[11.5px] text-text-subtle">
        {t("footnote")}
      </p>
    </Section>
  );
}
