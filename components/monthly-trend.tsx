import { formatMoney, type MonthPoint } from "@/lib/insights";

/*
 * Server-rendered SVG rather than a chart library. This is twelve pairs of
 * rectangles, and every React charting library is client-only — one would ship
 * a few hundred KB of JavaScript and a hydration boundary to draw them. Inline
 * SVG is in the HTML at first paint, works with JS off, and never shifts.
 */

const WIDTH = 720;
/**
 * Left gutter for the axis labels, so January's bars cannot sit on top of them.
 * Wide enough for a six-character amount at 10px monospace plus breathing room —
 * the labels are anchored at x=0 because an end-anchored one runs off the left
 * edge of the viewBox and gets clipped.
 */
const GUTTER = 52;
const PLOT_TOP = 14;
const PLOT_HEIGHT = 178;
const BASELINE = PLOT_TOP + PLOT_HEIGHT;
const LABEL_BASELINE = BASELINE + 20;
const HEIGHT = LABEL_BASELINE + 8;

/** Rounds a rappen amount up to a tidy gridline so the axis reads cleanly. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

export function MonthlyTrend({ series }: { series: MonthPoint[] }) {
  if (series.length === 0) return null;

  const peak = niceCeiling(
    Math.max(1, ...series.flatMap((point) => [point.income, point.expense])),
  );
  const column = (WIDTH - GUTTER) / series.length;
  const barWidth = Math.min(16, column / 2 - 5);
  const scale = (value: number) => (value / peak) * PLOT_HEIGHT;

  return (
    <section className="card p-5" aria-labelledby="trend-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="trend-heading" className="text-[15px] font-semibold text-text">
          Month by month
        </h2>
        <p className="flex items-center gap-3 text-[12.5px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-positive" aria-hidden />
            In
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-danger" aria-hidden />
            Out
          </span>
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height="auto"
          role="img"
          aria-labelledby="trend-title trend-desc"
          className="min-w-[560px]"
        >
          <title id="trend-title">Money in and out, by month</title>
          <desc id="trend-desc">
            Paired bars for each month. The table below the chart carries the
            same figures.
          </desc>

          {/* Quarter gridlines, drawn behind the bars. */}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = BASELINE - fraction * PLOT_HEIGHT;
            return (
              <g key={fraction}>
                <line
                  x1={GUTTER - 8}
                  x2={WIDTH}
                  y1={y}
                  y2={y}
                  stroke="var(--line)"
                  strokeWidth={1}
                />
                {fraction > 0 && (
                  <text
                    x={0}
                    y={y + 3.5}
                    className="fill-[var(--text-subtle)] font-mono text-[10px]"
                  >
                    {Math.round((peak * fraction) / 100).toLocaleString("de-CH")}
                  </text>
                )}
              </g>
            );
          })}

          {series.map((point, index) => {
            const centre = GUTTER + index * column + column / 2;
            const incomeHeight = scale(point.income);
            const expenseHeight = scale(point.expense);

            return (
              <g key={point.month}>
                <rect
                  x={centre - barWidth - 1}
                  y={BASELINE - incomeHeight}
                  width={barWidth}
                  height={incomeHeight}
                  rx={2}
                  fill="var(--positive)"
                />
                <rect
                  x={centre + 1}
                  y={BASELINE - expenseHeight}
                  width={barWidth}
                  height={expenseHeight}
                  rx={2}
                  fill="var(--danger)"
                />
                <text
                  x={centre}
                  y={LABEL_BASELINE}
                  textAnchor="middle"
                  className="fill-[var(--text-muted)] font-mono text-[11px]"
                >
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* The same numbers, for screen readers and anyone the chart fails. */}
      <table className="sr-only">
        <caption>Money in and out, by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">In</th>
            <th scope="col">Out</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point) => (
            <tr key={point.month}>
              <th scope="row">{point.month}</th>
              <td>{formatMoney(point.income)}</td>
              <td>{formatMoney(point.expense)}</td>
              <td>
                {point.net < 0 ? "−" : ""}
                {formatMoney(point.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 font-mono text-[11.5px] text-text-subtle">
        Amounts in CHF. Transfers between your own accounts are excluded.
      </p>
    </section>
  );
}
