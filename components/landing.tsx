import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Lock,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UploadCloud,
  Wallet,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/** The numbers and icons are fixed; the words come from the `Landing`
 *  namespace, keyed by step. */
const STEPS = [
  { number: "01", key: "step1", icon: Download },
  { number: "02", key: "step2", icon: UploadCloud },
  { number: "03", key: "step3", icon: BarChart3 },
] as const;

const MOCK_CATEGORIES = [
  { key: "mockCategory1", pct: 38, color: "bg-[var(--chart-1)]" },
  { key: "mockCategory2", pct: 24, color: "bg-[var(--chart-2)]" },
  { key: "mockCategory3", pct: 14, color: "bg-[var(--chart-3)]" },
  { key: "mockCategory4", pct: 12, color: "bg-[var(--chart-4)]" },
  { key: "mockCategory5", pct: 8, color: "bg-[var(--chart-5)]" },
  { key: "mockCategory6", pct: 4, color: "bg-[var(--chart-other)]" },
] as const;

const MOCK_TRANSACTIONS = [
  {
    titleKey: "mockTransaction1",
    accountKey: "mockAccount1",
    dateKey: "mockToday",
    amount: "− CHF 86.40",
    inflow: false,
  },
  {
    titleKey: "mockTransaction2",
    accountKey: "mockAccount2",
    dateKey: "mockYesterday",
    amount: "+ CHF 6’850.00",
    inflow: true,
  },
  {
    titleKey: "mockTransaction3",
    accountKey: "mockAccount3",
    date: "18.08.",
    amount: "− CHF 42.00",
    inflow: false,
  },
  {
    titleKey: "mockTransaction4",
    accountKey: "mockAccount1",
    date: "15.08.",
    amount: "− CHF 79.90",
    inflow: false,
  },
] as const;

const FAQ_KEYS = ["faq1", "faq2", "faq3", "faq4"] as const;

export function Landing() {
  const t = useTranslations("Landing");

  return (
    <div className="w-full flex-1 flex flex-col bg-bg text-text selection:bg-brand/30 selection:text-text">
      {/* ─────────────────────────────────────────────────────────────
          1. HERO SECTION (Clean White, pandermatt.ch Typographic Style)
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
              <Zap className="size-4 text-brand fill-brand" />
              <span>{t('trust2')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <FileSpreadsheet className="size-4 text-positive" />
              <span>{t('trust3')}</span>
            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            2. INTERACTIVE DASHBOARD PREVIEW (Refined pandermatt card aesthetic)
           ───────────────────────────────────────────────────────────── */}
        <div className="mx-auto mt-12 w-full max-w-5xl px-5 sm:px-8">
          <div className="rounded-2xl border border-line/90 bg-surface-hover/70 p-4 sm:p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xs">
            {/* Mock Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/80 pb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex size-3 rounded-full bg-danger/80" />
                <span className="flex size-3 rounded-full bg-brand/80" />
                <span className="flex size-3 rounded-full bg-positive/80" />
                <span className="ml-2 text-xs font-mono font-medium text-text-subtle">
                  {t("previewFile")}
                </span>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-text-muted shadow-2xs border border-line/60">
                <Wallet className="size-3.5 text-accent" />
                <span>{t("previewCurrency")}</span>
              </div>
            </div>

            {/* Stat Cards Row */}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line/80 bg-surface p-4.5 shadow-2xs">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-text-subtle">
                  {t("previewInflow")}
                </span>
                <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-positive-hover">
                  + CHF 68,450.00
                </p>
                <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-text-subtle">
                  {t.rich("previewInflowNote", {
                    deposits: (chunks) => (
                      <span className="text-positive font-semibold">{chunks}</span>
                    ),
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-line/80 bg-surface p-4.5 shadow-2xs">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-text-subtle">
                  {t("previewSpending")}
                </span>
                <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-text">
                  - CHF 42,120.80
                </p>
                <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-text-subtle">
                  <span>{t("previewSpendingNote")}</span>
                </div>
              </div>

              <div className="rounded-xl border border-line/80 bg-surface p-4.5 shadow-2xs">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-text-subtle">
                  {t("previewSavings")}
                </span>
                <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-accent">
                  + CHF 26,329.20
                </p>
                <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-accent">
                  <TrendingUp className="size-3.5" />
                  <span>{t("previewSavingsNote")}</span>
                </div>
              </div>
            </div>

            {/* Split Visual: Breakdown & Recent Rows */}
            <div className="mt-4 grid gap-4 lg:grid-cols-12">
              {/* Category distribution */}
              <div className="rounded-xl border border-line/80 bg-surface p-5 shadow-2xs lg:col-span-7">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-text-subtle">
                    {t("previewDistribution")}
                  </h2>
                  <span className="text-xs font-medium text-text-subtle">
                    {t("previewTopCategories")}
                  </span>
                </div>

                {/* Stacked bar preview */}
                <div className="mt-3.5 flex h-3.5 w-full overflow-hidden rounded-full bg-surface-muted p-0.5">
                  {MOCK_CATEGORIES.map((cat) => (
                    <div
                      key={cat.key}
                      style={{ width: `${cat.pct}%` }}
                      className={`h-full first:rounded-l-full last:rounded-r-full ${cat.color}`}
                      title={`${t(cat.key)}: ${cat.pct}%`}
                    />
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  {MOCK_CATEGORIES.slice(0, 4).map((cat) => (
                    <div
                      key={cat.key}
                      className="flex items-center justify-between rounded-lg bg-surface-hover px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className={`size-2.5 rounded-full shrink-0 ${cat.color}`} />
                        <span className="truncate font-medium text-text-muted">
                          {t(cat.key)}
                        </span>
                      </div>
                      <span className="font-mono text-text-subtle ml-2">{cat.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sample transactions list */}
              <div className="rounded-xl border border-line/80 bg-surface p-5 shadow-2xs lg:col-span-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-text-subtle">
                    {t("previewActivity")}
                  </h2>
                  <span className="text-xs font-semibold text-accent">
                    {t("previewVerified")}
                  </span>
                </div>
                <div className="space-y-2">
                  {MOCK_TRANSACTIONS.map((tx) => (
                    <div
                      key={tx.titleKey}
                      className="flex items-center justify-between rounded-lg border border-line/60 bg-surface-hover/60 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="font-medium text-text truncate">{t(tx.titleKey)}</p>
                        <p className="text-[11px] text-text-subtle truncate">
                          {"dateKey" in tx ? t(tx.dateKey) : tx.date} · {t(tx.accountKey)}
                        </p>
                      </div>
                      {/* The same pair the real ledger uses. These were a
                          hardcoded olive and `text-neutral-900` — the latter is
                          near-black on the dark theme's `--surface-hover`, so
                          the preview's outflows were invisible there. */}
                      <span
                        className={`font-mono font-semibold shrink-0 ${
                          tx.inflow ? "text-positive" : "text-text"
                        }`}
                      >
                        {tx.amount}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          3. HOW IT WORKS (3-Step Flow in pandermatt.ch Clean Style)
         ───────────────────────────────────────────────────────────── */}
      <section className="w-full py-16 sm:py-24 bg-surface border-b border-line/60">
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
          6. ACCORDION / FAQ & COMPATIBILITY DETAILS (pandermatt.ch Style)
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
