/**
 * The radial scale the budget radar draws on.
 *
 * Every spoke is measured against **its own budget**, not against a single
 * franc scale shared by all of them. One ring is 100% — your limit for that
 * category, or the app's suggestion where you have not set one — so the dashed
 * budget shape is a *circle*, and the spent shape crossing it anywhere is the
 * one thing the chart exists to say. A shared franc dial could not do that: on
 * a month with limits from CHF 120 to CHF 1'200 the dashed outline is a
 * ten-pointed star, every spoke sitting at a different radius for reasons that
 * have nothing to do with whether the month went well, and the reader has to
 * measure each pair by eye before the shape means anything.
 *
 * What that costs is magnitude. A radius no longer says how much money — CHF 60
 * of a CHF 50 budget and CHF 6'000 of a CHF 5'000 one draw the identical spoke.
 * The francs are in the tooltip and in the `sr-only` table underneath, which is
 * where they now live.
 *
 * The dial is still **fitted per month, and compressed only when a month needs
 * it**. A month that stays inside {@link OUTLIER_CAP} × its budgets gets a
 * plain linear dial on a round percentage step. A month where one category ran
 * to 700% gets a logarithmic one instead: the rings still climb in percent, but
 * each is a multiple of the one inside it rather than a fixed step above it, so
 * the categories near their line keep the room to be read and the runaway one
 * still shows its real size out near the rim. Nothing is ever clamped onto the
 * rim; the outlier is drawn where it actually falls.
 *
 * Pure and free of React so the arithmetic can be tested directly — see
 * `tests/budget-scale.test.ts`.
 */

/**
 * Spending exactly at budget, in the units this module works in.
 *
 * Basis points of the category's own budget: 10'000 bp = 100%, so 100 bp is one
 * percentage point — which is also the finest figure {@link roundish} will
 * print, and therefore the finest a ring can be.
 */
export const BUDGET_RING = 10_000;

/**
 * How far past its budget a month may stretch a *linear* dial.
 *
 * Past this the spread is wide enough that the rings closest to the hub stop
 * being separable, and the scale switches to a logarithmic one.
 */
export const OUTLIER_CAP = 2.5;

/**
 * Where the budget ring sits on a compressed dial, as a share of the radius.
 *
 * This is the position it would have had on a linear dial at the moment the cap
 * bound (`1 / OUTLIER_CAP`), and pinning it there is what keeps the two modes
 * continuous: a month that just crosses the threshold solves to a knee so far
 * out that the curve is linear anyway, so paging from month to month never pops.
 */
const REFERENCE_RADIUS = 1 / OUTLIER_CAP;

/**
 * Rings on a compressed dial, hub excluded. Four to six is the readable band,
 * and five is the one that puts {@link REFERENCE_RADIUS} on a whole ring
 * (`0.4 × 5`), so the budget circle lands *on* a gridline rather than between
 * two of them — the same thing linear mode gets for free below.
 */
const COMPRESSED_RINGS = 5;

/** Clearance between the largest figure and the rim, so nothing sits on the tick. */
const HEADROOM = 1.08;

/**
 * The smallest dial worth drawing: 120% of budget.
 *
 * Not 100%, because at 100% the budget circle would be welded to the outer axis
 * line — the dashed shape and the rim would draw over each other in every month
 * where nothing was overspent, which is most of them.
 */
const MIN_RIM = 12_000;

/**
 * The dial's own units.
 *
 * ECharts spaces a radar's rings evenly through `[0, max]`, so the values fed
 * to the series cannot be percentages once the scale bends — they are positions
 * on the dial, and {@link BudgetScale.toPercent} turns a ring back into the
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
   * The figure at each ring in basis points of budget, hub first and rim last.
   * Whole percentage points by construction, so a tick never prints `137%`.
   */
  rings: number[];
  /** True when the month was spread out enough to bend the scale. */
  compressed: boolean;
  /** Share of budget in basis points → a position on the dial. */
  toDial: (share: number) => number;
  /** A position on the dial → percent of budget, for the ring labels. */
  toPercent: (dial: number) => number;
};

/**
 * What a category spent, as basis points of what it was allowed.
 *
 * `reference` is the limit the account holder set, or the app's suggestion
 * where they set none — the same figure the dashed circle stands for, so the
 * shape and the number under the axis name are the one quantity. A category
 * with neither has nothing to be measured against and reads as zero rather
 * than as infinity.
 */
export function shareOf(usedMinor: number, reference: number): number {
  if (reference <= 0 || usedMinor <= 0) return 0;
  return (usedMinor / reference) * BUDGET_RING;
}

/**
 * Rounds to two significant figures, never finer than a whole percentage point.
 *
 * The rings are *chosen* rather than derived on the fly precisely so their
 * labels can be round: the transform is then fitted through them, which makes
 * the printed figure the exact value of the ring it sits on rather than a
 * tidied-up approximation of it.
 */
function roundish(share: number, up = false): number {
  if (share <= 0) return 0;
  const step = Math.max(100, 10 ** (Math.floor(Math.log10(share)) - 1));
  return (up ? Math.ceil : Math.round)(share / step) * step;
}

/**
 * A linear dial just above the month's largest share, on a round percentage step.
 *
 * `1 / 2 / 2.5 / 5` per decade is the usual set, picked so the dial lands on
 * four to six rings: fewer and the shapes float in empty space, more and the
 * rings start reading as noise behind them. Every step it can pick — 10, 20,
 * 25, 50 points — divides 100 evenly, and {@link MIN_RIM} keeps the magnitude
 * pinned at one decade, so **the budget circle always lands on a ring**.
 */
function linearRings(rim: number): number[] {
  const magnitude = 10 ** Math.floor(Math.log10(rim / 4));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = steps.find((s) => rim / s <= 6) ?? steps[steps.length - 1];
  const count = Math.ceil(rim / step);
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

/**
 * The knee of the compression curve, in basis points.
 *
 * The curve is `ln(1 + x/k) / ln(1 + rim/k)` — a symlog, because spending of
 * exactly zero is an ordinary thing for a category to do and `log 0` is not a
 * position on a dial. Below the knee it is effectively linear and above it
 * effectively logarithmic, so `k` alone decides how hard the month is squeezed.
 *
 * Solved rather than picked: `k` is whatever puts the budget ring at
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
 * the same percentage would make the transform below flat over an interval, and
 * a flat stretch is a stretch where spending differences stop showing.
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

/** Position of `share` on a dial whose rings sit at `rings`, by interpolation. */
function interpolate(rings: number[], share: number): number {
  const last = rings.length - 1;
  const width = DIAL_MAX / last;
  if (share <= 0) return 0;
  if (share >= rings[last]) return DIAL_MAX;
  const i = rings.findIndex((ring) => ring > share);
  const span = rings[i] - rings[i - 1];
  return (i - 1) * width + ((share - rings[i - 1]) / span) * width;
}

/**
 * The dial for one month, from the shares its categories drew.
 *
 * `shares` are what {@link shareOf} returns, one per spoke. The budget ring is
 * always on the dial whether or not anything reached it — a month where every
 * category came in under is a shape inside a circle, which is the reading, and
 * a dial fitted to the spending alone would hide the circle off the rim.
 */
export function budgetScale(shares: number[]): BudgetScale {
  const peak = Math.max(BUDGET_RING, 0, ...shares);
  const rim = Math.max(MIN_RIM, peak * HEADROOM);

  // Only a month that ran well past its budgets needs bending; the rest get the
  // even percentage steps, which are easier to read and easier to trust.
  const compressed = rim > BUDGET_RING * OUTLIER_CAP;
  const rings = compressed
    ? compressedRings(rim, BUDGET_RING)
    : linearRings(rim);

  const last = rings.length - 1;
  return {
    max: DIAL_MAX,
    splitNumber: last,
    rings,
    compressed,
    toDial: (share) => interpolate(rings, share),
    toPercent: (dial) => {
      const at = (dial / DIAL_MAX) * last;
      const i = Math.min(last - 1, Math.max(0, Math.floor(at)));
      return (rings[i] + (at - i) * (rings[i + 1] - rings[i])) / 100;
    },
  };
}
