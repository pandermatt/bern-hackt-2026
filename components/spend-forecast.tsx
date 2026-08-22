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
import { formatMoney, type SpendForecast } from "@/lib/insights";

/**
 * One year of spending inside a summary tile: solid where the statements
 * reach, then dashed at the run rate — shaped by the statements' own
 * seasonality, see `seasonalFactors` — to the end of that year and no
 * further.
 *
 * The stroke change is the whole message — it is where recorded stops and
 * projected starts — so the two are separate series over one axis rather than
 * one series with a styled tail, and they share the last recorded month's
 * vertex (see `spendForecast`) so the join is continuous.
 *
 * No axes. At ~190px of desktop column there is no room for furniture, and
 * the year is named in HTML below the canvas instead, where it costs no plot
 * width. The figures live in the tile's `sr-only` table, server-rendered like
 * every other chart's — the accessibility contract does not lapse just
 * because the chart is 60px tall.
 *
 * `--flow-out`, not a `--chart-N` slot: money out is a direction, not a
 * category.
 */

/**
 * Reserved in `app/[locale]/dashboard/loading.tsx`, which a canvas cannot do
 * for itself. Change it in both places or the page jumps on every filter.
 */
export const FORECAST_HEIGHT = 60;

function buildOption(
  forecast: SpendForecast,
  tokens: ChartTokens,
  text: { actual: string; projected: string },
): EChartsOption {
  const line = {
    type: "line" as const,
    showSymbol: false,
    smooth: false,
    // A 60px sparkline reads at a glance or not at all; there is nothing a
    // pointer could usefully single out, so the series take no mouse events.
    silent: true,
    // Both series read the same axis, so neither may drop its nulls onto the
    // next point along — the gap is the point.
    connectNulls: false,
  };

  return {
    animationDuration: 500,
    grid: { left: 2, right: 2, top: 6, bottom: 2, containLabel: false },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: forecast.points.map((point) => point.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      // From zero: a spending line floated on its own minimum turns a steady
      // year into dramatic peaks.
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    series: [
      {
        ...line,
        id: "actual",
        name: text.actual,
        lineStyle: { color: tokens.flowOut, width: 2 },
        itemStyle: { color: tokens.flowOut },
        areaStyle: { color: withAlpha(tokens.flowOut, 0.14) },
        data: forecast.points.map((point) => point.actual),
      },
      {
        ...line,
        id: "projected",
        name: text.projected,
        lineStyle: { color: withAlpha(tokens.flowOut, 0.55), width: 2, type: "dashed" },
        itemStyle: { color: withAlpha(tokens.flowOut, 0.55) },
        data: forecast.points.map((point) => point.projected),
      },
    ],
  };
}

export function SpendForecastChart({ forecast }: { forecast: SpendForecast }) {
  const t = useTranslations("Summary");
  const tokens = useChartTokens();
  const text = useMemo(
    () => ({ actual: t("forecastActual"), projected: t("forecastProjected") }),
    [t],
  );
  const option = useMemo(
    () => (tokens ? buildOption(forecast, tokens, text) : null),
    [forecast, tokens, text],
  );

  return (
    <div className="mt-2">
      <EChart
        option={option}
        height={FORECAST_HEIGHT}
        label={t("forecastLabel", {
          year: forecast.year,
          average: formatMoney(forecast.average),
        })}
      />
      {/* The year as HTML, under the start of the axis — an ECharts axis
          would spend plot width on the same four digits. */}
      <div className="text-[11px] text-text-subtle tabular-nums">
        {forecast.year}
      </div>
    </div>
  );
}
