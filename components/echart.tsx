"use client";

import { LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";

import { useHydrated } from "@/lib/use-hydrated";

/**
 * The one ECharts boundary in the app.
 *
 * Charting here used to be inline SVG in a server component, and for paired
 * bars that was the right call. Two gradient areas with a crosshair and a
 * donut with leader lines are not, so this is the trade the app now makes: ~330 KB of chart runtime and a hydration boundary,
 * against a chart that can actually be interrogated. What it costs is that the
 * figures cross into the client bundle — so what crosses is the *aggregate*
 * (nine numbers a month), never the ledger.
 *
 * Only the canvas needs JavaScript. Every caller renders the same figures as a
 * real `<table>` beside it, which is in the server HTML at first paint and is
 * what anyone with JS off, a screen reader, or a failed chunk actually gets.
 */

// Registered once per module, not per mount. Only the pieces the two charts
// use — the barrel import is the whole library and roughly triples this.
echarts.use([
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

/**
 * Canvas cannot resolve `var(--chart-1)`, so the tokens have to be read out of
 * the cascade as concrete hexes. Reading them (rather than duplicating the
 * palette in TypeScript) is what keeps "restyle by editing tokens" true for
 * the charts too.
 */
export type ChartTokens = {
  text: string;
  textMuted: string;
  textSubtle: string;
  surface: string;
  line: string;
  series: string[];
  /** The neutral fold-in bucket, slot 0. */
  other: string;
  /** The palette's dark neutral — axis text, connectors, outlines. */
  ink: string;
  /** Money in / money out. Direction, not identity — never a series slot. */
  flowIn: string;
  flowOut: string;
};

const SERIES_TOKENS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `--chart-${n}`);

function readTokens(): ChartTokens {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    text: read("--text"),
    textMuted: read("--text-muted"),
    textSubtle: read("--text-subtle"),
    surface: read("--surface"),
    line: read("--line"),
    series: SERIES_TOKENS.map(read),
    other: read("--chart-other"),
    ink: read("--chart-ink"),
    flowIn: read("--flow-in"),
    flowOut: read("--flow-out"),
  };
}

/**
 * The palette for the current theme, or `null` until mounted.
 *
 * `null` on the server and on the first client render alike: the tokens are
 * only knowable once there is a document, and returning a guess would mean
 * painting the light palette for a moment on a dark page.
 */
export function useChartTokens(): ChartTokens | null {
  const { resolvedTheme } = useTheme();
  const hydrated = useHydrated();

  // Read during render rather than from an effect, so the chart's first painted
  // frame is already in the right palette instead of flipping into it. Safe
  // because it is a read, and because `next-themes` has already written the
  // class onto <html> by the time the re-render carrying the new
  // `resolvedTheme` runs — the class and the state are set together.
  return useMemo(
    () => (hydrated ? readTokens() : null),
    // `resolvedTheme` is not read inside, but it is exactly what invalidates
    // the tokens: the whole point is to re-read the cascade when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, resolvedTheme],
  );
}

/** `slot` is 1-based to match `--chart-N`; 0 is the neutral fold-in bucket. */
export function slotColor(tokens: ChartTokens, slot: number): string {
  return slot === 0 ? tokens.other : (tokens.series[slot - 1] ?? tokens.other);
}

/** "#06adb7" + 0.5 → "rgba(6, 173, 183, 0.5)". Gradients need an alpha stop. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value.split("").map((c) => c + c).join("")
      : value.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function EChart({
  option,
  className = "",
  height,
  /** Announced in place of the canvas, which is opaque to assistive tech. */
  label,
}: {
  option: EChartsOption | null;
  className?: string;
  height: number;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const instance = echarts.init(element, undefined, { renderer: "canvas" });
    chart.current = instance;

    // ECharts sizes off the container's client box and does not watch it, so
    // a sidebar collapse or an orientation change would otherwise leave the
    // canvas at its old width.
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);

    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chart.current || !option) return;
    // `notMerge` because a filter can change the series count, and a merge
    // would leave the departed series painted on the canvas.
    chart.current.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={host}
      className={className}
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}

/** Shared tooltip chrome, so the two charts do not drift apart. */
export function tooltipStyle(tokens: ChartTokens) {
  return {
    backgroundColor: tokens.surface,
    borderColor: tokens.line,
    borderWidth: 1,
    padding: [8, 10] as [number, number],
    textStyle: { color: tokens.text, fontSize: 12 },
    extraCssText: "box-shadow: 0 4px 12px -2px rgba(0,0,0,0.18); border-radius: 8px;",
  };
}

export type { EChartsOption };
