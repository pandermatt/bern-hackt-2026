"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import {
  EChart,
  slotColor,
  useChartTokens,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import type { PieChartSpec } from "@/lib/assistant";
import { formatMoney } from "@/lib/insights";

/**
 * The assistant's chart bubble, drawn by the same ECharts stack as the
 * dashboard's donut so the two read as one system. Slices arrive ranked from
 * `lib/assistant.ts`, so the slot is the rank — except "Other", which is
 * always the neutral fold-in bucket, matching the dashboard's convention.
 *
 * No outside labels: at bubble width they would clip, so identity lives in
 * the legend, and the sr-only table carries every figure.
 */
const HEIGHT = 210;

function buildOption(chart: PieChartSpec, tokens: ChartTokens): EChartsOption {
  return {
    animationDuration: 500,
    legend: {
      type: "scroll",
      bottom: 0,
      icon: "roundRect",
      itemWidth: 9,
      itemHeight: 9,
      itemGap: 10,
      textStyle: { color: tokens.textMuted, fontSize: 11 },
      pageIconColor: tokens.textMuted,
      pageIconInactiveColor: tokens.line,
      pageTextStyle: { color: tokens.textSubtle },
    },
    series: [
      {
        type: "pie",
        radius: ["52%", "74%"] as [string, string],
        center: ["50%", "44%"] as [string, string],
        padAngle: 2,
        itemStyle: {
          borderRadius: 4,
          borderColor: tokens.surface,
          borderWidth: 1,
        },
        label: { show: false },
        emphasis: { scaleSize: 5 },
        data: chart.slices.map((slice, index) => ({
          name: slice.label,
          value: slice.amountMinor,
          itemStyle: {
            color: slotColor(tokens, slice.label === "Other" ? 0 : index + 1),
          },
        })),
      },
    ],
  };
}

export function ChatPie({ chart }: { chart: PieChartSpec }) {
  const t = useTranslations("Chat");
  const tokens = useChartTokens();
  const option = useMemo(
    () => (tokens ? buildOption(chart, tokens) : null),
    [chart, tokens],
  );

  if (chart.slices.length === 0) return null;

  return (
    <figure>
      <figcaption className="text-[13px] font-semibold text-text">
        {chart.title}
      </figcaption>

      <div className="relative mt-1">
        <EChart
          option={option}
          height={HEIGHT}
          label={t("pieChartLabel", { title: chart.title })}
        />

        {/* The donut's middle as real HTML, matching the dashboard donut:
            server-rendered, type tokens, selectable. `44%` matches the
            series' own centre. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-[44%] -translate-y-1/2 text-center"
          aria-hidden
        >
          <p className="font-mono text-[12.5px] font-medium tabular-nums text-text">
            {formatMoney(chart.totalMinor)}
          </p>
          <p className="text-[10px] font-medium tracking-wide text-text-subtle uppercase">
            {t("pieTotal")}
          </p>
        </div>
      </div>

      {/* No <caption>: the caption box lives outside the table's clipped box,
          so it escapes sr-only's 1px clip and floats visibly on the page.
          The aria-label names the table without rendering anything. */}
      <div className="sr-only">
        <table aria-label={chart.title}>
          <thead>
            <tr>
              <th scope="col">{t("pieSlice")}</th>
              <th scope="col">{t("pieAmount")}</th>
              <th scope="col">{t("pieShare")}</th>
            </tr>
          </thead>
          <tbody>
            {chart.slices.map((slice) => (
              <tr key={slice.label}>
                <th scope="row">{slice.label}</th>
                <td>{formatMoney(slice.amountMinor)}</td>
                <td>{slice.share.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
