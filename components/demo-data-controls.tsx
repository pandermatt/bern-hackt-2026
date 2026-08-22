"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Sparkles,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Flame,
  Calendar,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

import {
  generateSyntheticTransactionsAction,
  loadDemoCsvAction,
} from "@/app/actions/demo-data";
import { Link } from "@/i18n/navigation";

const LOG_COUNT_STEPS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000] as const;

/** A filename inside a sentence, for the `csvDescription` rich-text slots. */
function Filename({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-xs bg-surface-muted px-1 py-0.5 rounded font-mono">
      {children}
    </code>
  );
}
const START_YEARS = [2021, 2022, 2023, 2024, 2025, 2026] as const;

export function DemoDataControls() {
  const t = useTranslations("DemoData");
  const router = useRouter();
  const [isFakerPending, startFakerTransition] = useTransition();
  const [isCsvPending, startCsvTransition] = useTransition();

  const [stepIndex, setStepIndex] = useState<number>(3); // 500 default
  const [startYear, setStartYear] = useState<number>(2025);
  const [yearsCount, setYearsCount] = useState<number>(1);
  const [lastActionStatus, setLastActionStatus] = useState<string | null>(null);

  const targetCount = LOG_COUNT_STEPS[stepIndex];

  const handleGenerateFaker = () => {
    startFakerTransition(async () => {
      try {
        const result = await generateSyntheticTransactionsAction({
          startYear,
          yearsCount,
          targetCount,
        });
        if (result.success) {
          toast.success(result.message);
          setLastActionStatus(result.message);
          router.refresh();
        } else {
          toast.error(result.message);
        }
      } catch {
        toast.error(t("generateError"));
      }
    });
  };

  const handleLoadCsv = () => {
    startCsvTransition(async () => {
      try {
        const result = await loadDemoCsvAction();
        if (result.success) {
          toast.success(result.message);
          setLastActionStatus(result.message);
          router.refresh();
        } else {
          toast.error(result.message);
        }
      } catch {
        toast.error(t("csvError"));
      }
    });
  };

  const isBusy = isFakerPending || isCsvPending;

  return (
    <div className="card mt-8 overflow-hidden border-line">
      <div className="border-b border-line bg-surface-muted/40 px-4 py-3 sm:px-5 flex items-center justify-between">
        <div>
          <h2 className="text-[14.5px] font-semibold text-text">
            {t("heading")}
          </h2>
          <p className="text-[12.5px] text-text-muted">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {lastActionStatus && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-accent-soft/30 px-4 py-2.5 sm:px-5 text-[13px] text-text">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-accent shrink-0" />
            <span>{lastActionStatus}</span>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline text-xs"
          >
            {t("viewDashboard")} <ArrowRight className="size-3" />
          </Link>
        </div>
      )}

      <div className="divide-y divide-line">
        {/* Synthetic Generator with Log Scale Slider & Anomalies */}
        <div className="p-4 sm:p-5 space-y-4 hover:bg-surface-muted/10 transition-colors">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-md bg-accent-soft text-accent">
                  <Sparkles className="size-4" />
                </span>
                <p className="text-[14px] font-medium text-text">
                  {t("syntheticTitle")}
                </p>
              </div>
              <p className="text-[13px] text-text-muted max-w-2xl">
                {t("syntheticDescription")}
              </p>
            </div>

            <button
              type="button"
              onClick={handleGenerateFaker}
              disabled={isBusy}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-medium text-primary-foreground shadow-sm hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 cursor-pointer transition-all shrink-0 max-sm:w-full sm:h-9 sm:self-start"
            >
              {isFakerPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>{t("generating", { count: targetCount.toLocaleString("de-CH") })}</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  <span>{t("generate", { count: targetCount.toLocaleString("de-CH") })}</span>
                </>
              )}
            </button>
          </div>

          {/* Controls: Start Year, Duration, Log Slider */}
          <div className="rounded-lg border border-line-strong/60 bg-surface-muted/20 p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Start Year Selector */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-text mb-1.5">
                  <Calendar className="size-3.5 text-text-muted" /> {t("startYear")}
                </label>
                <select
                  value={startYear}
                  onChange={(e) => setStartYear(Number(e.target.value))}
                  disabled={isBusy}
                  className="w-full h-10 rounded-md border border-line-strong bg-surface px-2.5 text-[16px] text-text focus:outline-none focus:ring-1 focus:ring-accent sm:h-8 sm:text-[13px]"
                >
                  {START_YEARS.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>

              {/* Number of Years */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-text mb-1.5">
                  <Layers className="size-3.5 text-text-muted" /> {t("duration")}
                </label>
                <select
                  value={yearsCount}
                  onChange={(e) => setYearsCount(Number(e.target.value))}
                  disabled={isBusy}
                  className="w-full h-10 rounded-md border border-line-strong bg-surface px-2.5 text-[16px] text-text focus:outline-none focus:ring-1 focus:ring-accent sm:h-8 sm:text-[13px]"
                >
                  <option value={1}>{t("year1", { range: `${startYear}` })}</option>
                  <option value={2}>{t("year2", { range: `${startYear} – ${startYear + 1}` })}</option>
                  <option value={3}>{t("year3", { range: `${startYear} – ${startYear + 2}` })}</option>
                  <option value={5}>{t("year5", { range: `${startYear} – ${startYear + 4}` })}</option>
                </select>
              </div>
            </div>

            {/* Log Scale Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text flex items-center gap-1.5">
                  <span>{t("targetCount")}</span>
                  <span className="font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded text-xs">
                    {t("transactionsBadge", { count: targetCount.toLocaleString("de-CH") })}
                  </span>
                </label>
                <span className="text-[11px] text-text-muted">
                  {t("step", { step: stepIndex + 1, total: LOG_COUNT_STEPS.length })}
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={LOG_COUNT_STEPS.length - 1}
                step={1}
                value={stepIndex}
                onChange={(e) => setStepIndex(Number(e.target.value))}
                disabled={isBusy}
                className="w-full cursor-pointer accent-accent"
                aria-label={t("sliderLabel")}
              />

              <div className="flex justify-between text-[11px] text-text-muted font-mono px-0.5 [&>*:nth-child(even)]:hidden sm:[&>*:nth-child(even)]:block">
                {LOG_COUNT_STEPS.map((val, idx) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStepIndex(idx)}
                    className={`cursor-pointer px-1.5 py-2 transition-colors sm:px-0 sm:py-0 ${
                      stepIndex === idx ? "font-bold text-accent" : "hover:text-text"
                    }`}
                  >
                    {val >= 1000 ? `${val / 1000}k` : val}
                  </button>
                ))}
              </div>
            </div>

            {/* Anomalies Preview Banner */}
            <div className="rounded-md border border-line bg-surface p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium text-text">
                <Flame className="size-3.5 text-amber-500" />
                <span>{t("includedTitle")}</span>
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-text-muted text-[11.5px]">
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> {t("included1")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> {t("included2")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> {t("included3")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> {t("included4")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> {t("included5")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> {t("included6")}
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Demo CSV Option */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 hover:bg-surface-muted/20 transition-colors">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-surface-muted text-text-muted">
                <FileSpreadsheet className="size-4" />
              </span>
              <p className="text-[14px] font-medium text-text">
                {t("csvTitle")}
              </p>
            </div>
            {/* One sentence with the two filenames interpolated, rather than
                five fragments spliced around them: only the whole sentence can
                be reordered into German. `t.rich` keeps the <code> wrappers. */}
            <p className="text-[13px] text-text-muted max-w-xl">
              {t.rich("csvDescription", {
                file: (chunks) => <Filename>{chunks}</Filename>,
                file2: (chunks) => <Filename>{chunks}</Filename>,
              })}
            </p>
          </div>

          <button
            type="button"
            onClick={handleLoadCsv}
            disabled={isBusy}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-text shadow-sm hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-50 cursor-pointer transition-all shrink-0 max-sm:w-full sm:h-8 sm:self-center"
          >
            {isCsvPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>{t("csvLoading")}</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="size-3.5" />
                <span>{t("csvLoad")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
