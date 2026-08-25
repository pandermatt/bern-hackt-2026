import { Trophy } from "lucide-react";
import { useTranslations } from "next-intl";

import { DRAGON_SRC } from "@/lib/nudges";
import { site } from "@/lib/site";

/**
 * What happened at the hackathon, said before anything else.
 *
 * The only place this app mentioned BärnHäckt was `PrototypeNotice`, on the
 * two auth pages, where it reads as a disclaimer — "this is a hackathon build,
 * don't point it at real banking data". That sentence is still true and still
 * belongs there. It is not the same sentence as this one.
 *
 * It sits **above** the hero rather than after it. A first-place jury prize is
 * the strongest thing a visitor can be told about a prototype from a domain
 * they have never heard of, and it is worth nothing three screens down. It was
 * tried below the headline and read as a footnote: this band is the loudest
 * thing on the page, and half a screen down it wastes both the colour and the
 * claim.
 *
 * The band is `on-brand bg-brand` — the same Supernova and the same fixed-ink
 * trick as the CTA band lower on the page, so the two read as one material
 * rather than as two yellows. It is also, not incidentally, the colour of the
 * cheque in the photograph.
 */

/**
 * The two credits.
 *
 * Ink and an underline, **not** `text-accent`. `.on-brand` re-points `--text`,
 * `--bg`, `--surface` and `--line`, but deliberately not `--accent` — and in
 * the dark theme `--accent` is `#4cc3cc`, which on Supernova is under 2:1. The
 * band's own fixed `#1a1a1a` is 11:1 in both themes, so the hover moves the
 * decoration rather than the colour: there is nowhere lighter for the ink to
 * go that is still readable on yellow.
 */
const BAND_LINK =
  "font-semibold text-text underline decoration-text/40 underline-offset-4 transition-colors hover:decoration-text";

export function VictoryBanner() {
  const t = useTranslations("Landing");
  // The mascot's alt lines live in their own namespace, like every other
  // dragon in the app — see `Dragon` in the catalogs.
  const tDragon = useTranslations("Dragon");

  return (
    <section className="on-brand relative w-full overflow-hidden border-b border-brand bg-brand py-10 sm:py-14">
      {/* The CTA band's own watermarks, so the two yellows are the same
          surface seen twice rather than two different treatments. */}
      <div
        className="pointer-events-none absolute -right-16 -top-24 size-96 rounded-full bg-surface/20 blur-2xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-16 -bottom-24 size-96 rounded-full bg-brand/30 blur-2xl"
        aria-hidden="true"
      />

      {/* The page's `max-w-5xl px-5 sm:px-8` column, like every other section.
          Centred until `lg`, where the copy gets a photo beside it and a
          centred paragraph next to a left-aligned edge stops lining up. */}
      <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-8 px-5 text-center sm:px-8 lg:flex-row lg:gap-12 lg:text-left">
        <div className="max-w-2xl lg:flex-1">
          {/* `bg-text text-bg` — ink and its inverse, both anchored by
              `.on-brand`, which is the pair the CTA band's filled pill uses
              for the same reason: a chip on a fixed ground needs fixed ink. */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-text px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-bg">
            <Trophy className="size-3.5" aria-hidden />
            {t("winEyebrow")}
          </span>

          {/* An `h2` before the hero's `h1`. That is a decrease in level, not
              a skipped one, so the outline stays well-formed — and the hero
              remains the page's heading, which it should. */}
          <h2 className="mt-4 text-3xl font-extrabold leading-[1.12] tracking-tight text-text sm:text-4xl">
            {t("winTitle")}
          </h2>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-text sm:text-lg">
            {/* One sentence per locale with the links inside it, rather than
                fragments spliced around them — the same `t.rich` idiom as
                `components/prototype-notice.tsx`. A tag with no handler here
                *throws*, which is what `tests/landing-copy.test.ts` pins. */}
            {t.rich("winBody", {
              bernhackt: (chunks) => (
                <a
                  href={site.hackathon.url}
                  target="_blank"
                  rel="noreferrer"
                  className={BAND_LINK}
                >
                  {chunks}
                </a>
              ),
              postfinance: (chunks) => (
                <a
                  href={site.sponsor.url}
                  target="_blank"
                  rel="noreferrer"
                  className={BAND_LINK}
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>

        {/* The photograph, and Batzi celebrating off its corner. `relative`
            because he is positioned against the picture, not against the
            band — the band is full-bleed and he would end up in the gutter. */}
        <div className="relative w-full shrink-0 sm:max-w-lg lg:w-[44%] lg:max-w-none">
          {/* A plain `<img>`, like every image in this app: a same-origin
              asset already at its final size, and `next/image` would add a
              `/_next/image` round trip and this repo's first `images` config
              for nothing. The intrinsic size is the file's own, so the box is
              reserved before the bytes land and the band does not jump. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/team.webp"
            alt={t("winPhotoAlt")}
            width={1400}
            height={933}
            className="w-full rounded-2xl shadow-lg ring-1 ring-text/15"
          />

          {/* He overhangs the corner by less than the section's own `py-10`,
              so `overflow-hidden` on the band never clips him — and the
              overhang grows with him, or a bigger dragon just covers more of
              the photograph instead of leaning out of it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={DRAGON_SRC.celebrate}
            alt={tDragon("celebrate")}
            width={512}
            height={512}
            className="pointer-events-none absolute -bottom-4 -left-4 h-20 w-20 drop-shadow-md sm:-bottom-6 sm:-left-6 sm:h-28 sm:w-28 lg:-bottom-8 lg:-left-12 lg:h-44 lg:w-44"
          />
        </div>
      </div>
    </section>
  );
}
