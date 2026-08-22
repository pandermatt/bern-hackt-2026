"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { useChartTokens } from "@/components/echart";
import type { EChartsChartSpec } from "@/lib/assistant";

/**
 * Renders a model-composed ECharts option — any chart type the library
 * knows. That is why this does NOT go through the shared `EChart` wrapper:
 * the wrapper registers only the two chart types the dashboard uses, while
 * this lazy-loads the full ECharts build, and only in the moment a message
 * actually carries such a chart. The dashboard bundle never pays for it.
 *
 * The option arrives pre-sanitized (`sanitizeEChartsOption`): pure JSON, so
 * it cannot carry functions; size- and depth-capped; graphic/image/tooltip
 * stripped. Rendering still sits in a try/catch — an option can be safe and
 * nonsense at the same time.
 */
const HEIGHT = 240;

export function ChatEChart({ chart }: { chart: EChartsChartSpec }) {
  const t = useTranslations("Chat");
  const host = useRef<HTMLDivElement>(null);
  const tokens = useChartTokens();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element || !tokens) return;

    let disposed = false;
    let instance: import("echarts").ECharts | undefined;
    let observer: ResizeObserver | undefined;

    (async () => {
      const echarts = await import("echarts");
      if (disposed || !host.current) return;
      try {
        instance = echarts.init(host.current, undefined, {
          renderer: "canvas",
        });
        instance.setOption(
          {
            backgroundColor: "transparent",
            // Palette and type defaults the option can override — except the
            // ones the sanitizer already stripped, which stay gone.
            color: tokens.series,
            textStyle: { color: tokens.textMuted, fontSize: 11 },
            ...chart.option,
          },
          { notMerge: true },
        );
        observer = new ResizeObserver(() => instance?.resize());
        observer.observe(host.current);
      } catch {
        setFailed(true);
      }
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      instance?.dispose();
    };
  }, [chart, tokens]);

  if (failed) {
    return (
      <p className="text-[12px] text-text-muted">
        {t("chartFailed")}
      </p>
    );
  }

  return (
    <figure>
      {chart.title && (
        <figcaption className="text-[13px] font-semibold text-text">
          {chart.title}
        </figcaption>
      )}
      <div
        ref={host}
        className="mt-1"
        style={{ height: HEIGHT }}
        role="img"
        aria-label={chart.title ?? t("chartFallback")}
      />
    </figure>
  );
}
