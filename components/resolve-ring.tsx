/**
 * How much of something has been ticked off, as a filled pie.
 *
 * Inline SVG rather than a chart: `components/echart.tsx` is the only module
 * allowed to import `echarts`, and a canvas cannot render on the server or
 * hold its shape at 20px. This is a glyph that happens to be data-driven, not
 * a chart — it has no axes, no legend and no tooltip.
 *
 * A server component. It renders the same markup in the overview's rule rows,
 * where it is only an indicator, and inside `components/resolve-toggle.tsx`,
 * where a client button wraps it.
 *
 * The label is not optional. The fill is `--accent` on `--surface`, so the
 * whole reading is carried by one colour against one ground — exactly the
 * colour-only distinction the ledger's badges already avoid by carrying an
 * `sr-only` word. `label` is that word here.
 */
export function ResolveRing({
  resolved,
  total,
  label,
  className = "size-[18px]",
}: {
  resolved: number;
  total: number;
  label: string;
  /** Sized by the caller — 18px in a list row, a little larger in a heading. */
  className?: string;
}) {
  // A group with nothing in it draws as empty rather than dividing by zero.
  const fraction = total > 0 ? Math.min(1, Math.max(0, resolved / total)) : 0;
  const complete = fraction >= 1;

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      className={`shrink-0 ${className}`}
    >
      <title>{label}</title>
      {/* The track. `--surface` is the app's own white/near-black, which is
          what a chart's ground is on the grey panels these rows sit on. */}
      <circle cx="12" cy="12" r="10" fill="var(--surface)" />
      {complete ? (
        <circle cx="12" cy="12" r="10" fill="var(--accent)" />
      ) : (
        fraction > 0 && <path d={wedge(fraction)} fill="var(--accent)" />
      )}
      {/* Drawn last so the fill never eats its own outline. */}
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * The filled slice, from twelve o'clock, clockwise.
 *
 * Only ever called for a fraction strictly between 0 and 1 — a full circle has
 * identical start and end points and would collapse to nothing, which is why
 * the caller draws that case as a plain circle instead.
 */
function wedge(fraction: number): string {
  const angle = fraction * 2 * Math.PI;
  const x = 12 + 10 * Math.sin(angle);
  const y = 12 - 10 * Math.cos(angle);
  const largeArc = fraction > 0.5 ? 1 : 0;
  return `M 12 12 L 12 2 A 10 10 0 ${largeArc} 1 ${x} ${y} Z`;
}
