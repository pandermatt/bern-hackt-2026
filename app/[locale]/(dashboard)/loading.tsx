import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";

/**
 * Shown while the dashboard's data resolves. The page renders dynamically (the
 * layout reads the session), so without this the content area sits blank
 * between navigations — including on every filter change.
 *
 * It lives inside the `(dashboard)` route group, not at the app root, because
 * a root `loading.tsx` is the loading boundary for **every** route beneath it.
 * At the root, clicking "Sign in" flashed this dashboard skeleton over
 * `/login`, and the same went for `/register` and `/account`. The route group
 * scopes it to `/` without changing the URL. Don't move it back up.
 *
 * Mirrors the dashboard's shape — heading, four tiles, the two charts, the
 * merchant breakdown, filters, rows — so the real content lands in roughly the
 * same places rather than shifting. Both chart blocks reserve the height their
 * ECharts canvas will take, heading and footnote included; a canvas that sizes
 * itself from its container cannot reserve its own space.
 *
 * Sections are the ledger's idiom now: a big heading on the page ground, then a
 * grey panel. Inside a panel there is nothing to draw — a `Bar` is
 * `bg-surface-muted` on `bg-surface-muted` — so the panel's own box is the
 * skeleton, and only its height matters.
 *
 * `animate-pulse` is safe here where an entrance animation would not be: it
 * animates between visible states, so nothing is hidden if JS never runs.
 */
function Bar({
  className,
  style,
}: {
  className: string;
  style?: CSSProperties;
}) {
  return <div className={`rounded bg-surface-muted ${className}`} style={style} />;
}

/** The `Section` heading block: big title on the page ground, muted meta
 *  opposite, and the `pt-6` that spaces one section from the last. */
function SectionHeading({
  titleWidth,
  metaWidth,
}: {
  titleWidth: string;
  metaWidth?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 pt-6 pb-2.5">
      <Bar className={`h-[26px] sm:h-[30px] ${titleWidth}`} />
      {metaWidth && <Bar className={`h-[12px] ${metaWidth}`} />}
    </div>
  );
}

export default function Loading() {
  const t = useTranslations("Dashboard");
  return (
    <main
      className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{t("loading")}</span>

      <div className="animate-pulse">
        <Bar className="h-[30px] w-[240px] sm:h-[36px]" />
        <Bar className="mt-2 h-[14px] w-[240px]" />

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <div key={tile} className="rounded-lg bg-surface-muted p-3.5 sm:p-4">
              <Bar className="h-[13px] w-[64px]" />
              <Bar className="mt-2 h-[20px] w-[110px]" />
              <Bar className="mt-2.5 h-[12px] w-[88px]" />
            </div>
          ))}
        </div>

        {/* Month by month: 320px of canvas, p-5 either side, plus the footnote
            line and its margin. */}
        <SectionHeading titleWidth="w-[210px]" metaWidth="w-[180px]" />
        <div className="h-[394px] rounded-lg bg-surface-muted" />

        {/* One category chart per breakpoint, mirroring the page: the donut's
            box below `sm`, the top-categories box from `sm` up. */}
        {/* The whole year: the same, without the footnote. */}
        <div className="sm:hidden">
          <SectionHeading titleWidth="w-[170px]" metaWidth="w-[230px]" />
          <div className="h-[360px] rounded-lg bg-surface-muted" />
        </div>

        {/* Top categories: the period badge and a two-row chip strip, 300px
            of canvas, p-5 either side, plus the footnote line and its margin. */}
        <div className="hidden sm:block">
          <SectionHeading titleWidth="w-[220px]" metaWidth="w-[250px]" />
          <div className="h-[454px] rounded-lg bg-surface-muted" />
        </div>

        {/* Top merchants: eight rows over two columns, so four rows tall. */}
        <SectionHeading titleWidth="w-[190px]" />
        <div className="rounded-lg bg-surface-muted p-4 sm:p-5">
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
              <div key={row}>
                {/* Staggered widths read as a ranked list, not eight identical
                    bars. `bg-surface`, not the `Bar` helper's grey — inside the
                    panel that grey is invisible. */}
                <div
                  className="h-[13px] rounded bg-surface"
                  style={{ width: `${[70, 58, 64, 46, 52, 61, 44, 38][row]}%` }}
                />
                <div className="mt-1.5 h-[6px] w-full rounded bg-surface" />
              </div>
            ))}
          </div>
        </div>

        {/* Two dropdown pills, no card. */}
        <div className="flex flex-wrap items-end gap-3 pt-6">
          {[0, 1].map((field) => (
            <div key={field} className="min-w-[13rem] flex-1">
              <Bar className="h-[12px] w-[58px]" />
              <Bar className="mt-1.5 h-11 w-full rounded-full sm:h-10" />
            </div>
          ))}
        </div>

        {/* No card and no header bar: the ledger leads with a big month
            heading, flush left, then that month's rows as a rounded grey panel
            with white dividers. */}
        <div className="flex items-baseline justify-between gap-3 pt-6 pb-2.5">
          <Bar className="h-[26px] w-[190px] sm:h-[30px]" />
          <Bar className="h-[12px] w-[150px]" />
        </div>
        <div className="divide-y divide-surface overflow-clip rounded-lg bg-surface-muted">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3 px-4 py-4 sm:px-5">
              <Bar
                className="h-[14px]"
                style={{ width: `${[42, 31, 48, 36, 27][row]}%` }}
              />
              <Bar className="ml-auto h-[13px] w-[80px] shrink-0" />
            </div>
          ))}
        </div>
        {/* The line count at the foot. */}
        <div className="flex justify-end pt-3">
          <Bar className="h-[12px] w-[64px]" />
        </div>
      </div>
    </main>
  );
}
