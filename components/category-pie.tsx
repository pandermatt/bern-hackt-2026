"use client";

import { useMemo } from "react";

import {
  EChart,
  slotColor,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import { Section } from "@/components/section";
import { formatMoney, type CategoryStack } from "@/lib/insights";
import { useIsNarrow } from "@/lib/use-hydrated";

/**
 * The year in one shape: how the whole range's spending divides between
 * categories.
 *
 * Deliberately **not** filtered. It answers "what does my year look like",
 * which is a question the ledger's filters would destroy the moment someone
 * narrows to a month — the same reasoning that keeps the trend chart on the
 * unfiltered set.
 *
 * It is now the page's **only** category breakdown. The ranked "Where it goes"
 * list used to sit directly below saying the same thing a second way; that is
 * why the legend below is no longer optional on a phone.
 */

const HEIGHT = 320;
/**
 * Below this share a wedge is thinner than its own leader line, so the labels
 * are placed selectively rather than on all nine. The legend and the table
 * name the rest.
 */
const LABEL_THRESHOLD = 0.04;

function buildOption(
  stack: CategoryStack,
  tokens: ChartTokens,
  narrow: boolean,
): EChartsOption {
  return {
    animationDuration: 600,
    legend: {
      /*
       * Shown on every width, and load-bearing on a phone.
       *
       * It used to be hidden below `sm`, because a scrolling legend pages four
       * bands at a time and "Where it goes" sat right underneath naming all
       * eleven. That list is gone, and the on-wedge labels are still dropped on
       * a narrow canvas for want of margin — so without this the donut would
       * carry no visible category name at all, and six of these ten fills are
       * under 3:1 on white. Paging a legend beats an unreadable chart.
       */
      show: true,
      type: "scroll",
      bottom: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: narrow ? 10 : 14,
      textStyle: { color: tokens.textMuted, fontSize: 12 },
      pageIconColor: tokens.textMuted,
      pageIconInactiveColor: tokens.line,
      pageTextStyle: { color: tokens.textSubtle },
    },
    series: [
      {
        type: "pie",
        // A donut, so the middle can carry the total rather than a bare hole.
        // The inner radius is set by the centre label, not by taste: the hole
        // has to be wider than "CHF 92'969.40" renders at 15px mono, or the
        // total sits on top of the ring.
        // Outside labels and their leader lines need ~90px of margin per side,
        // which a ~310px canvas does not have — so on a phone they come off
        // (see the `label.show` note below). The geometry is the same on every
        // width regardless: the legend occupies the strip at the bottom in both
        // cases, so the donut sits above it in both. The HTML centre overlay is
        // pinned to the same 45%.
        radius: ["55%", "74%"] as [string, string],
        center: ["50%", "45%"] as [string, string],
        // Wedges are drawn in data order, which is rank order, so the pie and
        // the list below it run in the same sequence.
        // The requested separation. It does the same job the 2px surface
        // stroke does on the stacked area: two neighbouring wedges never
        // share an edge, which is what lets adjacent hues stay legible.
        padAngle: 2,
        itemStyle: {
          borderRadius: 5,
          // The panel's ground, not `--surface`: these separators read as the
          // page showing between the wedges, and the page behind this chart is
          // now the section panel's grey.
          borderColor: tokens.surfaceMuted,
          borderWidth: 1,
        },
        label: {
          // Dark neutral, the palette's text/connector role.
          color: tokens.ink,
          fontSize: 11.5,
          formatter: (params) => {
            const point = params as { name: string; percent?: number };
            return `${point.name}  ${(point.percent ?? 0).toFixed(0)}%`;
          },
        },
        labelLine: { length: 10, length2: 12, lineStyle: { color: withAlpha(tokens.ink, 0.4) } },
        // Never let two labels stack on top of each other; drop one instead.
        labelLayout: { hideOverlap: true },
        emphasis: {
          scaleSize: 6,
          label: { color: tokens.text, fontWeight: "bold" },
        },
        data: stack.bands.map((band) => ({
          name: band.key,
          value: band.total,
          itemStyle: { color: slotColor(tokens, band.slot) },
          label: {
            // Dropped wholesale on a narrow screen: there is no margin to place
            // them in, and they would be drawn past the canvas edge. Nothing is
            // lost that is not already carried twice — the legend below the
            // donut names every band, and the `sr-only` table carries the
            // figures. Those are also the relief this palette's sub-3:1 fills
            // are conditional on, and both stay.
            show:
              !narrow &&
              stack.total > 0 &&
              band.total / stack.total >= LABEL_THRESHOLD,
          },
        })),
      },
    ],
  };
}

export function CategoryPie({ stack }: { stack: CategoryStack }) {
  const tokens = useChartTokens();
  const narrow = useIsNarrow();
  const option = useMemo(
    () => (tokens ? buildOption(stack, tokens, narrow) : null),
    [stack, tokens, narrow],
  );

  if (stack.bands.length === 0) return null;

  const span =
    stack.months.length > 0
      ? `${stack.months[0]} to ${stack.months[stack.months.length - 1]}`
      : "";

  return (
    <Section
      id="pie"
      heading="The whole year"
      meta={`Every category, unfiltered · ${span}`}
      panelClassName="p-4 sm:p-5"
    >
      <div className="relative">
        <EChart
          option={option}
          height={HEIGHT}
          label={`Share of total spending by category over ${span}. The table below the chart carries the same figures.`}
        />

        {/* The donut's middle, as real HTML rather than an ECharts graphic: it
            is in the server-rendered markup, wears the type tokens, and stays
            selectable. `45%` matches the series' own centre. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-[45%] -translate-y-1/2 text-center"
          aria-hidden
        >
          <p className="text-[11.5px] font-medium tracking-wide text-text-subtle uppercase">
            Total out
          </p>
          <p className="font-mono text-[13px] font-medium tabular-nums text-text sm:text-[15px]">
            {formatMoney(stack.total)}
          </p>
        </div>
      </div>

      {/* No <caption>: the caption box lives outside the table's clipped box,
          so it escapes sr-only's 1px clip and floats visibly on the page. */}
      <table
        className="sr-only"
        aria-label="Share of spending by category, whole range"
      >
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Total</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {stack.bands.map((band) => (
            <tr key={band.key}>
              <th scope="row">{band.key}</th>
              <td>{formatMoney(band.total)}</td>
              <td>
                {stack.total > 0
                  ? ((band.total / stack.total) * 100).toFixed(1)
                  : "0.0"}
                %
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
