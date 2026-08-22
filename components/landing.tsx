import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Lock,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { LandingDragon } from "@/components/landing-dragon";
import { Link } from "@/i18n/navigation";

const FAQ_KEYS = ["faq1", "faq2", "faq3", "faq4", "faq5", "faq6"] as const;

export function Landing() {
  const t = useTranslations("Landing");

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

          {/* Quick trust highlights */}
          <div className="mt-10 flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-text-subtle font-medium">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-accent" />
              <span>{t('trust1')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MessageSquare className="size-4 text-accent" />
              <span>{t('trust2')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-4 text-accent" />
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
        <div className="mx-auto mt-12 w-full max-w-3xl px-5 sm:px-8">
          <LandingDragon />
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
            <div className="w-full sm:w-auto shrink-0 flex flex-col gap-3 min-w-[260px]">
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
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          3. FAQ
         ───────────────────────────────────────────────────────────── */}
      <section className="w-full py-16 sm:py-24 bg-surface">
        <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-subtle mb-2">
            {t("faqEyebrow")}
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text mb-10">
            {t("faqTitle")}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            {FAQ_KEYS.map((key) => (
              <div
                key={key}
                className="rounded-xl border border-line/80 bg-surface-hover/50 p-6"
              >
                <h3 className="text-sm font-semibold text-text">
                  {t(`${key}Question`)}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-text-muted">
                  {t(`${key}Answer`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
