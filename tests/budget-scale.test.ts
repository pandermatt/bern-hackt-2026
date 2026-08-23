import { describe, expect, it } from "vitest";

import {
  budgetScale,
  BUDGET_RING,
  DIAL_MAX,
  OUTLIER_CAP,
  shareOf,
  type BudgetScale,
} from "@/lib/budget-scale";

/** Francs, because every figure in this file is easier to read as one. */
const chf = (amount: number) => Math.round(amount * 100);

/** A share of budget, written as the percentage anyone would say out loud. */
const pct = (percent: number) => (percent / 100) * BUDGET_RING;

/** Where a share lands on the dial, as a fraction of the radius. */
const radius = (scale: BudgetScale, percent: number) =>
  scale.toDial(pct(percent)) / DIAL_MAX;

describe("shareOf", () => {
  it("measures a category against its own budget", () => {
    expect(shareOf(chf(600), chf(500))).toBe(pct(120));
    expect(shareOf(chf(60), chf(50))).toBe(pct(120));
  });

  it("reads a category with nothing to be measured against as zero", () => {
    // Not infinity, and not a spoke on the rim: an unbudgeted category with no
    // suggestion either has no verdict to draw.
    expect(shareOf(chf(600), 0)).toBe(0);
    expect(shareOf(0, chf(500))).toBe(0);
  });
});

describe("budgetScale", () => {
  it("leaves an ordinary month linear, on a round percentage step", () => {
    const scale = budgetScale([pct(125), pct(88), pct(75)]);

    expect(scale.compressed).toBe(false);
    expect(scale.rings.map((r) => r / 100)).toEqual([
      0, 25, 50, 75, 100, 125, 150,
    ]);
    // Linear means linear: half the rim sits at half the radius.
    expect(radius(scale, 75)).toBeCloseTo(0.5, 6);
    expect(radius(scale, 37.5)).toBeCloseTo(0.25, 6);
  });

  it("puts the budget circle on a ring, whatever the month did", () => {
    // The dashed shape is one radius for every spoke, so it either coincides
    // with a gridline or floats just off one all the way round. It coincides.
    for (const peak of [0, 40, 96, 100, 130, 180, 230, 260, 400, 900, 4000]) {
      const scale = budgetScale([pct(peak), pct(peak / 3)]);
      expect(scale.rings).toContain(BUDGET_RING);
      // And never welded to the rim, where it would draw over the axis line.
      expect(radius(scale, 100)).toBeLessThanOrEqual(0.85);
    }
  });

  it("keeps the rings between four and six across the linear range", () => {
    for (const peak of [0, 60, 100, 118, 145, 190, 230]) {
      const scale = budgetScale([pct(peak)]);
      expect(scale.splitNumber).toBeGreaterThanOrEqual(4);
      expect(scale.splitNumber).toBeLessThanOrEqual(6);
    }
  });

  it("compresses a month whose outlier dwarfs its budgets", () => {
    // CHF 8'200 against a CHF 1'200 limit, beside four categories near theirs.
    const scale = budgetScale([pct(683), pct(94), pct(91), pct(104), pct(90)]);

    expect(scale.compressed).toBe(true);
    // The budget circle lands where the linear dial would have put it at the
    // moment the cap bound, which is what keeps the two modes continuous.
    expect(radius(scale, 100)).toBeCloseTo(1 / OUTLIER_CAP, 2);
    // And the categories sitting on their line keep the room to be told apart:
    // 90% and 104% are a fifth of the radius apart, not three pixels.
    expect(radius(scale, 104) - radius(scale, 90)).toBeGreaterThan(0.02);
  });

  it("never clips: the outlier is drawn inside the rim", () => {
    const scale = budgetScale([pct(683), pct(90)]);

    expect(scale.rings[scale.splitNumber]).toBeGreaterThanOrEqual(pct(683));
    expect(scale.toDial(pct(683))).toBeLessThan(DIAL_MAX);
    // The clamp this replaced put every figure past the cap on the rim
    // together, so two very different overruns drew the same spoke.
    expect(scale.toDial(pct(683))).toBeGreaterThan(scale.toDial(pct(340)));
  });

  it("rounds every ring to a figure worth printing", () => {
    const scale = budgetScale([pct(683)]);

    for (const ring of scale.rings) {
      // Whole percentage points: no ring prints 137%.
      expect(ring % 100).toBe(0);
      // Two significant figures, so none prints 683% either.
      const percent = ring / 100;
      expect(percent === 0 || Number(percent.toPrecision(2)) === percent).toBe(
        true,
      );
    }
  });

  it("climbs strictly, so no stretch of the dial is flat", () => {
    for (const outlier of [300, 640, 820, 2500, 12_000]) {
      const scale = budgetScale([pct(outlier), 0]);
      for (let i = 1; i < scale.rings.length; i += 1) {
        expect(scale.rings[i]).toBeGreaterThan(scale.rings[i - 1]);
      }
    }
  });

  it("switches modes without a jump at the threshold", () => {
    const just = radius(budgetScale([pct(100 * OUTLIER_CAP * 0.99)]), 100);
    const past = radius(budgetScale([pct(100 * OUTLIER_CAP * 1.01)]), 100);
    // Rounding to a round percentage step moves the linear rim a little, so
    // this is "no pop", not "identical".
    expect(Math.abs(just - past)).toBeLessThan(0.06);
  });

  it("round-trips a ring through both directions", () => {
    for (const scale of [budgetScale([pct(125)]), budgetScale([pct(683)])]) {
      scale.rings.forEach((ring, i) => {
        const dial = (i / scale.splitNumber) * DIAL_MAX;
        expect(scale.toPercent(dial)).toBeCloseTo(ring / 100, 6);
        expect(scale.toDial(ring)).toBeCloseTo(dial, 6);
      });
    }
  });

  it("draws a dial for a month with nothing on it", () => {
    const scale = budgetScale([0, 0]);

    expect(scale.compressed).toBe(false);
    expect(scale.splitNumber).toBeGreaterThanOrEqual(4);
    // The budget circle is on the dial even though no spending reached it —
    // a shape well inside the ring is the reading, not an empty chart.
    expect(scale.rings).toContain(BUDGET_RING);
    expect(scale.toDial(0)).toBe(0);
  });

  it("puts spending of nothing at the hub, not a sliver off it", () => {
    const scale = budgetScale([pct(683), 0]);

    expect(scale.toDial(0)).toBe(0);
    expect(scale.toDial(-500)).toBe(0);
  });
});
