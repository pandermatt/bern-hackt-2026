"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Publishes `--tint` for its subtree: the dominant colour of the brand mark
 * rendered inside it, or the supplied fallback when there is no mark to read.
 *
 * **Why a client component, in a list that is otherwise server-rendered.** A
 * favicon's colour is only knowable by decoding the image, and nothing in this
 * app can decode a PNG — the icons are cached as raw bytes by
 * `app/api/merchant-icon/[slug]/route.ts` and never opened. The browser has
 * already decoded every one of them by the time this runs, so a 24×24
 * `drawImage` costs a few hundred microseconds and no network. The alternative
 * — a hand-kept table of brand hexes next to `MERCHANT_BRANDS` — would be ~60
 * colours to maintain, wrong for any merchant added later, and still only a
 * guess at what the mark on screen actually looks like.
 *
 * Nothing financial crosses: the children arrive as already-rendered RSC
 * output, and the only prop is a colour. `MerchantAvatar` stays a server
 * component — this reaches for its `<img>` through the DOM rather than
 * rendering one itself, so the icon/monogram decision stays the pure map
 * lookup that `components/ledger-chunk.tsx` depends on.
 */
export function BrandTint({
  fallback,
  className,
  children,
}: {
  /** Used until (and unless) a colour can be read — a `--chart-N` slot. */
  fallback: string;
  className?: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [tint, setTint] = useState<string | null>(null);

  useEffect(() => {
    const img = host.current?.querySelector("img");
    if (!img) return;

    const read = () => setTint(dominantColour(img));

    // A cached icon is decoded before this effect ever runs, and `load` has
    // already fired by then — checking `complete` is what covers every render
    // after the first.
    if (img.complete) {
      read();
      return;
    }
    img.addEventListener("load", read, { once: true });
    return () => img.removeEventListener("load", read);
  }, []);

  return (
    <div
      ref={host}
      className={className}
      style={{ "--tint": tint ?? fallback } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** Sampling grid. A favicon is 16–64px; 24 is enough to rank its hues. */
const SIZE = 24;

/**
 * The most-present hue in a brand mark, normalised into a band this app can
 * safely put type on.
 *
 * Two things it deliberately ignores. **Greys** — a logo is mostly its white
 * plate and its black wordmark, and averaging those in returns mud for every
 * merchant. **Lightness and saturation as given**: a mark is drawn to sit on
 * white at full strength, and the palette rules here need a fill that clears
 * contrast against `--text` on both themes. Clamping to the band below is what
 * makes an arbitrary hue safe to use as a ground.
 */
function dominantColour(img: HTMLImageElement): string | null {
  if (!img.naturalWidth) return null;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  let pixels: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    // Same-origin (`/api/merchant-icon/…`), so the canvas is never tainted —
    // but a decode failure still lands here rather than taking out the row.
    pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  } catch {
    return null;
  }

  // Hue is the bucket, because a mark's colour survives its own shading;
  // bucketing on RGB splits one logo across a dozen near-identical entries.
  const buckets = new Map<number, { weight: number; s: number; l: number }>();

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 160) continue;

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    // Grey, near-black and near-white carry no hue to borrow.
    if (max - min < 24 || max < 40 || min > 225) continue;

    const [h, s, l] = rgbToHsl(r, g, b);
    const key = Math.floor(h / 24) % 15;
    const bucket = buckets.get(key) ?? { weight: 0, s: 0, l: 0 };
    // Saturation as the weight: a washed-out anti-aliasing fringe is a large
    // share of a 24×24 sample and should not outvote the mark it surrounds.
    const weight = s * (alpha / 255);
    bucket.weight += weight;
    bucket.s += s * weight;
    bucket.l += l * weight;
    buckets.set(key, bucket);
  }

  let winner: { weight: number; s: number; l: number } | null = null;
  let hue = 0;
  for (const [key, bucket] of buckets) {
    if (!winner || bucket.weight > winner.weight) {
      winner = bucket;
      hue = key * 24 + 12;
    }
  }
  // A monochrome mark (Apple, Nike): no hue at all, and the caller's ramp slot
  // is a better answer than a grey bar.
  if (!winner || winner.weight === 0) return null;

  const s = clamp(winner.s / winner.weight, 0.35, 0.9);
  const l = clamp(winner.l / winner.weight, 0.42, 0.62);
  return hslToHex(hue, s, l);
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

/** `h` in degrees, `s`/`l` in 0–1. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  const l = (max + min) / 2;
  if (chroma === 0) return [0, 0, l];

  const s = chroma / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === red) h = ((green - blue) / chroma) % 6;
  else if (max === green) h = (blue - red) / chroma + 2;
  else h = (red - green) / chroma + 4;

  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];

  const hex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
