"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, FileSpreadsheet, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import {
  generateSyntheticTransactionsAction,
  loadDemoCsvAction,
} from "@/app/actions/demo-data";

export function DemoDataControls() {
  const router = useRouter();
  const [isFakerPending, startFakerTransition] = useTransition();
  const [isCsvPending, startCsvTransition] = useTransition();
  const [selectedYear, setSelectedYear] = useState<number>(2025);
  const [lastActionStatus, setLastActionStatus] = useState<string | null>(null);

  const handleGenerateFaker = () => {
    startFakerTransition(async () => {
      try {
        const result = await generateSyntheticTransactionsAction(selectedYear);
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
            Demo & Synthetic Data
          </h2>
          <p className="text-[12.5px] text-text-muted">
            Populate your account with transactions for analysis and exploration.
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
        {/* Faker Generator Option */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 py-4 sm:px-5 hover:bg-surface-muted/20 transition-colors">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-accent-soft text-accent">
                <Sparkles className="size-4" />
              </span>
              <p className="text-[14px] font-medium text-text">
                Generate 1-Year Synthetic Data (Faker)
              </p>
            </div>
            <p className="text-[13px] text-text-muted max-w-xl">
              Generates a full year of realistic Swiss banking transactions with recurring
              salary, rent, utilities, insurance, daily groceries, dining, and credit card
              settlements.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              disabled={isBusy}
              className="h-8 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
              aria-label="Select year to generate"
            >
              <option value={2025}>Year 2025</option>
              <option value={2026}>Year 2026</option>
            </select>

            <button
              type="button"
              onClick={handleGenerateFaker}
              disabled={isBusy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast shadow-sm hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 cursor-pointer transition-all"
            >
              {isFakerPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Generating…</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  <span>Generate with Faker</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Demo CSV Option */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 py-4 sm:px-5 hover:bg-surface-muted/20 transition-colors">
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
