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
 * Mirrors the dashboard's shape — heading, four tiles, the two charts, two
 * breakdowns, filters, rows — so the real content lands in roughly the same
 * places rather than shifting. Both chart blocks reserve the height their
 * ECharts canvas will take, heading and footnote included; a canvas that sizes
 * itself from its container cannot reserve its own space.
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

export default function Loading() {
  return (
    <main
      className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-12"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>

      <div className="animate-pulse">
        <Bar className="h-[22px] w-[190px]" />
        <Bar className="mt-2 h-[14px] w-[240px]" />

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <div key={tile} className="card p-3.5 sm:p-4">
              <Bar className="h-[13px] w-[64px]" />
              <Bar className="mt-2 h-[20px] w-[110px]" />
              <Bar className="mt-2.5 h-[12px] w-[88px]" />
            </div>
          ))}
        </div>

        {/* Month by month: 320px of canvas plus the footnote line. */}
        <div className="card mt-4 p-4 sm:p-5">
          <Bar className="h-[15px] w-[130px]" />
          <Bar className="mt-4 h-[320px] w-full" />
          <Bar className="mt-3 h-[11px] w-[300px]" />
        </div>

        {/* The whole year: 320px of donut. */}
        <div className="card mt-4 p-4 sm:p-5">
          <Bar className="h-[15px] w-[110px]" />
          <Bar className="mt-4 h-[320px] w-full" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[0, 1].map((panel) => (
            <div key={panel} className="card p-5">
              <Bar className="h-[15px] w-[120px]" />
              <div className="mt-4 space-y-3">
                {[0, 1, 2, 3, 4].map((row) => (
                  <div key={row}>
                    {/* Staggered widths read as a ranked list, not five
                        identical bars. */}
                    <Bar
                      className="h-[13px]"
                      style={{ width: `${[70, 58, 64, 46, 52][row]}%` }}
                    />
                    <Bar className="mt-1.5 h-[6px] w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Two dropdown pills, no card. */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
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
