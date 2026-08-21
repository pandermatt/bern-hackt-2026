"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import Link from "next/link";

import {
  generateSyntheticTransactionsAction,
  loadDemoCsvAction,
} from "@/app/actions/demo-data";

const LOG_COUNT_STEPS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000] as const;
const START_YEARS = [2021, 2022, 2023, 2024, 2025, 2026] as const;

export function DemoDataControls() {
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
        toast.error("An unexpected error occurred while generating data.");
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
        toast.error("An unexpected error occurred while importing demo CSV.");
      }
    });
  };

  const isBusy = isFakerPending || isCsvPending;

  return (
    <div className="card mt-8 overflow-hidden border-line">
      <div className="border-b border-line bg-surface-muted/40 px-4 py-3 sm:px-5 flex items-center justify-between">
        <div>
          <h2 className="text-[14.5px] font-semibold text-text">
            Demo & Synthetic Data Studio
          </h2>
          <p className="text-[12.5px] text-text-muted">
            Populate your account with customizable scale synthetic banking transactions or official statement CSVs.
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
            View Dashboard <ArrowRight className="size-3" />
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
                  Synthetic Transactions Generator (Log-Scale & Anomalies)
                </p>
              </div>
              <p className="text-[13px] text-text-muted max-w-2xl">
                Generates realistic multi-year Swiss bank activity with regular income, fixed bills,
                variable daily spending, and embedded financial anomalies for analysis.
              </p>
            </div>

            <button
              type="button"
              onClick={handleGenerateFaker}
              disabled={isBusy}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-medium text-accent-contrast shadow-sm hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 cursor-pointer transition-all self-start shrink-0"
            >
              {isFakerPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Generating {targetCount.toLocaleString()}…</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  <span>Generate {targetCount.toLocaleString()} Transactions</span>
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
                  <Calendar className="size-3.5 text-text-muted" /> Start Year
                </label>
                <select
                  value={startYear}
                  onChange={(e) => setStartYear(Number(e.target.value))}
                  disabled={isBusy}
                  className="w-full h-8 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
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
                  <Layers className="size-3.5 text-text-muted" /> Duration
                </label>
                <select
                  value={yearsCount}
                  onChange={(e) => setYearsCount(Number(e.target.value))}
                  disabled={isBusy}
                  className="w-full h-8 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value={1}>1 Year ({startYear})</option>
                  <option value={2}>2 Years ({startYear} – {startYear + 1})</option>
                  <option value={3}>3 Years ({startYear} – {startYear + 2})</option>
                  <option value={5}>5 Years ({startYear} – {startYear + 4})</option>
                </select>
              </div>
            </div>

            {/* Log Scale Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text flex items-center gap-1.5">
                  <span>Target Transaction Count (Logarithmic Scale):</span>
                  <span className="font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded text-xs">
                    {targetCount.toLocaleString()} transactions
                  </span>
                </label>
                <span className="text-[11px] text-text-muted">
                  Step {stepIndex + 1} of {LOG_COUNT_STEPS.length}
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
                aria-label="Transaction count slider in log scale"
              />

              <div className="flex justify-between text-[11px] text-text-muted font-mono px-0.5">
                {LOG_COUNT_STEPS.map((val, idx) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStepIndex(idx)}
                    className={`cursor-pointer transition-colors ${
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
                <span>Included Bank & Fraud Anomalies</span>
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-text-muted text-[11.5px]">
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> Outlier luxury watch purchases (CHF 4.5k–9.5k)
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> Duplicate charge glitches (same day double-bills)
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> Rapid micro-transaction card testing bursts
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> Casino and unexpected tax penalty spikes
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> Large lottery & insurance windfall inflows (CHF 10k+)
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-accent">•</span> 10x subscription billing error shocks
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
                Load Official Demo CSV Statements
              </p>
            </div>
            <p className="text-[13px] text-text-muted max-w-xl">
              Imports 513 original PostFinance statement records from{" "}
              <code className="text-xs bg-surface-muted px-1 py-0.5 rounded font-mono">
                jeanine_2025_Account1_2025.csv
              </code>{" "}
              and{" "}
              <code className="text-xs bg-surface-muted px-1 py-0.5 rounded font-mono">
                jeanine_2025_Account3_2025.csv
              </code>
              .
            </p>
          </div>

          <button
            type="button"
            onClick={handleLoadCsv}
            disabled={isBusy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-text shadow-sm hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-50 cursor-pointer transition-all self-start sm:self-center shrink-0"
          >
            {isCsvPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>Loading…</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="size-3.5" />
                <span>Load Demo CSV</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
