import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Lock,
  MessageSquare,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { DemoAsleepNotice } from "@/components/demo-asleep-notice";
import { LandingDragon } from "@/components/landing-dragon";
import { Link } from "@/i18n/navigation";
import { DRAGON_SRC, type DragonMood } from "@/lib/nudges";

/**
 * The questions, and the face Batzi answers each one with.
 *
 * Four, down from six: "how are transactions categorized" and "why is the scan
 * a button" were answers about the app's internals, and this section is the
 * last thing between a visitor and the sign-up button — what belongs here is
 * what they are actually deciding about. The four that stayed were all
 * rewritten; the old first answer still claimed importing your own export was
 * not built, which stopped being true when `/account` grew the CSV uploader.
 *
 * The moods are chosen, not decorative. Shaking his head at the e-banking
 * question and waving goodbye at the delete one is the answer said twice — and
 * a picture is read before a paragraph is.
 */
const FAQS = [
  // First, because it is the thing here nobody else does — the rest of the list
  // is what a visitor needs reassuring about, and this is what they came for.
  { key: "faqAnomaly", mood: "detective" },
  { key: "faqBank", mood: "no" },
  { key: "faqData", mood: "reading" },
  { key: "faqBatzi", mood: "zoom" },
  { key: "faqDelete", mood: "bye" },
] as const satisfies readonly { key: string; mood: DragonMood }[];

/**
 * `asleep` is the copy served from the edge while the demo server does not
 * exist — see `lib/demo-asleep.ts`. It swaps both call-to-action pairs for
 * `DemoAsleepNotice` and changes nothing else: the product story, the preview
 * and the FAQ are all true whether or not there is a box to sign in to, and
 * this page's job on the other 89 days is to tell it.
 */
export function Landing({ asleep = false }: { asleep?: boolean }) {
  const t = useTranslations("Landing");
  // The alt lines live in their own namespace — see `Dragon` in the catalogs.
  const tDragon = useTranslations("Dragon");

  return (
    <div className="w-full flex-1 flex flex-col bg-bg text-text selection:bg-brand/30 selection:text-text">
      {/* ─────────────────────────────────────────────────────────────
          1. HERO
         ───────────────────────────────────────────────────────────── */}
      <section className="relative w-full pt-12 pb-16 sm:pt-20 sm:pb-24 overflow-hidden border-b border-line/60">
        <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
          <h1 className="max-w-[20ch] text-[38px] leading-[1.08] font-bold tracking-tight text-text sm:text-[54px] lg:text-[62px]">
            {t('heroTitle1')}{" "}
            <span className="underline decoration-brand decoration-wavy decoration-from-font underline-offset-6">
              {t('heroTitle2')}
            </span>
          </h1>

          <p className="mt-6 max-w-[56ch] text-[17px] sm:text-[19px] leading-relaxed text-text-muted">
            {t('heroSubtitle')}
          </p>

          {asleep ? (
            <DemoAsleepNotice className="mt-8 max-w-md" />
          ) : (
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <Link
                href="/register"
                className="inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-text px-6 text-[15px] font-semibold text-bg transition-all duration-200 hover:bg-text/85 hover:shadow-lg active:scale-95"
              >
                <span>{t('getStartedFree')}</span>
                <ArrowRight className="size-4.5" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface px-6 text-[15px] font-semibold text-text transition-all duration-200 hover:bg-surface-hover hover:border-line-strong active:scale-95"
              >
                <span>{t('signIn')}</span>
                <ChevronRight className="size-4 text-text-subtle" />
              </Link>
            </div>
          )}

          {/* Quick trust highlights */}
          <div className="mt-10 flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-text-subtle font-medium">
            <div className="flex items-center gap-1.5">
              {/* `TriangleAlert`, the same glyph `/anomalies` wears in the nav
                  — the highlight names that feature, so it should be findable
                  by its picture once someone is inside. */}
              <TriangleAlert className="size-4 text-accent" />
              <span>{t('trust1')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MessageSquare className="size-4 text-accent" />
              <span>{t('trust2')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* `Bell`, the glyph `components/push-notifications.tsx` uses on
                  the control this line is about. */}
              <Bell className="size-4 text-accent" />
              <span>{t('trust3')}</span>
            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            2. THE DRAGON, WAITING TO BE ASKED

            This slot used to hold a mock dashboard: four ECharts views on
            invented figures. It advertised the charts, which are the least
            distinctive thing here — every finance app has a donut. The mascot
            and the assistant are what nobody else has, so they take the hero
            and the figures wait until they have an account to be about.
           ───────────────────────────────────────────────────────────── */}
        {/* This slot is a sibling of the hero's `max-w-5xl px-5 sm:px-8`
            column, not a child of it, so it inherits the `w-full` section.
            `LandingDragon` does the rest itself: the same `max-w-5xl` column
            and the same gutter, so its card lines up with the headline above
            it, plus its own inner measure for the conversation. Nothing to
            add out here. */}
        <div className="mt-20 sm:mt-28">
          <LandingDragon asleep={asleep} />
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          2. FULL-WIDTH POSTFINANCE YELLOW CONTAINER WITH CALL TO ACTION
         ───────────────────────────────────────────────────────────── */}
      <section className="on-brand relative w-full bg-brand text-text py-20 sm:py-28 overflow-hidden border-y border-brand">
        {/* Subtle geometric background watermark */}
        <div
          className="pointer-events-none absolute -right-16 -top-24 size-96 rounded-full bg-surface/20 blur-2xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -left-16 -bottom-24 size-96 rounded-full bg-brand/30 blur-2xl"
          aria-hidden="true"
        />

        <div className="relative mx-auto w-full max-w-5xl px-5 sm:px-8 text-center sm:text-left">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-10">
            <div className="max-w-2xl">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-text leading-[1.12]">
                {t("ctaTitle")}
              </h2>

              <p className="mt-4 text-base sm:text-lg text-text leading-relaxed max-w-xl font-normal">
                {t("ctaBody")}
              </p>

              {/* Trust Checkmarks */}
              <div className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-y-2 gap-x-5 text-xs font-semibold text-text">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4" />
                  <span>{t("ctaCheck1")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="size-4" />
                  <span>{t("ctaCheck2")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Lock className="size-4" />
                  <span>{t("ctaCheck3")}</span>
                </div>
              </div>
            </div>

            {/* Action Card Container */}
            <div className="w-full sm:w-auto shrink-0 flex flex-col gap-3 min-w-[260px] max-w-sm">
              {asleep ? (
                <DemoAsleepNotice />
              ) : (
                <>
                  <Link
                    href="/register"
                    className="inline-flex h-13 w-full items-center justify-center gap-2.5 rounded-full bg-text px-8 text-[15px] font-bold text-bg shadow-xl transition-all duration-200 hover:bg-text/85 hover:scale-[1.02] active:scale-95"
                  >
                    <span>{t("ctaPrimary")}</span>
                    <ArrowRight className="size-4.5" />
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-text bg-transparent px-6 text-[14px] font-bold text-text transition-all duration-200 hover:bg-text/10 active:scale-95"
                  >
                    <span>{t("ctaSecondary")}</span>
                  </Link>
                  <p className="text-center font-mono text-[11px] text-text mt-1">
                    {t("ctaNote")}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          3. FAQ
         ───────────────────────────────────────────────────────────── */}
      <section className="w-full py-16 sm:py-24 bg-surface">
        <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
          {/* No eyebrow over this one. "Frequently Asked Questions" is already
              the most self-explanatory heading on the page, and a kicker above
              it can only restate it. */}
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text mb-10">
            {t("faqTitle")}
          </h2>

          {/* One column, not the two-across grid this was. Each entry is now an
              exchange rather than a card of prose — the question asked, then
              Batzi answering it — and an exchange squeezed into a half-width
              card puts the mascot beside four words and the answer under it.

              It runs the full `max-w-5xl` the section is already bounded by,
              rather than a narrower reading column inside it, so the exchanges
              line up with the heading above them and with every other section
              on the page.

              The arrangement is the app's own, from `components/dragon-buddy.tsx`:
              the words lead and the speaker follows, so the reader gets the
              sentence first and the picture as the thing that said it. The
              bubble keeps its own `bg-surface` because this section's ground is
              `bg-surface` too — that is why it is the one place here that fills
              with `--bg` instead, the reverse of the usual pairing. */}
          <div className="flex flex-col gap-8">
            {FAQS.map(({ key, mood }) => (
              <div key={key}>
                <h3 className="text-[15px] font-semibold text-text sm:text-base">
                  {t(`${key}Question`)}
                </h3>

                {/* `items-end`, not centred. These answers are paragraphs, not
                    the one-liners `DragonBuddy` carries, and on a phone the
                    German ones run seven lines — a centred speaker ends up
                    alongside the middle of its own paragraph. Sitting it on the
                    baseline also puts the trail level with `rounded-br-sm`,
                    which is the corner standing in for the tail. */}
                <div className="mt-3 flex items-end gap-1.5 sm:gap-3">
                  <p className="min-w-0 flex-1 rounded-2xl rounded-br-sm border border-line/80 bg-bg px-4 py-3 text-[13px] leading-relaxed text-text-muted sm:text-sm">
                    {t(`${key}Answer`)}
                  </p>

                  {/* The trail across to the speaker, shrinking as it goes —
                      anchored to its own slot rather than to the mascot's head,
                      for the reason `DragonBuddy` gives: the head sits in a
                      different place in every pose. */}
                  <span aria-hidden className="mb-3 flex shrink-0 items-center gap-1">
                    {/* The far nub goes below `sm`. The mascot and the trail
                        together cost ~100px of a 375px screen, and every pixel
                        of that comes out of the text column. */}
                    <span className="hidden size-2.5 rounded-full border border-line bg-bg sm:block" />
                    <span className="size-1.5 rounded-full border border-line bg-bg" />
                  </span>

                  {/* A plain `<img>`, like `merchant-avatar.tsx` and every other
                      mascot in the app: a small same-origin asset already at its
                      final size. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={DRAGON_SRC[mood]}
                    alt={tDragon(mood)}
                    width={512}
                    height={512}
                    className="h-12 w-12 shrink-0 drop-shadow-sm sm:h-20 sm:w-20"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
