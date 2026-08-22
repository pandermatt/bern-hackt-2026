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
} from "lucide-react";
import { toast } from "sonner";

import {
  generateSyntheticTransactionsAction,
  loadDemoCsvAction,
} from "@/app/actions/demo-data";
import { SettingsRow } from "@/components/settings-row";
import { Link } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";

const LOG_COUNT_STEPS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000] as const;

/** A filename inside a sentence, for the `csvDescription` rich-text slots. */
function Filename({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-xs bg-surface-muted px-1 py-0.5 rounded font-mono">
      {children}
    </code>
  );
}
const YEARS_CHOICES = [1, 2, 3, 5] as const;

/** What the generator seeds, rendered as one footnote line under its inputs. */
const INCLUDED = [
  "included1",
  "included2",
  "included3",
  "included4",
  "included5",
  "included6",
] as const;

/**
 * The two rows of the account page's Data group that put statements *into* an
 * account: the synthetic generator and the shipped demo CSV.
 *
 * It renders rows rather than a card of its own — the group's heading and
 * panel come from `Section` in `app/[locale]/account/page.tsx`, the same way
 * every other block on that page now works.
 */

export function DemoDataControls() {
  const t = useTranslations("DemoData");
  const tMonths = useTranslations("Months");
  const router = useRouter();
  const [isFakerPending, startFakerTransition] = useTransition();
  const [isCsvPending, startCsvTransition] = useTransition();

  const [stepIndex, setStepIndex] = useState<number>(3); // 500 default
  const [yearsCount, setYearsCount] = useState<number>(1);
  const [lastActionStatus, setLastActionStatus] = useState<string | null>(null);
  // The range labels read the clock, and the server render's clock is not the
  // browser's — near a month boundary the two would disagree, so the ranges
  // fill in after hydration.
  const hydrated = useHydrated();

  const targetCount = LOG_COUNT_STEPS[stepIndex];

  // Mirrors the generator's window: `n` years ending today, day-exact.
  const rangeLabel = (n: number): string => {
    if (!hydrated) return "…";
    const end = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - n);
    start.setDate(start.getDate() + 1);
    const label = (d: Date) => `${tMonths(`short${d.getMonth() + 1}`)} ${d.getFullYear()}`;
    return `${label(start)} – ${label(end)}`;
  };

  const handleGenerateFaker = () => {
    startFakerTransition(async () => {
      try {
        const result = await generateSyntheticTransactionsAction({
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
    <>
      {lastActionStatus && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-accent-soft/40 px-4 py-2.5 text-[13px] text-text sm:px-5">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0 text-accent" />
            {lastActionStatus}
          </span>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            {t("viewDashboard")} <ArrowRight className="size-3" />
          </Link>
        </div>
      )}

      <SettingsRow
        label={t("syntheticTitle")}
        note={t("syntheticDescription")}
        detail={
          /* The two inputs the button reads, side by side from `sm` up. They
             used to live in a bordered panel nested inside the card, with the
             nine slider steps as their own row of buttons and the patterns
             below in a third box — three grounds deep on what is one control.
             On the group's grey panel only the select needs a ground of its
             own, and it gets `--surface`. */
          <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:items-start">
            <div>
              <label
                htmlFor="synthetic-years"
                className="text-[12.5px] font-medium text-text"
              >
                {t("duration")}
              </label>
              <select
                id="synthetic-years"
                value={yearsCount}
                onChange={(e) => setYearsCount(Number(e.target.value))}
                disabled={isBusy}
                className="mt-1.5 h-10 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[16px] text-text focus:ring-1 focus:ring-accent focus:outline-none sm:h-9 sm:text-[13px]"
              >
                {YEARS_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {t(`year${n}`, { range: rangeLabel(n) })}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label
                  htmlFor="synthetic-count"
                  className="text-[12.5px] font-medium text-text"
                >
                  {t("targetCount")}
                </label>
                <span className="font-mono text-[12.5px] tabular-nums text-accent">
                  {targetCount.toLocaleString("de-CH")}
                </span>
              </div>
              <input
                id="synthetic-count"
                type="range"
                min={0}
                max={LOG_COUNT_STEPS.length - 1}
                step={1}
                value={stepIndex}
                onChange={(e) => setStepIndex(Number(e.target.value))}
                disabled={isBusy}
                className="mt-2.5 w-full cursor-pointer accent-accent sm:mt-3"
                aria-label={t("sliderLabel")}
              />
              {/* Just the ends, the way a slider is normally labelled. The nine
                  clickable steps this replaces were a second control for what
                  the slider already does, and the value now sits above it. */}
              <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-text-subtle">
                <span>{LOG_COUNT_STEPS[0]}</span>
                <span>
                  {LOG_COUNT_STEPS[LOG_COUNT_STEPS.length - 1] / 1000}k
                </span>
              </div>
            </div>

            {/* A footnote, not a panel: it says what the generator seeds, and
                nothing here is actionable. */}
            <p className="text-[12px] text-text-subtle sm:col-span-2">
              {t("includedTitle")}: {INCLUDED.map((key) => t(key)).join(" \u00b7 ")}
            </p>
          </div>
        }
      >
        <button
          type="button"
          onClick={handleGenerateFaker}
          disabled={isBusy}
          className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50 max-sm:w-full sm:h-9"
        >
          {isFakerPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t("generating", { count: targetCount.toLocaleString("de-CH") })}
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              {t("generate", { count: targetCount.toLocaleString("de-CH") })}
            </>
          )}
        </button>
      </SettingsRow>

      <SettingsRow
        label={t("csvTitle")}
        note={
          /* One sentence with the two filenames interpolated, rather than five
             fragments spliced around them: only the whole sentence can be
             reordered into German. `t.rich` keeps the <code> wrappers. */
          t.rich("csvDescription", {
            file: (chunks) => <Filename>{chunks}</Filename>,
            file2: (chunks) => <Filename>{chunks}</Filename>,
          })
        }
      >
        <button
          type="button"
          onClick={handleLoadCsv}
          disabled={isBusy}
          className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50 max-sm:w-full sm:h-9"
        >
          {isCsvPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t("csvLoading")}
            </>
          ) : (
            <>
              <FileSpreadsheet className="size-3.5" />
              {t("csvLoad")}
            </>
          )}
        </button>
      </SettingsRow>
    </>
  );
}
