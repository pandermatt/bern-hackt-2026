"use client";

import { Children, useId, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * What the dragon has to say, as a deck that fans out into a list.
 *
 * Collapsed — which is what the server renders, and what a reader with no
 * JavaScript keeps — the top nudge is fully readable and the rest of the deck
 * shows as two edges behind it. "Show all" unfolds them into exactly the list
 * this used to be. The cap of three in `rankNudges` is what makes the deck
 * legible: a deck of eight is a pile, and an entry page is not an inbox.
 *
 * **It owns the speaker as well as the bubble**, and that is not tidiness: the
 * trail of nubs has to be aimed at the dragon's head from the bubble's own
 * geometry, so one component has to hold the open/closed state, the cards and
 * the mascot. The mascot is centred under the deck and the trail runs down
 * onto its head, which is what lets the toggle sit below it — the channel is
 * above the dragon now, not beside it.
 *
 * **The cards arrive as `children`, deliberately.** `NudgeCard` is a
 * synchronous *server* component and it stays one — it reaches for
 * `components/anomaly-icon.tsx`, which names 29 lucide glyphs, plus
 * `formatMoney`. Rendering it from here would drag all of that across the
 * boundary to animate a height. What ships to the browser is this file: two
 * transitions and a toggle.
 *
 * With nothing to report the page passes the all-clear line as the only child,
 * so a quiet day is the same arrangement saying one short thing rather than a
 * second layout to keep in step with this one.
 */
export function NudgeStack({
  label,
  speaker,
  children,
}: {
  label: string;
  /** The mascot, already sized. Rendered against the trail, not beside it. */
  speaker: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("Home");
  const [expanded, setExpanded] = useState(false);

  const cards = Children.toArray(children);
  const listId = useId();
  const stacked = cards.length > 1;
  const collapsed = stacked && !expanded;

  return (
    <section aria-label={label}>
      <div id={listId}>
        {/* The padding is the clearance the back-edges below stick out into.
            It transitions with them, so the deck closes up as they fade. */}
        <div
          className={`transition-[padding-bottom] duration-300 ease-out ${
            collapsed ? "pb-3.5" : "pb-0"
          }`}
        >
          {/* The front card, plus the deck's depth behind it.
              That depth is decoration rather than the real cards moved back: a
              card behind the front one would have to hold a small fixed height
              while collapsed, and `grid-template-rows: 10px` cannot interpolate
              to `1fr` — a length and a flex fraction are different types, so
              the unfold would snap rather than animate. The hidden cards go to
              a true `0fr` instead and these two strips stand in for their
              edges, fading as the real ones unfold.

              Ordinary `z-0`/`z-10`, never a negative z-index: `main` paints the
              pistachio gradient, and anything behind the local stacking order
              would be behind that too. */}
          <div className="relative">
            {stacked && (
              <div aria-hidden className="pointer-events-none">
                {cards.length > 2 && (
                  <div
                    className={`absolute inset-x-4 inset-y-0 z-0 rounded-lg border border-line bg-surface transition-all duration-300 ease-out ${
                      collapsed
                        ? "translate-y-[13px] opacity-100"
                        : "translate-y-0 opacity-0"
                    }`}
                  />
                )}
                <div
                  className={`absolute inset-x-2 inset-y-0 z-0 rounded-lg border border-line bg-surface transition-all duration-300 ease-out ${
                    collapsed
                      ? "translate-y-[7px] opacity-100"
                      : "translate-y-0 opacity-0"
                  }`}
                />
              </div>
            )}
            {/* The front card never folds — the deck always says one thing. */}
            <div className="relative z-10">{cards[0]}</div>
          </div>
        </div>

        {cards.slice(1).map((card, index) => (
          <div
            key={index}
            /* `0fr → 1fr` is the whole trick: it interpolates natively, so a
               card of unknown height animates open with no measuring and no
               ResizeObserver. The inner `overflow-hidden` is required — the
               grid row is what shrinks, and content does not clip itself. */
            className="grid transition-[grid-template-rows,margin-top] duration-300 ease-out"
            style={{
              gridTemplateRows: collapsed ? "0fr" : "1fr",
              marginTop: collapsed ? 0 : 8,
            }}
            /* Clipped to nothing is not the same as gone: without this the link
               inside a folded card keeps its place in the tab order and in the
               accessibility tree. */
            inert={collapsed}
          >
            <div className="overflow-hidden">{card}</div>
          </div>
        ))}
      </div>

      {/* The mascot, centred under what it is saying, in a box it actually
          fits. It used to sit `absolute` inside a fixed 112×144 slot while
          being 160px wide — 240px from `lg` — so it overflowed upwards across
          its own trail and sideways into the toggle beside it, and the two
          sizes were only ever reconciled by hand at the phone breakpoint. Now
          the image sizes its own wrapper and everything else is positioned off
          that, so one arrangement holds at both sizes. */}
      <div className="mt-4 flex flex-col items-center lg:mt-8">
        <div className="relative">
          {/* Aimed at the head, which sits left of the asset's centre — between
              34% and 43% across the four moods — and under a mane that leaves
              the top tenth of the frame transparent, which is what the nubs
              rise into. Percentages of this wrapper, which is the image's own
              width, so the trail stays aimed when the image steps up at `lg`;
              the absolute px it used to carry were tuned at the phone size and
              pointed at empty air on a desk. The nubs shrink towards the
              speaker, which is what makes the trail read downwards. Still
              circles rather than a triangular tail: a tail would have the
              card's own 1px bottom border drawn straight across its neck, and
              circles do not care that the bubble changes height when it
              unfolds. */}
          <span aria-hidden>
            <span className="absolute -top-[7%] left-[33%] size-3 rounded-full border border-line bg-surface" />
            <span className="absolute top-[1%] left-[39%] size-2 rounded-full border border-line bg-surface" />
          </span>
          {speaker}
        </div>

        {stacked && (
          /* A pill, like the all-clear line, and for the same reason: this sits
             over the pistachio, and Pistachio is a fill — 2:1 on white — never
             a ground for type. It can sit under the deck now that the trail
             runs down the centre onto the dragon's head rather than up to the
             bubble's corner, so nothing is parked in the channel. Below the
             mascot rather than beside it because a centred mascot leaves under
             90px either side at `lg`, which the German string does not fit. */
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-controls={listId}
            className="mt-2 cursor-pointer rounded-full bg-surface/85 px-3 py-1 text-[12.5px] text-text-muted backdrop-blur-sm transition-colors hover:text-text"
          >
            {expanded ? t("showLess") : t("showAll", { count: cards.length })}
          </button>
        )}
      </div>
    </section>
  );
}
