"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";
import { DRAGON_SRC, type DragonMood } from "@/lib/nudges";

/**
 * The landing page's centrepiece: the dragon, waiting to be asked something.
 *
 * This replaced a mock dashboard — four ECharts views on invented figures.
 * That advertised the *charts*, which are the least distinctive thing here:
 * every finance app has a donut. What none of them has is a mascot that reads
 * your statements and tells you what it found, so the hero now shows the thing
 * a visitor actually cannot get anywhere else, and the numbers wait until they
 * have an account to be about.
 *
 * The conversation is canned and says so — three questions, three answers, no
 * server. The real assistant needs a session and its own transcript
 * (`components/chat-panel.tsx`); this is the trailer, and the note under the
 * CTA keeps the difference honest rather than implying the landing page is
 * reading anything.
 *
 * The arrangement is the entry page's own: bubble on top, mascot below it,
 * with the trail of nubs running down onto its head — see
 * `components/nudge-stack.tsx`, which owns the same idiom for the same reason.
 * Rebuilt rather than reused: that component is a deck of ranked nudges with a
 * show-all toggle, and none of that has a meaning here.
 */

/** One canned exchange. The mood is the dragon's face while the answer shows. */
const TURNS = [
  { key: "ask1", mood: "coin" },
  // "Did anything odd happen?" — the detective, the same face `/anomalies`
  // wears for a finding worth acting on. `thinking` was the placeholder from
  // when there were only four poses to choose between.
  { key: "ask2", mood: "detective" },
  { key: "ask3", mood: "celebrate" },
] as const satisfies readonly { key: string; mood: DragonMood }[];

/** Long enough to read as an answer being written, short enough not to stall. */
const THINKING_MS = 700;

export function LandingDragon() {
  const t = useTranslations("Landing");
  const tDragon = useTranslations("Dragon");

  /** Which canned exchange is on screen, or null before the first question. */
  const [turn, setTurn] = useState<(typeof TURNS)[number] | null>(null);
  const [thinking, setThinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const ask = (next: (typeof TURNS)[number]) => {
    if (timer.current) clearTimeout(timer.current);
    setTurn(next);
    setThinking(true);
    timer.current = setTimeout(() => setThinking(false), THINKING_MS);
  };

  // Thinking while it writes, then the answer's own mood, and simply happy
  // before anyone has asked anything.
  const mood: DragonMood = thinking ? "thinking" : (turn?.mood ?? "happy");

  return (
    /* The gutter lives out here, on a wrapper: the slot this sits in is
       full-bleed — a sibling of the hero's padded column, not a child of it —
       so without it the card's own edge would run flush into the viewport's on
       a phone, which is exactly the edge we just went to the trouble of
       drawing. */
    <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
      {/* The heading sits *outside* the card, and that is the point: it names
          the box the way a section heading names a section, rather than
          becoming the chat's own header row — which is what
          `components/home-chat.tsx` has, and which would make this look like a
          screenshot of the app instead of an invitation to try it.

          Set like the FAQ's heading and left-aligned like it: same size, same
          weight, same tracking, on the same `max-w-5xl` column, so the two
          section headings on this page read as one pair. `h2` because the
          hero's headline is the page's `h1`.

          The eyebrow over it is what lets the heading be two words. "Meet
          Batzi" on its own is a name with no claim attached; the kicker says
          what he *is* — a personal finance assistant, in the plain words a
          visitor would use — and the heading does the introducing. It is a
          `<p>`, not a second heading: an eyebrow is not a level of the
          outline, and screen readers should hear one heading here. */}
      <p className="text-[12px] font-semibold tracking-wide text-text-subtle uppercase">
        {t("askEyebrow")}
      </p>
      <h2 className="mt-2 mb-6 text-2xl font-bold tracking-tight text-text sm:text-3xl">
        {t("askTitle")}
      </h2>
      {/* **A box, because this is a chat window.** A transcript needs an edge
          to be a transcript; without one the bubbles were just paragraphs
          floating in the page, and the mascot stood next to the conversation
          rather than inside it.

          The colours are the ones a visitor meets the moment they sign up:
          `/home`'s pistachio, running bottom-up, from
          `app/[locale]/home/page.tsx`. It runs that direction there for the
          reason it has to run that way here — the palette rule makes pistachio
          a fill and never a ground for type (2:1 on white), so the saturated
          end belongs at the bottom, behind the dragon, where there is nothing
          to read. Everything with words on it keeps a ground of its own,
          exactly as the chat and the nudge deck do on that page.

          The one stop that differs is the first. `/home` opens on `--bg`,
          because there the gradient *is* the page and its top edge is the
          window's — nothing to see a start against. This is a box on a white
          page, so a first stop of white would leave the top third looking
          unpainted and the colour would seem to leak in from below. A tint
          from the first pixel gives the box a ground everywhere.

          No border either, for the same reason: with the fill present at the
          top edge it draws its own, and a hairline on top only fenced the box
          off from a page it is meant to sit in. The radius stays — a hero
          block gets a fuller round than a card in a dashboard column.

          `overflow-clip` stays — the dragon is what would otherwise reach past
          the bottom — and the card hugs the conversation's own column rather
          than spanning the page: a bubble stretched across the viewport stops
          reading as one. */}
      <div className="w-full overflow-clip rounded-3xl bg-linear-to-b from-pistachio/10 via-pistachio/35 to-pistachio px-5 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto flex max-w-xl flex-col">
          {/* A fixed floor under the thread, so answering does not shove the
            dragon — and the page under it — down by a paragraph's height. The
            longest answer sets it. */}
          <div
            className="flex min-h-38 flex-col justify-end gap-2.5 sm:min-h-32"
            aria-live="polite"
            aria-label={t("askThreadLabel")}
          >
            {/* Batzi's side — this greeting, the typing dots and every answer —
                is `border border-line bg-surface`, the chips' own colours. On a
                white card the chat's `--surface-muted` bubble was the right
                choice; on a pistachio ground it turns into a grey smudge, and
                the thing it has to be legible against is the fill, not the
                card. White with a hairline is what the chips already do here,
                and having one answer and three questions drawn the same way is
                what makes them read as one conversation. */}
            {turn === null ? (
              <p className="w-fit rounded-2xl rounded-bl-sm border border-line bg-surface px-4 py-2.5 text-[14px] text-text duration-500 animate-in fade-in">
                {t("askIntro")}
              </p>
            ) : (
              <>
                {/* The reader's side of it, in the accent the real transcript
                  gives a user's own message. */}
                <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-[13.5px] text-white duration-300 animate-in fade-in slide-in-from-bottom-2">
                  {t(`${turn.key}Question`)}
                </p>

                {thinking ? (
                  /* The transcript's own typing indicator, keyframes included —
                   `chat-dot` in `app/globals.css`. A `role="status"` with a
                   name, not three unexplained dots. */
                  <div
                    role="status"
                    aria-label={t("askThinking")}
                    className="flex w-fit items-center gap-1.5 rounded-2xl rounded-bl-sm border border-line bg-surface px-4 py-3 duration-300 animate-in fade-in"
                  >
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="size-2 rounded-full bg-accent"
                        style={{
                          animation: "chat-dot 1.2s ease-in-out infinite",
                          animationDelay: `${dot * 0.18}s`,
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="w-fit max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-surface px-4 py-2.5 text-[14px] leading-relaxed text-text duration-300 animate-in fade-in slide-in-from-bottom-2">
                    {t(`${turn.key}Answer`)}
                  </p>
                )}
              </>
            )}
          </div>

          {/* The questions on offer. Buttons, not links: the whole point is that
            something happens here rather than a page change. */}
          <div
            className="mt-3.5 flex flex-wrap gap-2"
            role="group"
            aria-label={t("askChipsLabel")}
          >
            {TURNS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={turn?.key === option.key}
                onClick={() => ask(option)}
                /* `CHAT_PILL`'s shape and colours from
                   `components/chat-panel.tsx`, written out rather than
                   imported: that module is the whole assistant — streaming,
                   tools, the debug log — and the landing page should not pull
                   it into its bundle for a class string. Selected wears the
                   `accent-soft` treatment the chat's own toggles wear when
                   they are on. */
                className={`max-w-full cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] font-medium shadow-2xs transition-all active:scale-95 ${
                  turn?.key === option.key
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-text hover:border-line-strong hover:bg-surface-muted"
                }`}
              >
                {t(`${option.key}Question`)}
              </button>
            ))}
          </div>

          {/* The mascot, centred under what it is saying. The two nubs are the
            trail from the bubble down onto its head — percentages of the
            image's own width, because the head sits left of centre in every
            mood and the image steps up a size at `sm`. Same construction, and
            the same reasoning, as `components/nudge-stack.tsx`. */}
          <div className="mt-5 flex flex-col items-center">
            <div className="relative">
              {/* The `z-10` goes on each nub, not on a wrapper around them: a
                positioned wrapper becomes the containing block, and these are
                placed in percentages of the *image's* width. Wrapping them cost
                them their anchor and parked both in the corner. */}
              <span aria-hidden>
                <span className="absolute -top-[7%] left-[33%] z-10 size-3 rounded-full border border-line bg-surface" />
                <span className="absolute top-[1%] left-[39%] z-10 size-2 rounded-full border border-line bg-surface" />
              </span>
              {/* A plain <img>, like `merchant-avatar.tsx`: a small asset already
                at its final size on our own origin. `next/image` would add a
                `/_next/image` round trip and this repo's first `images` config
                to save nothing. All four moods are preloaded by the browser
                only as they are used, which is why the swap is a `src` change
                rather than four stacked images. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={DRAGON_SRC[mood]}
                alt={tDragon(mood)}
                width={512}
                height={512}
                className="relative z-10 h-44 w-44 drop-shadow-sm sm:h-56 sm:w-56"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-col items-center">
            <Link
              href="/register"
              className="inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-accent px-6 text-[15px] font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:opacity-90 active:scale-95"
            >
              <span>{t("askCta")}</span>
              <ArrowRight className="size-4.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
