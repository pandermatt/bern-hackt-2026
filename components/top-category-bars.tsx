"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  EChart,
  slotColor,
  useChartTokens,
  withAlpha,
  type ChartTokens,
  type EChartsOption,
} from "@/components/echart";
import { Section } from "@/components/section";
import { categoryIcon } from "@/lib/category-icons";
import {
  formatMoney,
  slotsOf,
  FOLDED_MERCHANTS,
  MERCHANT_SEGMENTS,
  OTHER_CATEGORY,
  type CategoryPeriod,
  type CategoryPeriods,
  type CategorySpend,
  type CategoryStack,
} from "@/lib/insights";
import { useIsNarrow } from "@/lib/use-hydrated";

/**
 * The top expense categories — running month or year-to-date, up to eight at
 * a time, as bars or as a donut — with several layers folded in:
 *
 * - **Hovering a bar splits it into its merchants.** The bar is secretly a
 *   stack the whole time — every segment painted the category's own colour, so
 *   it reads as one solid bar — and the hover repaints the hovered bar's
 *   segments as lightness steps of that colour and opens 2px seams between
 *   them. Merged option updates are what make that an in-place animation.
 * - **A dotted ink line across each bar marks the category's twelve-month
 *   median** — the median month itself in the month view, the median month
 *   times the months elapsed in the YTD view.
 * - **The bar ↔ donut switch is a morph, not a swap.** Every bar series and
 *   the donut series share `universalTransition.seriesKey`, and every data
 *   item carries its category as `groupId`, so on switch each category's
 *   segments visibly combine into its wedge (and divide back). The update
 *   goes through `replaceMerge: ["series"]` — removal is what triggers the
 *   transition, and it is also why every series carries a stable `id`.
 * - **The tail is collected, not dropped.** Seven categories get their own
 *   bar; everything ranked beyond them — and the literal "Other" category,
 *   which never competes for a bar of its own, same as in the stacked chart —
 *   folds into one neutral "Other" bucket at the end. Its hover split
 *   combines the folded categories' merchants; it carries **no median dash**,
 *   because a median across a changing mix of categories would claim
 *   precision the number does not have.
 * - **A chip per category hides it from the chart**, promoting the
 *   next-ranked category out of the bucket into view; hidden chips stay,
 *   struck through. The chip row doubles as the donut's legend, which is why
 *   the donut has none.
 * - **Localized through the app's next-intl setup** — its own `TopCategories`
 *   namespace, month names from `Months`, category display names from
 *   `Categories` (the same `has()` fallback the ledger uses). Data keys stay
 *   raw: `groupId`, chart `name`s and the icon lookup all run on the
 *   canonical category key, and only rendered text is translated.
 *
 * The axis names each bar with its category *icon*; the chips and tooltips
 * carry the words, and the `sr-only` tables carry the figures, so the icon is
 * never the only naming. Colours come from `slotsOf(stack)` — the same
 * whole-range map the year donut paints from — so a category wears one colour
 * everywhere, whichever period, view, or language is showing.
 */

/** How many categories get a bar of their own; the eighth-and-beyond fold
 * into the "Other" bucket, so the chart draws at most eight marks. */
const SHOWN_CATEGORIES = 7;

/** Reserved (with the control row) in `app/[locale]/(dashboard)/loading.tsx`
 * — a canvas cannot reserve its own space. */
const HEIGHT = 300;
/** Extra headroom at the top for the per-bar totals; no legend strip at the
 * bottom — each bar names itself on the axis. */
const GRID = { left: 58, right: 14, top: 30, bottom: 32 };
const GRID_NARROW = { left: 40, right: 10, top: 28, bottom: 30 };

/** What the bar and donut series hand each other on a view switch. */
const MORPH_KEY = "top-categories";
/** Module-scope so the update effect does not re-run every render. */
const REPLACE_SERIES = ["series"];

/** Rounds a rappen amount up to a tidy gridline so the axis reads cleanly. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

/**
 * The hovered bar's merchant steps: the biggest merchant keeps the full
 * category colour at the baseline, and each smaller one above it fades towards
 * the panel ground. The floor is 0.3 — the faintest step still has to read as
 * a filled shape, and the seams (not the fills) are what separate neighbours.
 */
function shade(colour: string, index: number, count: number): string {
  if (count <= 1) return colour;
  return withAlpha(colour, 1 - (index * 0.7) / (count - 1));
}

/** The dash's value: the median month, scaled to the period's length. */
function dashValue(category: CategorySpend, monthCount: number): number | null {
  return category.median === null ? null : category.median * monthCount;
}

/**
 * The symbol every dash wears, so the marker names itself instead of leaning
 * on the footnote alone. Ø — the sign German-speaking UIs use for a typical
 * value ("Durchschnitt") — rather than the statistician's x̃, which reads as
 * jargon outside a stats course. Passed into the localized footnote as a
 * parameter, so the glyph cannot drift between the chart and its caption.
 */
const MEDIAN_SYMBOL = "Ø";

/** Below this share a wedge is thinner than its own label, so labels are
 * placed selectively — same rule the year donut uses. */
const WEDGE_LABEL_THRESHOLD = 0.04;

/**
 * The "Other" bucket: every category that did not earn a bar, folded into one
 * `CategorySpend` so the rest of the chart needs no special case. Its
 * merchant split sums the folded categories' splits (their own
 * `FOLDED_MERCHANTS` tails merge into this bucket's tail), re-ranks, and
 * re-folds to the segment cap — amounts stay exact, only attribution beyond
 * the cap collapses. `median: null` on purpose: the bucket's mix changes with
 * every hidden chip, and a median over a moving mix would claim precision the
 * number does not have.
 */
function foldTail(tail: CategorySpend[]): CategorySpend {
  const merchants = new Map<string, number>();
  let total = 0;
  for (const category of tail) {
    total += category.total;
    for (const merchant of category.merchants) {
      merchants.set(
        merchant.merchant,
        (merchants.get(merchant.merchant) ?? 0) + merchant.amount,
      );
    }
  }

  const foldedIn = merchants.get(FOLDED_MERCHANTS) ?? 0;
  merchants.delete(FOLDED_MERCHANTS);
  const ranked = [...merchants.entries()]
    .map(([merchant, amount]) => ({ merchant, amount }))
    .sort((a, b) => b.amount - a.amount);

  // The fold slot stays at the end, whatever it sums to — a tail that ranked
  // mid-stack would read as a merchant called "Other merchants".
  const needsFold = foldedIn > 0 || ranked.length > MERCHANT_SEGMENTS;
  const keep = needsFold ? MERCHANT_SEGMENTS - 1 : MERCHANT_SEGMENTS;
  const rest =
    foldedIn +
    ranked.slice(keep).reduce((sum, merchant) => sum + merchant.amount, 0);

  return {
    key: OTHER_CATEGORY,
    total,
    median: null,
    merchants:
      rest > 0
        ? [...ranked.slice(0, keep), { merchant: FOLDED_MERCHANTS, amount: rest }]
        : ranked.slice(0, keep),
  };
}

type View = "bars" | "donut";
type PeriodKey = "month" | "ytd";

/**
 * The translated strings `buildOption` needs, prepared in the component —
 * `useTranslations` is a hook, and the option builder is not a component.
 * Same shape of hand-off the trend chart uses for its month labels.
 */
type ChartText = {
  categoryName: (key: string) => string;
  merchantName: (name: string) => string;
  medianTip: (category: string, amount: string, n: number) => string;
  merchantTip: (amount: string, share: number, category: string) => string;
  wedgeTip: (amount: string, share: number) => string;
};

function buildOption(
  period: CategoryPeriod,
  visible: CategorySpend[],
  slots: Map<string, number>,
  tokens: ChartTokens,
  narrow: boolean,
  hovered: number | null,
  view: View,
  text: ChartText,
): EChartsOption {
  const { monthCount } = period;

  const tooltip = {
    trigger: "item" as const,
    confine: true,
    backgroundColor: tokens.surface,
    borderColor: tokens.line,
    textStyle: { color: tokens.text, fontSize: 12 },
    formatter: (params: unknown) => {
      const point = params as {
        seriesName: string;
        seriesIndex: number;
        dataIndex: number;
      };
      const category = visible[point.dataIndex];
      if (!category) return "";
      const name = text.categoryName(category.key);
      const title = `${categoryIcon(category.key)} ${name}`;

      if (view === "donut") {
        const total = visible.reduce((sum, entry) => sum + entry.total, 0);
        const share = total > 0 ? Math.round((category.total / total) * 100) : 0;
        return `${title}<br/>${text.wedgeTip(formatMoney(category.total), share)}`;
      }
      if (point.seriesName === "median") {
        const dash = dashValue(category, monthCount) ?? 0;
        return text.medianTip(title, formatMoney(dash), monthCount);
      }
      const merchant = category.merchants[point.seriesIndex];
      if (!merchant) return "";
      const share =
        category.total > 0
          ? Math.round((merchant.amount / category.total) * 100)
          : 0;
      return `${text.merchantName(merchant.merchant)}<br/>${text.merchantTip(
        formatMoney(merchant.amount),
        share,
        name,
      )}`;
    },
  };

  if (view === "donut") {
    const total = visible.reduce((sum, entry) => sum + entry.total, 0);
    return {
      animationDuration: 600,
      tooltip,
      // The axes stay configured under a series-only replaceMerge, so the
      // donut has to switch them off explicitly — and the bar view switches
      // them back on.
      xAxis: { show: false },
      yAxis: { show: false },
      series: [
        {
          id: "donut",
          name: "donut",
          type: "pie",
          // The morph runs at its own pace: the chart-level 250ms is tuned
          // for the hover repaint and reads as a blink for a shape change.
          animationDurationUpdate: 600,
          universalTransition: { enabled: true, seriesKey: MORPH_KEY },
          radius: ["55%", "76%"] as [string, string],
          center: ["50%", "50%"] as [string, string],
          padAngle: 2,
          itemStyle: {
            borderRadius: 5,
            borderColor: tokens.surfaceMuted,
            borderWidth: 1,
          },
          // Icon and share only — language-neutral by construction. The chip
          // row above carries the localized names.
          label: {
            color: tokens.ink,
            fontSize: 11.5,
            formatter: (params) => {
              const point = params as { name: string; percent?: number };
              return `${categoryIcon(point.name)} ${(point.percent ?? 0).toFixed(0)}%`;
            },
          },
          labelLine: {
            length: 10,
            length2: 12,
            lineStyle: { color: withAlpha(tokens.ink, 0.4) },
          },
          labelLayout: { hideOverlap: true },
          emphasis: { scaleSize: 6 },
          data: visible.map((category) => ({
            // The raw key, not the translated name: `groupId` ties the wedge
            // to its bar segments across the morph, and the icon lookup and
            // slot map key on it too.
            name: category.key,
            value: category.total,
            groupId: category.key,
            itemStyle: { color: slotColor(tokens, slots.get(category.key) ?? 0) },
            label: {
              show:
                !narrow &&
                total > 0 &&
                category.total / total >= WEDGE_LABEL_THRESHOLD,
            },
          })),
        },
      ],
    };
  }

  // Eight-vs-five density: past six bars they slim down, and on a phone the
  // per-bar ink (totals, the median symbol) comes off entirely — labels in
  // ~26px bands can only collide. Tooltips and the tables still carry every
  // figure, and hiding categories brings the labels back.
  const dense = visible.length > 6;
  const showMarks = !narrow || !dense;
  const barWidth = narrow ? (dense ? 14 : 24) : dense ? 40 : 48;
  const grid = narrow ? GRID_NARROW : GRID;
  const peak = niceCeiling(
    Math.max(
      1,
      ...visible.flatMap((c) => [c.total, dashValue(c, monthCount) ?? 0]),
    ),
  );
  // The y scale in pixels, for the one collision the layout can produce: a
  // dash above the bar top sits exactly where the total label goes, so the
  // label climbs above the dash instead of being struck through by it.
  const plotHeight = HEIGHT - grid.top - grid.bottom;
  const labelDistance = (category: CategorySpend) => {
    const dash = dashValue(category, monthCount);
    const above =
      dash !== null && dash > category.total
        ? ((dash - category.total) / peak) * plotHeight
        : 0;
    return above > 0 ? Math.ceil(above) + 10 : 6;
  };

  // One bar series per merchant *position*, stacked: series `seg` carries each
  // category's seg-th biggest merchant (or a gap once that category runs out).
  // Biggest at the baseline, so the split reads largest-first bottom-up.
  // Always exactly MERCHANT_SEGMENTS series, padded with gaps: hover updates
  // merge, and a series that vanished between two options would stay painted.
  const bars = Array.from({ length: MERCHANT_SEGMENTS }, (_, seg) => ({
    id: `merchant-${seg}`,
    name: `merchant-${seg}`,
    type: "bar" as const,
    stack: "period",
    barWidth,
    universalTransition: { enabled: true, seriesKey: MORPH_KEY },
    data: visible.map((category, index) => {
      const merchant = category.merchants[seg];
      if (!merchant) return { value: null };
      const colour = slotColor(tokens, slots.get(category.key) ?? 0);
      const split = hovered === index;
      const top = seg === category.merchants.length - 1;
      return {
        value: merchant.amount,
        // What ties this segment to its category's wedge across the morph.
        groupId: category.key,
        itemStyle: {
          color: split ? shade(colour, seg, category.merchants.length) : colour,
          // The seams that appear on hover: the panel's own grey, grown from
          // nothing, so the solid bar visibly comes apart into segments.
          borderColor: tokens.surfaceMuted,
          borderWidth: split ? 2 : 0,
          borderRadius: split ? 3 : top ? [4, 4, 0, 0] : 0,
        },
        // The period's total rides the top segment, so it sits over the bar
        // in both states. Francs; the footnote says CHF once.
        label: top
          ? {
              show: showMarks,
              position: "top" as const,
              distance: labelDistance(category),
              color: tokens.ink,
              fontSize: 11,
              formatter: () =>
                Math.round(category.total / 100).toLocaleString("de-CH"),
            }
          : undefined,
      };
    }),
  }));

  // The median as a dotted line slightly wider than the bar, so it stays
  // visible where it crosses the fill and cannot be mistaken for a segment
  // seam. Ink, the palette's marker role. The dotting is drawn into the
  // symbol's own path — a canvas symbol has no border style to dot — and
  // `symbolSize` stretches the six-dash pattern to the bar. No morph partner:
  // on a view switch it simply leaves.
  const medians = {
    id: "median",
    name: "median",
    type: "scatter" as const,
    symbol:
      "path://M0,0h4v2h-4zM8,0h4v2h-4zM16,0h4v2h-4zM24,0h4v2h-4zM32,0h4v2h-4zM40,0h4v2h-4z",
    symbolSize: [barWidth + (narrow && dense ? 6 : 12), 2] as [number, number],
    itemStyle: { color: tokens.ink },
    // The dash's name-tag, riding its right end — dropped with the other
    // per-bar ink when the bars share a phone's width (see `showMarks`).
    label: {
      show: showMarks,
      position: "right" as const,
      distance: narrow ? 2 : 4,
      color: tokens.ink,
      fontSize: narrow ? 9 : 10,
      fontStyle: "italic" as const,
      formatter: () => MEDIAN_SYMBOL,
    },
    emphasis: { scale: false },
    z: 10,
    data: visible.map((category) => dashValue(category, monthCount)),
  };

  return {
    animationDuration: 600,
    // The hover repaint. Long enough to read as the bar coming apart, short
    // enough that sweeping across the bars never feels laggy. (The morph into
    // the donut overrides this per-series — see the pie's own duration.)
    animationDurationUpdate: 250,
    grid,
    tooltip,
    xAxis: {
      show: true,
      type: "category",
      // The icon, not the name: eight multi-word labels collide long before
      // eight emoji do — in any language. The chips above and the tooltips
      // carry the words.
      data: visible.map((category) => categoryIcon(category.key)),
      axisLine: { lineStyle: { color: withAlpha(tokens.ink, 0.35) } },
      axisTick: { show: false },
      axisLabel: { fontSize: narrow ? 14 : 16, interval: 0 },
    },
    yAxis: {
      show: true,
      type: "value",
      max: peak,
      axisLabel: {
        color: withAlpha(tokens.ink, 0.75),
        fontSize: 10,
        // Same treatment as the trend chart: francs, abbreviated to `2.5k` on
        // a phone where the narrow gutter cannot fit `2’500`.
        formatter: (value: number) => {
          const francs = Math.round(value / 100);
          if (!narrow || Math.abs(francs) < 1000) {
            return francs.toLocaleString("de-CH");
          }
          const thousands = francs / 1000;
          return `${Number(thousands.toFixed(1))}k`;
        },
      },
      splitLine: { lineStyle: { color: withAlpha(tokens.ink, 0.18) } },
    },
    series: [...bars, medians],
  };
}

export function TopCategoryBars({
  data,
  stack,
}: {
  data: CategoryPeriods | null;
  stack: CategoryStack;
}) {
  const t = useTranslations("TopCategories");
  const tMonths = useTranslations("Months");
  const tCategories = useTranslations("Categories");
  const tokens = useChartTokens();
  const narrow = useIsNarrow();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  // A phone always shows the donut — its view toggle is hidden, and a
  // hidden control must not have a live choice behind it, or rotating a
  // desktop window with "Bars" picked would strand a phone in a view it
  // cannot leave. On desktop the choice sticks once made, defaulting to
  // bars. `narrow` is false during SSR, but the canvas only paints once
  // `useChartTokens` resolves after hydration, so a phone's first painted
  // frame is already the donut rather than a flash of bars.
  const [chosenView, setChosenView] = useState<View | null>(null);
  const view = narrow ? "donut" : (chosenView ?? "bars");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Moving between two segments of the same bar fires mouseout-then-mouseover;
  // clearing on a short delay (cancelled by the next mouseover) keeps the bar
  // split across that seam instead of snapping shut and re-opening.
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

  const period = data?.[periodKey] ?? null;
  // Seven named bars, then the bucket: the literal "Other" category never
  // competes for a bar, hidden categories are out of the picture entirely
  // (hiding means "excluded", not "moved to Other"), and hiding the bucket's
  // own chip removes the bucket without promoting anyone — its members are
  // below the cut by definition.
  const { visible, bucket } = useMemo(() => {
    if (!period) return { visible: [] as CategorySpend[], bucket: null };
    const named = period.categories.filter(
      (category) =>
        category.key !== OTHER_CATEGORY && !hidden.has(category.key),
    );
    const shown = named.slice(0, SHOWN_CATEGORIES);
    const tail = [
      ...named.slice(SHOWN_CATEGORIES),
      ...period.categories.filter(
        (category) => category.key === OTHER_CATEGORY,
      ),
    ];
    const folded = tail.length > 0 ? foldTail(tail) : null;
    return {
      visible:
        folded && !hidden.has(OTHER_CATEGORY) ? [...shown, folded] : shown,
      bucket: folded,
    };
  }, [period, hidden]);

  const text = useMemo<ChartText>(
    () => ({
      // The ledger's fallback idiom: an unknown category renders its raw key
      // rather than a missing-message error.
      categoryName: (key) => (tCategories.has(key) ? tCategories(key) : key),
      merchantName: (name) =>
        name === FOLDED_MERCHANTS ? t("otherMerchants") : name,
      medianTip: (category, amount, n) =>
        n === 1
          ? t("medianMonthTip", { category, amount })
          : t("medianPaceTip", { category, amount, n }),
      merchantTip: (amount, share, category) =>
        t("merchantShareTip", { amount, share, category }),
      wedgeTip: (amount, share) => t("wedgeShareTip", { amount, share }),
    }),
    [t, tCategories],
  );

  const slots = useMemo(() => slotsOf(stack), [stack]);
  const option = useMemo(
    () =>
      tokens && period && visible.length > 0
        ? buildOption(period, visible, slots, tokens, narrow, hovered, view, text)
        : null,
    [period, visible, slots, tokens, narrow, hovered, view, text],
  );

  if (!data || !period || data.month.categories.length === 0) return null;

  const year = period.month.slice(0, 4);
  const monthIndex = Number(period.month.slice(5, 7));
  const span =
    periodKey === "month"
      ? `${tMonths(`long${monthIndex}`)} ${year}`
      : `${tMonths("short1")}–${tMonths(`short${period.monthCount}`)} ${year}`;

  // The chips: the named bars plus anything hidden, in rank order, and the
  // bucket's own chip at the end — a hidden category's chip must stay, or
  // there would be no way back. Bucket members get no chip of their own;
  // their way into view is hiding something above them.
  const visibleKeys = new Set(visible.map((category) => category.key));
  const chips = [
    ...period.categories.filter(
      (category) =>
        category.key !== OTHER_CATEGORY &&
        (visibleKeys.has(category.key) || hidden.has(category.key)),
    ),
    ...(bucket ? [bucket] : []),
  ];

  const toggleHidden = (key: string) => {
    setHovered(null);
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const dashMeaning =
    periodKey === "month"
      ? t("dashMonth")
      : t("dashYtd", { n: period.monthCount });
  const visibleTotal = visible.reduce((sum, entry) => sum + entry.total, 0);

  const pill = (active: boolean) =>
    `h-8 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-text"
    }`;

  return (
    <Section
      id="top-categories"
      heading={t("heading")}
      meta={`${span} · ${t(view === "bars" ? "hintBars" : "hintDonut")}`}
      panelClassName="p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
        {/* The period badge and the view badge: one control each, two states
            each, so the heading never has to change. */}
        <div className="flex shrink-0 gap-2">
          <div
            role="group"
            aria-label={t("periodAria")}
            className="flex rounded-full border border-line-strong bg-surface p-0.5"
          >
            {(["month", "ytd"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={periodKey === key}
                onClick={() => {
                  setHovered(null);
                  setPeriodKey(key);
                }}
                className={pill(periodKey === key)}
              >
                {t(key === "month" ? "periodMonth" : "periodYtd")}
              </button>
            ))}
          </div>
          {/* Hidden on a phone, where the donut is the only view — CSS and
              the `view` derivation above agree on that, deliberately. */}
          <div
            role="group"
            aria-label={t("viewAria")}
            className="hidden rounded-full border border-line-strong bg-surface p-0.5 sm:flex"
          >
            {(["bars", "donut"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => {
                  setHovered(null);
                  setChosenView(key);
                }}
                className={pill(view === key)}
              >
                {t(key === "bars" ? "viewBars" : "viewDonut")}
              </button>
            ))}
          </div>
        </div>

        {/* One chip per category on show (plus the hidden ones): the icon the
            axis uses, the localized name the axis dropped, and the hide
            toggle. In the donut view this row is also the legend. */}
        <div className="flex flex-wrap gap-1.5">
          {chips.map((category) => {
            const isHidden = hidden.has(category.key);
            const name = text.categoryName(category.key);
            return (
              <button
                key={category.key}
                type="button"
                aria-pressed={!isHidden}
                aria-label={t(isHidden ? "showChip" : "hideChip", {
                  category: name,
                })}
                onClick={() => toggleHidden(category.key)}
                className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors ${
                  isHidden
                    ? "border-line bg-transparent text-text-subtle line-through opacity-70 hover:opacity-100"
                    : "border-line-strong bg-surface text-text hover:border-accent"
                }`}
              >
                <span aria-hidden>{categoryIcon(category.key)}</span>
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="relative">
          <EChart
            option={option}
            height={HEIGHT}
            notMerge={false}
            replaceMerge={REPLACE_SERIES}
            onEvents={events}
            label={t(view === "bars" ? "chartLabelBars" : "chartLabelDonut", {
              count: visible.length,
              span,
            })}
          />
          {/* The donut's middle, as real HTML rather than an ECharts graphic —
              same trade the year donut makes: server-marked-up, token-styled,
              selectable. Hidden from assistive tech; the tables carry it. */}
          {view === "donut" && (
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center"
              aria-hidden
            >
              <p className="text-[11.5px] font-medium tracking-wide text-text-subtle uppercase">
                {t("totalShown")}
              </p>
              <p className="font-mono text-[13px] font-medium tabular-nums text-text sm:text-[15px]">
                {formatMoney(visibleTotal)}
              </p>
            </div>
          )}
        </div>
      ) : (
        /* Everything hidden is a state the chips can produce, so it needs a
           way to read as deliberate — and the box keeps the panel's height so
           unhiding does not jolt the page. */
        <div
          className="flex items-center justify-center text-[13px] text-text-muted"
          style={{ height: HEIGHT }}
        >
          {t("emptyHidden")}
        </div>
      )}

      {/* The same numbers, for screen readers, for JS-off, and for anyone the
          canvas fails — and the relief the palette's sub-3:1 fills require.
          Two tables because the two facts have different shapes: per-category
          totals against their medians, then the merchant split within each.
          Identical in both views: the figures do not change with the shape. */}
      {/* No <caption>: the caption box lives outside the table's clipped box,
          so it escapes sr-only's 1px clip and floats visibly on the page. */}
      <table className="sr-only" aria-label={t("tableCategories", { span })}>
        <thead>
          <tr>
            <th scope="col">{t("category")}</th>
            <th scope="col">{t(periodKey === "month" ? "periodMonth" : "periodYtd")}</th>
            <th scope="col">
              {periodKey === "month"
                ? t("medianMonthCol")
                : t("medianPaceCol", { n: period.monthCount })}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((category) => {
            const dash = dashValue(category, period.monthCount);
            return (
              <tr key={category.key}>
                <th scope="row">{text.categoryName(category.key)}</th>
                <td>{formatMoney(category.total)}</td>
                <td>
                  {dash !== null
                    ? formatMoney(dash)
                    : category.key === OTHER_CATEGORY
                      ? t("noMedianOther")
                      : t("noEarlierMonths")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table className="sr-only" aria-label={t("tableMerchants", { span })}>
        <thead>
          <tr>
            <th scope="col">{t("category")}</th>
            <th scope="col">{t("merchant")}</th>
            <th scope="col">{t("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {visible.flatMap((category) =>
            category.merchants.map((merchant) => (
              <tr key={`${category.key}-${merchant.merchant}`}>
                <th scope="row">{text.categoryName(category.key)}</th>
                <td>{text.merchantName(merchant.merchant)}</td>
                <td>{formatMoney(merchant.amount)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>

      <p className="mt-3 font-mono text-[11.5px] text-text-subtle">
        {view === "bars"
          ? t("footnote", { symbol: MEDIAN_SYMBOL, dash: dashMeaning })
          : t("footnoteDonut")}
      </p>
    </Section>
  );
}
