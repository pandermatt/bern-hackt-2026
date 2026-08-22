import {
  Banknote,
  Car,
  CreditCard,
  Globe,
  HeartPulse,
  House,
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
 * A merchant's brand mark, or its initials when there is no mark to show.
 *
 * A plain server component, deliberately. `components/ledger-chunk.tsx` renders
 * on both the page and the `loadLedgerChunk` action precisely so that no
 * transaction becomes client state, and an `onError` fallback here would drag
 * `"use client"` into it. Instead the choice between an icon and a monogram is
 * a **pure map lookup** — no filesystem, no network, nothing async in the
 * render path. Only the browser's own request for the `<img>` touches the
 * cache, and that happens after the row is already on screen.
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

  if (domain) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- see the note above */
      <img
        src={`/api/merchant-icon/${merchantSlug(name)}`}
        /* Empty alt, not the merchant name: it sits one element away, so a
           labelled image is a duplicate announcement. It also means a failed
           load collapses to nothing rather than showing a broken-image glyph. */
        alt=""
        aria-hidden
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        className={cn(
          box,
          /* `bg-logo-tile`, not `bg-surface`: a merchant mark is drawn for a
             white ground, and a black-glyph favicon (Apple, Nike) would vanish
             on the dark theme's #1c1c1c. The ring is what separates the white
             tile from the page behind it. */
          "shrink-0 bg-logo-tile object-contain p-0.5 ring-1 ring-line",
          className,
        )}
      />
    );
  }

  const Glyph = ABSTRACT_GLYPHS[name];

  return (
    <span
      aria-hidden
      className={cn(
        box,
        text,
        "inline-flex shrink-0 items-center justify-center font-semibold",
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
    </span>
  );
}
