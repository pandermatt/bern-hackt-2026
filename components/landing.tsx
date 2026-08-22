import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Database,
  Lock,
  MessageSquare,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { LandingPreview } from "@/components/landing-preview";
import { TABS } from "@/components/nav-tabs";
import { Link } from "@/i18n/navigation";

/** The numbers and icons are fixed; the words come from the `Landing`
 *  namespace, keyed by step. The three steps are the route a new account
 *  actually takes — register, put statements in it from `/account`, then read
 *  them. There is no file upload anywhere in the app, so nothing here offers
 *  one. */
const STEPS = [
  { number: "01", key: "step1", icon: UserPlus },
  { number: "02", key: "step2", icon: Database },
  { number: "03", key: "step3", icon: BarChart3 },
] as const;

/**
 * One card per tab, in the order the nav puts them, wearing the nav's own
 * icons — `components/nav-tabs.ts` is the single list, so a fifth page added
 * there shows up here too rather than being quietly left off the pitch.
 */
const FEATURES = TABS.map((tab) => ({ key: tab.key, icon: tab.icon }));

const FAQ_KEYS = ["faq1", "faq2", "faq3", "faq4", "faq5", "faq6"] as const;

/** "home" → "Home", so one array drives both the icon and its message keys. */
function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

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
              <span>{t('signInVault')}</span>
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
            2. INTERACTIVE DASHBOARD PREVIEW

            The app's own charts, on invented figures — see
            `components/landing-preview.tsx`. It is the one client component on
            this page.
           ───────────────────────────────────────────────────────────── */}
        <div className="mx-auto mt-12 w-full max-w-5xl px-5 sm:px-8">
          <LandingPreview />
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          3. WHAT'S INSIDE — one card per tab, from the nav's own list
         ───────────────────────────────────────────────────────────── */}
      <section className="w-full py-16 sm:py-24 bg-surface border-b border-line/60">
        <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-subtle mb-2">
            {t("featuresEyebrow")}
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
            {t("featuresTitle")}
          </h2>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              const name = capitalize(feature.key);
              return (
                <div
                  key={feature.key}
                  className="rounded-2xl border border-line/80 bg-surface p-6 sm:p-7 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:border-line-strong hover:shadow-md"
                >
                  <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-surface-muted text-text">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="text-base font-semibold text-text">
                    {t(`feature${name}Title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-muted">
                    {t(`feature${name}Body`)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          4. HOW IT WORKS
         ───────────────────────────────────────────────────────────── */}
      <section className="w-full py-16 sm:py-24 border-b border-line/60">
        <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-subtle mb-2">
            {t("stepsEyebrow")}
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
            {t("stepsTitle")}
          </h2>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.number}
                  className="group relative rounded-2xl border border-line/80 bg-surface p-6 sm:p-7 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:border-line-strong hover:shadow-md"
                >
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-surface-muted text-text group-hover:bg-brand group-hover:text-[#1a1a1a] transition-colors">
                      <Icon className="size-5" />
                    </div>
                    <span className="font-mono text-xs font-bold text-text-subtle">
                      {step.number}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-text">
                    {t(`${step.key}Title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-muted">
                    {t(`${step.key}Description`)}
                  </p>
                </div>
              );
            })}
          </div>

          {/* The one claim the steps cannot make on their own: your own
              statements are not importable yet, and saying so here is cheaper
              than a disappointed sign-up. */}
          <div className="mt-8 flex items-start gap-2.5 rounded-xl border border-line/80 bg-surface-hover/50 p-5">
            <ScanSearch className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <p className="text-[13px] leading-relaxed text-text-muted">
              {t("stepsNote")}
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          5. FULL-WIDTH POSTFINANCE YELLOW CONTAINER WITH CALL TO ACTION
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
              {/* Badge */}
              <div className="inline-flex items-center gap-1.5 rounded-full bg-text/10 px-3.5 py-1 text-xs font-semibold text-text mb-5">
                <Sparkles className="size-3.5" />
                <span className="uppercase tracking-[0.1em] text-[11px]">
                  {t("ctaBadge")}
                </span>
              </div>

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
          6. FAQ
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
