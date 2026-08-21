"use client";

import { useId, useState } from "react";

import type { ChartSpec } from "@/lib/assistant";
import { formatMoney } from "@/lib/insights";

/**
 * A hand-rolled donut for the chat sidebar — the same reasoning as the
 * dashboard's inline-SVG trend chart: a charting library would ship hundreds
 * of KB to draw a handful of wedges.
 *
 * Slice colours are a fixed subset of the chart ramp chosen so that adjacent
 * wedges stay distinguishable under deuteranopia (the full ramp's pistachio
 * next to amber is a ΔE-2.7 pair); "Other" is always the grey. The 2px
 * surface-coloured stroke keeps low-contrast fills perceptible, and the
 * legend doubles as the data table, so no value is carried by colour alone.
 */
const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-7)",
  "var(--chart-5)",
];
const OTHER_COLOR = "var(--chart-8)";

const CX = 100;
const CY = 100;
const R = 90;

function wedgePath(startAngle: number, endAngle: number): string {
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const x1 = CX + R * Math.cos(startAngle);
  const y1 = CY + R * Math.sin(startAngle);
  const x2 = CX + R * Math.cos(endAngle);
  const y2 = CY + R * Math.sin(endAngle);
  return `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
}

export function ChatPie({ chart }: { chart: ChartSpec }) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);

  const colorOf = (label: string, index: number) =>
    label === "Other" ? OTHER_COLOR : PIE_COLORS[index % PIE_COLORS.length];

  const wedges = [];
  let angle = -Math.PI / 2;
  for (const [index, slice] of chart.slices.entries()) {
    const end = angle + (slice.share / 100) * 2 * Math.PI;
    wedges.push({ slice, index, start: angle, end });
    angle = end;
  }

  return (
    <figure aria-labelledby={titleId}>
      <figcaption
        id={titleId}
        className="text-[13px] font-semibold text-text"
      >
        {chart.title}
      </figcaption>

      <div className="mt-2 flex items-center gap-3">
        <svg
          viewBox="0 0 200 200"
          className="h-28 w-28 shrink-0"
          role="img"
          aria-label={`Pie chart: ${chart.title}. Figures are listed next to the chart.`}
          onMouseLeave={() => setActive(null)}
        >
          {wedges.length === 1 ? (
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill={colorOf(wedges[0].slice.label, 0)}
              stroke="var(--surface)"
              strokeWidth="2"
            />
          ) : (
            wedges.map(({ slice, index, start, end }) => (
              <path
                key={slice.label}
                d={wedgePath(start, end)}
                fill={colorOf(slice.label, index)}
                stroke="var(--surface)"
                strokeWidth="2"
                strokeLinejoin="round"
                opacity={active === null || active === index ? 1 : 0.45}
                className="transition-opacity duration-150"
                onMouseEnter={() => setActive(index)}
              >
                <title>
                  {`${slice.label}: ${formatMoney(slice.amountMinor)} (${slice.share.toFixed(1)}%)`}
                </title>
              </path>
            ))
          )}
          {/* The hole that makes it a donut, and the headline it frames. */}
          <circle cx={CX} cy={CY} r={56} fill="var(--surface)" />
          <text
            x={CX}
            y={CY - 4}
            textAnchor="middle"
            className="font-mono tabular-nums"
            fontSize="15"
            fill="var(--text)"
          >
            {formatMoney(chart.totalMinor)}
          </text>
          <text
            x={CX}
            y={CY + 14}
            textAnchor="middle"
            fontSize="11"
            fill="var(--text-muted)"
          >
            total
          </text>
        </svg>

        {/* The legend is also the data table — every figure lives here as
            real text, so nothing depends on distinguishing the fills. */}
        <ul className="min-w-0 flex-1 space-y-1">
          {chart.slices.map((slice, index) => (
            <li
              key={slice.label}
              className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-[11.5px] transition-colors duration-150 ${
                active === index ? "bg-surface-muted/60" : ""
              }`}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: colorOf(slice.label, index) }}
              />
              <span className="truncate text-text" title={slice.label}>
                {slice.label}
              </span>
              <span className="ml-auto shrink-0 font-mono tabular-nums text-text-muted">
                {slice.share.toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
