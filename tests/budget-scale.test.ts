import { describe, expect, it } from "vitest";

import {
  budgetScale,
  DIAL_MAX,
  OUTLIER_CAP,
  type BudgetScale,
} from "@/lib/budget-scale";

/** Francs, because every figure in this file is easier to read as one. */
const chf = (amount: number) => Math.round(amount * 100);

/** Where a figure lands on the dial, as a share of the radius. */
const radius = (scale: BudgetScale, amount: number) =>
  scale.toDial(chf(amount)) / DIAL_MAX;

describe("budgetScale", () => {
  it("leaves an ordinary month linear, on a round franc step", () => {
    const scale = budgetScale(
      [chf(1500), chf(700), chf(300)],
      [chf(1200), chf(800), chf(400)],
    );

    expect(scale.compressed).toBe(false);
    expect(scale.rings.map((r) => r / 100)).toEqual([0, 500, 1000, 1500, 2000]);
    // Linear means linear: half the rim sits at half the radius.
    expect(radius(scale, 1000)).toBeCloseTo(0.5, 6);
    expect(radius(scale, 250)).toBeCloseTo(0.125, 6);
  });

  it("keeps the rings between four and six across three decades", () => {
    for (const peak of [80, 260, 940, 3300, 12_000, 47_000, 160_000]) {
      const scale = budgetScale([chf(peak)], [chf(peak / 1.5)]);
      expect(scale.splitNumber).toBeGreaterThanOrEqual(4);
      expect(scale.splitNumber).toBeLessThanOrEqual(6);
    }
  });

  it("compresses a month whose outlier dwarfs its budgets", () => {
    const budgets = [chf(1200), chf(900), chf(700), chf(500), chf(200)];
    const used = [chf(8200), chf(850), chf(640), chf(520), chf(180)];
    const scale = budgetScale(used, budgets);

    expect(scale.compressed).toBe(true);
    // The largest budget lands where the old capped linear dial would have put
    // it, which is what keeps the two modes continuous.
    expect(radius(scale, 1200)).toBeCloseTo(1 / OUTLIER_CAP, 2);
    // And the small categories get room a linear dial fitted to CHF 8'200
    // would not have given them: 200 / 8'856 is under 3%.
    expect(radius(scale, 200)).toBeGreaterThan(0.08);
  });

  it("never clips: the outlier is drawn inside the rim", () => {
    const scale = budgetScale([chf(8200), chf(180)], [chf(1200), chf(200)]);

    expect(scale.rings[scale.splitNumber]).toBeGreaterThanOrEqual(chf(8200));
    expect(scale.toDial(chf(8200))).toBeLessThan(DIAL_MAX);
    // The clamp this replaced put every figure past the cap on the rim
    // together, so two very different amounts drew the same spoke.
    expect(scale.toDial(chf(8200))).toBeGreaterThan(scale.toDial(chf(4000)));
  });

  it("rounds every ring to a figure worth printing", () => {
    const scale = budgetScale([chf(8200)], [chf(1200)]);

    for (const ring of scale.rings) {
      expect(ring % 100).toBe(0);
      // Two significant figures: no ring prints CHF 1'237.
      const francs = ring / 100;
      expect(francs === 0 || Number(francs.toPrecision(2)) === francs).toBe(
        true,
      );
    }
  });

  it("climbs strictly, so no stretch of the dial is flat", () => {
    for (const outlier of [3000, 6400, 8200, 25_000, 120_000]) {
      const scale = budgetScale([chf(outlier), 0], [chf(770), chf(120)]);
      for (let i = 1; i < scale.rings.length; i += 1) {
        expect(scale.rings[i]).toBeGreaterThan(scale.rings[i - 1]);
      }
    }
  });

  it("switches modes without a jump at the threshold", () => {
    const budgets = [chf(1000), chf(400)];
    const just = radius(budgetScale([chf(1000 * OUTLIER_CAP * 0.99)], budgets), 1000);
    const past = radius(budgetScale([chf(1000 * OUTLIER_CAP * 1.01)], budgets), 1000);
    // Rounding to a round franc step moves the linear rim a little, so this is
    // "no pop", not "identical".
    expect(Math.abs(just - past)).toBeLessThan(0.06);
  });

  it("round-trips a ring through both directions", () => {
    for (const scale of [
      budgetScale([chf(1500)], [chf(1200)]),
      budgetScale([chf(8200)], [chf(1200)]),
    ]) {
      scale.rings.forEach((ring, i) => {
        const dial = (i / scale.splitNumber) * DIAL_MAX;
        expect(scale.toMinor(dial)).toBeCloseTo(ring, 6);
        expect(scale.toDial(ring)).toBeCloseTo(dial, 6);
      });
    }
  });

  it("draws a dial for a month with nothing on it", () => {
    const scale = budgetScale([0, 0], [0, 0]);

    expect(scale.compressed).toBe(false);
    expect(scale.splitNumber).toBeGreaterThanOrEqual(4);
    expect(scale.rings[scale.splitNumber]).toBeGreaterThan(0);
    expect(scale.toDial(0)).toBe(0);
  });

  it("stays linear when no budget has been set to compress against", () => {
    // Every limit unset and every suggestion zero: there is no reference, so
    // bending the scale would be fitting it to nothing.
    const scale = budgetScale([chf(8200), chf(20)], [0, 0]);

    expect(scale.compressed).toBe(false);
  });

  it("puts spending of nothing at the hub, not a sliver off it", () => {
    const scale = budgetScale([chf(8200), 0], [chf(1200), chf(200)]);

    expect(scale.toDial(0)).toBe(0);
    expect(scale.toDial(-500)).toBe(0);
  });
});
