/**
 * The radial scale the budget radar draws on.
 *
 * The rings are francs on one scale shared by every spoke, which is what makes
 * the two shapes readable as shapes — a spoke sitting far out is a large amount
 * of money wherever it is on the dial. A single month can wreck that. Limits
 * averaging CHF 770 next to one runaway category at CHF 8'200 is a 10:1 spread,
 * and on a linear dial fitted to the outlier every other ring collapses into a
 * knot at the hub: the chart still draws, but the thing it exists to show —
 * which categories crossed their line — is a few pixels wide.
 *
 * So the dial is **fitted per month, and compressed only when a month needs
 * it**. A month whose spending stays within {@link OUTLIER_CAP} of its largest
 * budget gets the plain linear dial it has always had, on a round franc step.
 * A month with an outlier gets a logarithmic one instead: the rings still climb
 * in francs, but each is a multiple of the one inside it rather than a fixed
 * step above it, so the near-hub categories get room and the outlier still
 * shows its real size out near the rim.
 *
 * This replaces clamping. The dial used to stop at `OUTLIER_CAP × the largest
 * limit` and paint anything past it on the rim with a `+` on the outer tick —
 * honest, but it threw away the one figure the reader was looking at. Nothing
 * clips here; the outlier is drawn where it actually falls.
 *
 * Pure and free of React so the arithmetic can be tested directly — see
 * `tests/budget-scale.test.ts`.
 */

/**
 * How far past the largest budget a month may stretch a *linear* dial.
 *
 * Past this the spread is wide enough that the rings closest to the hub stop
 * being separable, and the scale switches to a logarithmic one.
 */
export const OUTLIER_CAP = 2.5;

/**
 * Where the largest budget sits on a compressed dial, as a share of the radius.
 *
 * This is the position it would have had on the old capped linear dial at the
 * moment the cap bound (`1 / OUTLIER_CAP`), and pinning it there is what keeps
 * the two modes continuous: a month that just crosses the threshold solves to a
 * knee so far out that the curve is linear anyway, so paging from month to
 * month never pops.
 */
const REFERENCE_RADIUS = 1 / OUTLIER_CAP;

/** Rings on a compressed dial, hub excluded. Four to six is the readable band. */
const COMPRESSED_RINGS = 5;

/** Clearance between the largest figure and the rim, so nothing sits on the tick. */
const HEADROOM = 1.08;

/** The smallest dial worth drawing: CHF 100. A quiet month is not a broken one. */
const MIN_RIM = 10_000;

/**
 * The dial's own units.
 *
 * ECharts spaces a radar's rings evenly through `[0, max]`, so the values fed
 * to the series cannot be francs once the scale bends — they are positions on
 * the dial, and {@link BudgetScale.toMinor} turns a ring back into the franc
 * figure its label prints. A round number rather than 1 so the tick values
 * ECharts hands the formatter stay clear of float noise.
 */
export const DIAL_MAX = 1000;

export type BudgetScale = {
  /** The rim, in dial units. Always {@link DIAL_MAX}; the shape is the scale. */
  max: number;
  /** Rings between hub and rim — what ECharts calls `splitNumber`. */
  splitNumber: number;
  /**
   * The franc figure (in minor units) at each ring, hub first and rim last.
   * Round numbers by construction, so a tick never prints `CHF 1'237`.
   */
  rings: number[];
  /** True when the month was spread out enough to bend the scale. */
  compressed: boolean;
  /** Minor units → a position on the dial. */
  toDial: (minor: number) => number;
  /** A position on the dial → minor units, for the ring labels. */
  toMinor: (dial: number) => number;
};

/**
 * Rounds to two significant figures, never finer than a whole franc.
 *
 * The rings are *chosen* rather than derived on the fly precisely so their
 * labels can be round: the transform is then fitted through them, which makes
 * the printed figure the exact value of the ring it sits on rather than a
 * tidied-up approximation of it.
 */
function roundish(minor: number, up = false): number {
  if (minor <= 0) return 0;
  const step = Math.max(100, 10 ** (Math.floor(Math.log10(minor)) - 1));
  return (up ? Math.ceil : Math.round)(minor / step) * step;
}

/**
 * A linear dial just above the month's largest figure, on a round franc step.
 *
 * `1 / 2 / 2.5 / 5` per decade is the usual set, picked so the dial lands on
 * four to six rings: fewer and the shapes float in empty space, more and the
 * rings start reading as noise behind them.
 */
function linearRings(rim: number): number[] {
  const magnitude = 10 ** Math.floor(Math.log10(rim / 4));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = steps.find((s) => rim / s <= 6) ?? steps[steps.length - 1];
  const count = Math.ceil(rim / step);
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

/**
 * The knee of the compression curve, in minor units.
 *
 * The curve is `ln(1 + x/k) / ln(1 + rim/k)` — a symlog, because spending of
 * exactly zero is an ordinary thing for a category to do and `log 0` is not a
 * position on a dial. Below the knee it is effectively linear and above it
 * effectively logarithmic, so `k` alone decides how hard the month is squeezed.
 *
 * Solved rather than picked: `k` is whatever puts the largest budget at
 * {@link REFERENCE_RADIUS}. The curve is monotone in `k` (at `k → 0` the
 * reference approaches the rim, at `k → ∞` it approaches its linear position,
 * which is below the target whenever compression engaged at all), so a
 * bisection cannot miss — geometric, because `k` ranges over decades and
 * halving the *interval* would spend every step in the wrong one.
 */
function kneeFor(rim: number, reference: number): number {
  const radiusAt = (k: number) => Math.log1p(reference / k) / Math.log1p(rim / k);
  let lo = rim * 1e-9;
  let hi = rim * 1e9;
  for (let i = 0; i < 60; i += 1) {
    const mid = Math.sqrt(lo * hi);
    if (radiusAt(mid) > REFERENCE_RADIUS) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/**
 * Rings climbing geometrically from the hub, each rounded to a printable figure.
 *
 * The rim rounds *up* so the largest figure always stays inside the dial, and
 * every interior ring is nudged past the one inside it — two rings rounding to
 * the same franc figure would make the transform below flat over an interval,
 * and a flat stretch is a stretch where spending differences stop showing.
 */
function compressedRings(rim: number, reference: number): number[] {
  const knee = kneeFor(rim, reference);
  const span = Math.log1p(rim / knee);
  const rings = [0];
  for (let i = 1; i < COMPRESSED_RINGS; i += 1) {
    const exact = knee * Math.expm1((i / COMPRESSED_RINGS) * span);
    rings.push(Math.max(roundish(exact), rings[i - 1] + 100));
  }
  rings.push(Math.max(roundish(rim, true), rings[COMPRESSED_RINGS - 1] + 100));
  return rings;
}

/** Position of `minor` on a dial whose rings sit at `rings`, by interpolation. */
function interpolate(rings: number[], minor: number): number {
  const last = rings.length - 1;
  const width = DIAL_MAX / last;
  if (minor <= 0) return 0;
  if (minor >= rings[last]) return DIAL_MAX;
  const i = rings.findIndex((ring) => ring > minor);
  const span = rings[i] - rings[i - 1];
  return (i - 1) * width + ((minor - rings[i - 1]) / span) * width;
}

/**
 * The dial for one month.
 *
 * `budgetMinor` is the limit each category carries, or the app's suggestion
 * where none is set — the same figure the dashed shape is drawn from, so the
 * reference the compression is fitted to is a line actually on the chart.
 */
export function budgetScale(
  usedMinor: number[],
  budgetMinor: number[],
): BudgetScale {
  const topBudget = Math.max(0, ...budgetMinor);
  const peak = Math.max(0, topBudget, ...usedMinor);
  const rim = Math.max(MIN_RIM, peak * HEADROOM);

  // A month with no budgets and no suggestions has no reference to compress
  // against, and one whose spending stays near its budgets does not need to be.
  const compressed = topBudget > 0 && rim > topBudget * OUTLIER_CAP;
  const rings = compressed
    ? compressedRings(rim, topBudget)
    : linearRings(rim);

  const last = rings.length - 1;
  return {
    max: DIAL_MAX,
    splitNumber: last,
    rings,
    compressed,
    toDial: (minor) => interpolate(rings, minor),
    toMinor: (dial) => {
      const at = (dial / DIAL_MAX) * last;
      const i = Math.min(last - 1, Math.max(0, Math.floor(at)));
      return rings[i] + (at - i) * (rings[i + 1] - rings[i]);
    },
  };
}
