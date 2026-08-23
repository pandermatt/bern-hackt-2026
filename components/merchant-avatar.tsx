import {
  Banknote,
  Car,
  CreditCard,
  Globe,
  HeartPulse,
  House,
  Landmark,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

import { merchantDomain, merchantSlug } from "@/lib/merchant-brands";
import { cn } from "@/lib/utils";

/**
 * Lines with no merchant behind them at all, where initials say nothing: "RE"
 * is a worse label for rent than a house is.
 *
 * Keyed on the **name**, not the category, and deliberately kept to this short
 * list. Key it on category and every restaurant collects the same fork — which
 * both repeats the category chip already in the row and throws away the one
 * useful thing a monogram does, which is tell Molino from Luce. Named
 * businesses keep their initials; only the abstractions get a glyph.
 */
export const ABSTRACT_GLYPHS: Record<string, LucideIcon> = {
  Rent: House,
  Krankenkasse: HeartPulse,
  "Mobile Provider": Smartphone,
  "Employer AG": Banknote,
  "Credit card payment": CreditCard,
  "Opening balance": Landmark,
  Taxi: Car,
  "Taxi Services": Car,
  "Unknown Digital Merchant UK": Globe,
};

/** Words that never carry the initial: "H&M" is HM, "Local Bakery & Café" is LB. */
const SKIP = new Set(["&", "and", "the", "die", "der", "das", "of", "at"]);

/** Exported for the top-categories tooltip, which draws the same monogram but
 * as an HTML string — the ECharts tooltip cannot host a React component. */
export function initials(name: string): string {
  const words = name
    .split(/[\s,._-]+/)
    .filter((word) => word && !SKIP.has(word.toLowerCase()));

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const SIZES = {
  32: { box: "h-8 w-8 rounded-md", text: "text-[10px]", glyph: "h-4 w-4", px: 32 },
  20: { box: "h-5 w-5 rounded", text: "text-[9px]", glyph: "h-3 w-3", px: 20 },
} as const;

/**
 * A merchant's brand mark over its initials — whichever of the two the browser
 * ends up with.
 *
 * A plain server component, deliberately. `components/ledger-chunk.tsx` renders
 * on both the page and the `loadLedgerChunk` action precisely so that no
 * transaction becomes client state, and an `onError` fallback here would drag
 * `"use client"` into it. So the monogram is not an *alternative* to the mark,
 * it is the ground the mark is painted on: the initials are always rendered and
 * the icon is laid over them. Nothing here decides between the two — the
 * icon/monogram choice stays the pure map lookup it has to be, and the browser
 * settles it by whether the icon arrives.
 *
 * That layering is what makes a *guessed* domain safe to try
 * (`lib/merchant-brands.ts`): a guess that turns out to be nobody's domain
 * costs a request and lands back on the initials, rather than leaving an empty
 * tile in the row. The cost is a monogram visible for as long as the icon takes
 * to arrive, which for anything but a cold cache is no frames at all.
 *
 * A failed icon does have to be taken out of the way, though, and that is what
 * `data-merchant-mark` and `MERCHANT_MARK_SCRIPT` below are for.
 *
 * A plain `<img>`, not `next/image`: these are 1–15 KB icons already at their
 * final size, served from our own origin. The optimizer would add a
 * `/_next/image` round trip and this repo's first-ever `images` config to save
 * nothing.
 */
export function MerchantAvatar({
  name,
  size = 32,
  className,
}: {
  name: string;
  size?: 32 | 20;
  className?: string;
}) {
  const { box, text, glyph, px } = SIZES[size];
  const domain = merchantDomain(name);
  const Glyph = ABSTRACT_GLYPHS[name];

  return (
    <span
      aria-hidden
      className={cn(
        box,
        text,
        "relative inline-flex shrink-0 items-center justify-center font-semibold",
        /* Neutral, not a chart hue. A colour in this app identifies a category
           and its slot comes from the whole-range ranking; a category→hue hash
           here would have no access to that map and would disagree with the
           donut up the page. Never `--brand` either — that is the signet tile,
           and it is 1.5:1 on white. */
        "bg-surface-muted text-text-muted ring-1 ring-line",
        className,
      )}
    >
      {Glyph ? <Glyph className={glyph} strokeWidth={2} /> : initials(name)}

      {domain && (
        /* eslint-disable-next-line @next/next/no-img-element -- see the note above */
        <img
          src={`/api/merchant-icon/${merchantSlug(name)}`}
          /* Empty alt, not the merchant name: it sits one element away, so a
             labelled image is a duplicate announcement. It is also what makes
             a failed load collapse to nothing — with a real one the browser
             would draw the alt text over the monogram. */
          alt=""
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          data-merchant-mark=""
          /* `MERCHANT_MARK_SCRIPT` sets `hidden` here when the icon 404s,
             which is by definition not what the server rendered. */
          suppressHydrationWarning
          /* `bg-logo-tile`, not `bg-surface`: a merchant mark is drawn for a
             white ground, and a black-glyph favicon (Apple, Nike) would vanish
             on the dark theme's #1c1c1c. Opaque, so the initials underneath do
             not show through it. The ring stays on the tile below — it is
             drawn outside the box either way, and one ring is one ring. */
          className="absolute inset-0 h-full w-full rounded-[inherit] bg-logo-tile object-contain p-0.5"
        />
      )}
    </span>
  );
}

/**
 * Takes a mark that failed to load back out of the document, so the monogram
 * underneath it is what shows.
 *
 * A failed `<img>` with an empty `alt` represents nothing and paints nothing —
 * but `bg-logo-tile` is a *background*, and a background paints on an element
 * whose content never arrived. Left alone, a 404 is a blank white square sitting
 * on top of the initials. Hiding the element takes the tile with it.
 *
 * `hidden`, not `remove()`: an icon can fail while React is still hydrating,
 * and a *missing element* is a mismatch React cannot reconcile — it throws the
 * tree out and rebuilds it from the server HTML, which puts the blank tile
 * straight back. An extra attribute on an element that is still there costs one
 * `suppressHydrationWarning` on the `<img>` above instead — the same trade the
 * standalone script in the layout makes on `<html>`.
 *
 * One capturing listener on the window rather than a handler per mark, for the
 * two reasons that decide it: `error` does not bubble, so capture is the only
 * phase that sees every image from one place; and a handler per mark would have
 * to come from React, which means `onError`, which means `"use client"` on a
 * component that must not have it (see above). This way `MerchantAvatar` stays
 * a plain server component with no bundle of its own, and the ECharts tooltip
 * in `components/top-category-bars.tsx` — an HTML string, no React at all —
 * is covered by the same one line.
 *
 * Rendered once, by `app/[locale]/layout.tsx`, at the top of `<body>`: `error`
 * fires once and is gone, so a listener attached after a mark has already
 * failed never hears about it.
 *
 * With JavaScript off the blank tile comes back. That is the behaviour every
 * unmapped mark already had, and the monogram underneath is still what a screen
 * reader and a text browser get.
 */
export const MERCHANT_MARK_SCRIPT = `addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='IMG'&&t.dataset&&'merchantMark' in t.dataset)t.hidden=true},true)`;
