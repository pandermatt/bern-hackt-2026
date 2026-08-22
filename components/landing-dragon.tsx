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
  { key: "ask2", mood: "thinking" },
  { key: "ask3", mood: "celebrate" },
] as const satisfies readonly { key: string; mood: DragonMood }[];

/** Long enough to read as an answer being written, short enough not to stall. */
const THINKING_MS = 700;

export function LandingDragon() {
  const t = useTranslations("Landing");
  const tHome = useTranslations("Home");

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
    /* The entry page's ground, in a box: pistachio running bottom-up, the
       saturated end behind the dragon where there is no text to read. Pistachio
       is 2:1 on white and the palette rule is fills only, never type — so every
       bubble below carries its own `--surface`. */
    <div className="overflow-clip rounded-3xl border border-line bg-linear-to-b from-surface via-pistachio/20 to-pistachio/60 px-5 py-8 sm:px-10 sm:py-10">
      <div className="mx-auto flex max-w-xl flex-col">
        {/* A fixed floor under the thread, so answering does not shove the
            dragon — and the page under it — down by a paragraph's height. The
            longest answer sets it. */}
        <div
          className="flex min-h-38 flex-col justify-end gap-2.5 sm:min-h-32"
          aria-live="polite"
          aria-label={t("askThreadLabel")}
        >
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
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${
                turn?.key === option.key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-surface text-text hover:border-accent hover:text-accent"
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
            <span aria-hidden>
              <span className="absolute -top-[7%] left-[33%] size-3 rounded-full border border-line bg-surface" />
              <span className="absolute top-[1%] left-[39%] size-2 rounded-full border border-line bg-surface" />
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
              alt={tHome(`dragonAlt.${mood}`)}
              width={512}
              height={512}
              className="h-44 w-44 drop-shadow-sm sm:h-56 sm:w-56"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center gap-2">
          <Link
            href="/register"
            className="inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-accent px-6 text-[15px] font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:opacity-90 active:scale-95"
          >
            <span>{t("askCta")}</span>
            <ArrowRight className="size-4.5" />
          </Link>
          {/* The honesty line. Three canned answers are a trailer, and a page
              that let a visitor believe otherwise would be lying about the one
              thing the product is for. */}
          <p className="max-w-[46ch] text-center text-[12px] text-text-muted">
            {t("askNote")}
          </p>
        </div>
      </div>
    </div>
  );
}
