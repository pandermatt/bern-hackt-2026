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
 * The month's net balance — money in minus money out — as bars diverging from
 * a zero line.
 *
 * Deliberately **not** broken down by category (the donut below owns that
 * story), and deliberately balance-only: this chart answers the one question
 * "did the month keep money or overspend", and the sign carries it twice —
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
 * `2.5k` formatter below. No legend strip — a single series needs none — so
 * the bottom holds only the month labels.
 */
const GRID = { left: 58, right: 14, top: 16, bottom: 30 };
const GRID_NARROW = { left: 40, right: 10, top: 16, bottom: 26 };

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

function buildOption(
  series: MonthPoint[],
  tokens: ChartTokens,
  narrow: boolean,
  labels: { month: (point: MonthPoint) => string },
): EChartsOption {
  const nets = series.map((point) => point.net);
  const peak = niceCeiling(Math.max(1, ...nets));
  const lowest = Math.min(0, ...nets);
  const floor = lowest < 0 ? -niceCeiling(-lowest) : 0;

  return {
    animationDuration: 600,
    grid: narrow ? GRID_NARROW : GRID,
    tooltip: {
      trigger: "axis",
      // The whole month column is the hit target, not just the bar — a small
      // near-zero bar would otherwise be almost impossible to hover.
      axisPointer: { type: "shadow" },
      confine: true,
      backgroundColor: tokens.surface,
      borderColor: tokens.line,
      textStyle: { color: tokens.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const [point] = params as { dataIndex: number }[];
        const month = series[point.dataIndex];
        if (!month) return "";
        // Month plus year: the axis can afford the ambiguity of a bare "Nov"
        // across several years, the tooltip cannot.
        return `${labels.month(month)} ${month.month.slice(0, 4)}<br/>${signedMoney(month.net)}`;
      },
    },
    xAxis: {
      type: "category",
      data: series.map(labels.month),
      // The default puts a category axis on the value axis's zero — which,
      // with negative months, floats the month labels into the middle of the
      // plot. The axis stays at the bottom; the markLine below draws the zero.
      axisLine: { onZero: false, lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      axisTick: { show: false },
      axisLabel: { color: tokens.ink, fontSize: 11, interval: narrow ? 1 : "auto" },
    },
    yAxis: {
      type: "value",
      max: peak,
      min: floor,
      axisLabel: {
        color: withAlpha(tokens.ink, 0.75),
        fontSize: 10,
        // Francs, not rappen. The footnote says CHF once. On a narrow screen
        // thousands are abbreviated too — `2.5k` is three characters where
        // `2’500` is five, which is what buys back the smaller left gutter.
        formatter: (value: number) => {
          const francs = Math.round(value / 100);
          if (!narrow || Math.abs(francs) < 1000) {
            return francs.toLocaleString("de-CH").replace("-", "−");
          }
          const thousands = francs / 1000;
          // A trailing `.0` costs a character and says nothing.
          return `${Number(thousands.toFixed(1))}k`.replace("-", "−");
        },
      },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: narrow ? 16 : 28,
        data: series.map((point) => ({
          value: point.net,
          // Direction pair, not category slots: positive months in `flow-in`,
          // negative in `flow-out`. The rounded end is the data end, so it
          // flips to the bottom on a negative bar.
          itemStyle:
            point.net >= 0
              ? {
                  color: tokens.flowIn,
                  borderColor: tokens.flowInEdge,
                  borderWidth: 1,
                  borderRadius: [4, 4, 0, 0],
                }
              : {
                  color: tokens.flowOut,
                  borderRadius: [0, 0, 4, 4],
                },
        })),
        // The zero baseline the bars diverge from — heavier than the grid so
        // "above or below" is readable at a glance.
        markLine: {
          silent: true,
          symbol: "none",
          animation: false,
          label: { show: false },
          lineStyle: { color: withAlpha(tokens.ink, 0.45), width: 1, type: "solid" as const },
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

  // The axis labels come from the catalog rather than from `point.label`, which
  // `lib/insights.ts` fills in English. That module is pure and has no locale
  // to read, so the translation happens at the one place that does.
  const labels = useMemo(
    () => ({
      month: (point: MonthPoint) => tMonths(`short${Number(point.month.slice(5, 7))}`),
    }),
    [tMonths],
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
            <th scope="col">{t("net")}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.month}>
              <th scope="row">{point.month}</th>
              <td>{signedMoney(point.net)}</td>
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
