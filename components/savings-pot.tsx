import { SavingsGoalDelete } from "@/components/savings-goal-delete";
import { formatMoney, potFill, type SavingsPot as Pot } from "@/lib/insights";

/**
 * One savings goal, drawn as a pot that fills.
 *
 * Inline SVG in a server component rather than a chart: this is one number
 * between 0 and 1, and reaching for the ECharts boundary to draw it would put
 * a hydration boundary and a canvas around a rectangle. The jar is a clip
 * path; the "money" is a plain rect whose top edge moves.
 *
 * The fill takes the goal's palette slot from `potSlot`, which is keyed on the
 * row id — so a pot keeps its colour when the one above it is deleted.
 */

/** The jar's inner span, in viewBox units. The fill moves between these. */
const RIM_Y = 26;
const FLOOR_Y = 96;

const BODY =
  `M 12 ${RIM_Y} L 12 ${FLOOR_Y - 8} Q 12 ${FLOOR_Y} 20 ${FLOOR_Y} ` +
  `L 60 ${FLOOR_Y} Q 68 ${FLOOR_Y} 68 ${FLOOR_Y - 8} L 68 ${RIM_Y} Z`;

export function SavingsPot({ pot }: { pot: Pot }) {
  const fill = potFill(pot.savedMinor, pot.targetMinor);
  const full = fill >= 1;
  const surface = FLOOR_Y - (FLOOR_Y - RIM_Y) * fill;
  const colour = `var(--chart-${pot.slot})`;
  // Ids have to be unique per pot or every jar clips against the first one's
  // path. The row id is already unique per account.
  const clip = `pot-clip-${pot.id}`;

  return (
    <li className="relative flex flex-col items-center rounded-lg border border-line bg-surface px-3 py-4 text-center">
      {/* Always visible rather than revealed on hover: a hover affordance is
          not reachable on a touch screen. */}
      <span className="absolute top-1.5 right-1.5">
        <SavingsGoalDelete
          id={pot.id}
          name={pot.name}
          savedMinor={pot.savedMinor}
        />
      </span>

      <svg
        viewBox="0 0 80 104"
        className="h-[104px] w-20 shrink-0"
        role="img"
        aria-label={`${pot.name}: ${formatMoney(pot.savedMinor)} of ${formatMoney(
          pot.targetMinor,
        )} saved, ${Math.round(fill * 100)} per cent full.`}
      >
        <defs>
          <clipPath id={clip}>
            <path d={BODY} />
          </clipPath>
        </defs>

        {/* Empty jar first, so the fill sits inside a visible vessel even at
            zero — an unfunded pot should still read as a pot. */}
        <path d={BODY} fill="var(--surface-muted)" />

        <g clipPath={`url(#${clip})`}>
          <rect x="0" y={surface} width="80" height={FLOOR_Y} fill={colour} />
          {/* A brighter band at the waterline. Several of the ramp's hues are
              pale enough that a flat fill alone reads as a tint of the jar. */}
          {fill > 0 && (
            <rect
              x="0"
              y={surface}
              width="80"
              height="2.5"
              fill="var(--chart-ink)"
              opacity="0.22"
            />
          )}
        </g>

        <path
          d={BODY}
          fill="none"
          stroke="var(--line-strong)"
          strokeWidth="1.5"
        />
        {/* The rim, drawn over the body so the jar has a lip to fill up to. */}
        <rect
          x="8"
          y="16"
          width="64"
          height="11"
          rx="4"
          fill="var(--surface)"
          stroke="var(--line-strong)"
          strokeWidth="1.5"
        />
      </svg>

      <p className="mt-2.5 line-clamp-2 text-[13.5px] leading-snug font-medium text-text">
        {pot.name}
      </p>
      <p
        className={`mt-1 font-mono text-[12.5px] tabular-nums ${
          full ? "text-positive" : "text-text"
        }`}
      >
        {formatMoney(pot.savedMinor)}
      </p>
      <p className="font-mono text-[11.5px] tabular-nums text-text-subtle">
        of {formatMoney(pot.targetMinor)} · {Math.round(fill * 100)}%
      </p>
    </li>
  );
}
