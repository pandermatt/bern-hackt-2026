import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SIGNET_FLAME_ORDER,
  SIGNET_PATHS,
  SIGNET_VIEWBOX,
  flameIndex,
} from "@/lib/signet";

/*
 * The guard on the logo, and specifically on the one thing about it that can
 * rot without looking broken.
 *
 * The hover animation is driven by `SIGNET_FLAME_ORDER`, a list of colours
 * that is deliberately *not* the order the paths are drawn in — one is fixed
 * by the drawing, the other by the dragon's anatomy. So a path re-traced into
 * a fill nobody added to that list still renders perfectly; it simply never
 * lights up, in the middle of a coil where nobody counts the segments. Nothing
 * else in the suite would notice.
 *
 * The artwork itself is checked against `res/logos/beyond-money-icon.svg`,
 * which is the supplied file and the thing `lib/signet.ts` was generated from.
 */

const ARTWORK = readFileSync(
  resolve("res/logos/beyond-money-icon.svg"),
  "utf8",
);

describe("the logo mark", () => {
  it("draws something in a real box", () => {
    expect(SIGNET_PATHS.length).toBeGreaterThan(0);
    for (const path of SIGNET_PATHS) {
      expect(path.d.trim()).not.toBe("");
      expect(path.fill).toMatch(/^#[0-9a-f]{6}$/);
    }

    const box = SIGNET_VIEWBOX.split(" ").map(Number);
    expect(box).toHaveLength(4);
    expect(box.every(Number.isFinite)).toBe(true);
    // A zero-width viewBox renders nothing and throws nowhere.
    expect(box[2]).toBeGreaterThan(0);
    expect(box[3]).toBeGreaterThan(0);
  });

  it("lights every colour in the artwork, and no colours that are not", () => {
    const drawn = new Set(SIGNET_PATHS.map((path) => path.fill));
    const lit = new Set(SIGNET_FLAME_ORDER);

    for (const fill of drawn) {
      expect(lit.has(fill), `${fill} is drawn but never lights up`).toBe(true);
    }
    for (const fill of lit) {
      expect(drawn.has(fill), `${fill} lights up but is never drawn`).toBe(true);
    }
  });

  it("gives each colour one place in the flame", () => {
    expect(new Set(SIGNET_FLAME_ORDER).size).toBe(SIGNET_FLAME_ORDER.length);
    // The delays are `flameIndex * step`, so two colours sharing an index
    // would light together and the flame would visibly skip a beat.
    const indices = SIGNET_PATHS.map((path) => flameIndex(path.fill));
    expect(Math.min(...indices)).toBe(0);
    expect(Math.max(...indices)).toBe(SIGNET_FLAME_ORDER.length - 1);
  });

  it("runs the flame from the teal tail to the orange head", () => {
    // Not the drawing's order — the dragon's. If this list is ever re-derived
    // from `SIGNET_PATHS`, the animation stops meaning anything.
    expect(SIGNET_FLAME_ORDER[0]).toBe("#025865");
    expect(SIGNET_FLAME_ORDER.at(-1)).toBe("#f95c03");
  });

  it("matches the supplied artwork path for path", () => {
    const traced = [...ARTWORK.matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]+)"/g)];
    expect(traced).toHaveLength(SIGNET_PATHS.length);
    traced.forEach(([, fill, d], index) => {
      // Paint order included: the traced shapes overlap, so a reordered array
      // is a silently different drawing.
      expect(SIGNET_PATHS[index].fill).toBe(fill);
      expect(SIGNET_PATHS[index].d).toBe(d);
    });
  });
});
