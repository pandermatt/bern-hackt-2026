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

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <div key={tile} className="card p-4">
              <Bar className="h-[13px] w-[64px]" />
              <Bar className="mt-2 h-[20px] w-[110px]" />
              <Bar className="mt-2.5 h-[12px] w-[88px]" />
            </div>
          ))}
        </div>

        {/* Month by month: 360px of canvas plus the footnote line. */}
        <div className="card mt-4 p-5">
          <Bar className="h-[15px] w-[130px]" />
          <Bar className="mt-4 h-[360px] w-full" />
          <Bar className="mt-3 h-[11px] w-[300px]" />
        </div>

        {/* The whole year: 320px of donut. */}
        <div className="card mt-4 p-5">
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

        <div className="card mt-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((field) => (
              <Bar key={field} className="h-[52px] w-full" />
            ))}
          </div>
          {/* The category chip row, collapsed to one bar rather than one per
              chip — the skeleton approximates fields, it doesn't enumerate
              them. */}
          <Bar className="mt-3 h-[30px] w-full" />
        </div>

        <div className="card mt-4 overflow-hidden">
          <div className="border-b border-line px-4 py-3.5 sm:px-5">
            <Bar className="h-[15px] w-[110px]" />
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex items-center gap-3 border-b border-line px-4 py-4 last:border-b-0 sm:px-5"
            >
              <Bar
                className="h-[14px]"
                style={{ width: `${[42, 31, 48, 36, 27][row]}%` }}
              />
              <Bar className="ml-auto h-[13px] w-[80px] shrink-0" />
            </div>
          ))}
          {/* The Previous / page N of M / Next footer. */}
          <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 sm:px-5">
            <Bar className="h-8 w-[76px]" />
            <Bar className="h-[12px] w-[90px]" />
            <Bar className="h-8 w-[52px]" />
          </div>
        </div>
      </div>
    </main>
  );
}
