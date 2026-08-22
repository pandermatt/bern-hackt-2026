"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  getAnomalyScanStatus,
  startAnomalyScan,
  type ScanStatus,
} from "@/app/actions/anomalies";

/**
 * Triggers an anomaly scan and follows its progress.
 *
 * The scan is a background job on the server, so there is nothing to await —
 * the button kicks it off and this component polls for progress. Polling only
 * runs while a scan is in flight; a finished run is rendered from whatever the
 * last poll returned.
 */

const POLL_MS = 600;

/**
 * A wall-clock instant, so this one *is* a `Date` and `Intl` is the right tool
 * — unlike a booking date, which is a day and stays text. The locale is passed
 * in rather than hardcoded to `de-CH`, so an English reader gets `5 Jan 2026,
 * 14:03` instead of `05.01.2026, 14:03`.
 */
function formatWhen(value: Date | string | null, locale: string, never: string): string {
  if (!value) return never;
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AnomalyScanControls() {
  const t = useTranslations("AnomalyScan");
  const tPhases = useTranslations("ScanPhases");
  const locale = useLocale();
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  // Bumped after a scan is started, to re-enter the effect and resume polling
  // once a run that had already finished is replaced by a new one.
  const [watch, setWatch] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Declared inside the effect and chained with setTimeout rather than
    // setInterval: each poll waits for the previous response, so a slow server
    // cannot pile up overlapping requests.
    async function tick() {
      const next = await getAnomalyScanStatus();
      if (cancelled.current) return;
      setStatus(next);
      setLoaded(true);
      if (next?.status === "running") timer = setTimeout(tick, POLL_MS);
    }

    void tick();

    // Stops the chain from outliving the page, and from calling setState on an
    // unmounted component when a request is already in flight.
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [watch]);

  const running = status?.status === "running";

  function onScan() {
    startTransition(async () => {
      const result = await startAnomalyScan();
      if (!result.ok) {
        // The action answers with a code, not a sentence — see its note.
        toast.error(t(`error_${result.error}`));
        return;
      }
      setWatch((n) => n + 1);
    });
  }

  // Guard against a zero total, which would make this NaN on the first tick.
  const percent =
    status && status.total > 0
      ? Math.min(100, Math.round((status.processed / status.total) * 100))
      : 0;

  return (
    <section
      id="anomaly-scan"
      className="card mt-8 scroll-mt-20 overflow-hidden"
      aria-labelledby="scan-heading"
    >
      <div className="border-b border-line bg-surface-muted/50 px-4 py-3 sm:px-5">
        <h2 id="scan-heading" className="text-[14.5px] font-semibold text-text">
          {t("heading")}
        </h2>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[62ch]">
            <p className="text-[14px] font-medium text-text">
              {t("title")}
            </p>
            <p className="mt-0.5 text-[13px] text-text-muted">
              {t("description")}
            </p>
          </div>

          <button
            type="button"
            onClick={onScan}
            disabled={running || pending}
            className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-md bg-accent px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 max-sm:w-full sm:h-9"
          >
            {running ? t("running") : pending ? t("starting") : t("run")}
          </button>
        </div>

        {running && (
          <div className="mt-4">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("progressLabel")}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-[12px] tabular-nums text-text-muted">
              {/* The phase is written to the database by the scan in English;
                  `ScanPhases` maps those fixed strings to words. An unknown one
                  passes through rather than throwing. */}
              {t("progress", {
                phase: tPhases.has(status.phase) ? tPhases(status.phase) : status.phase,
                processed: status.processed.toLocaleString("de-CH"),
                total: status.total.toLocaleString("de-CH"),
              })}
              {percent > 0 && ` · ${percent}%`}
            </p>
          </div>
        )}

        {loaded && !running && status?.status === "done" && (
          <p className="mt-3 font-mono text-[12px] tabular-nums text-text-muted">
            {t("lastScan", {
              when: formatWhen(status.finishedAt, locale, t("never")),
              total: status.total.toLocaleString("de-CH"),
              findings: status.insightCount.toLocaleString("de-CH"),
            })}
          </p>
        )}

        {loaded && !running && status?.status === "failed" && (
          <p className="mt-3 text-[13px] text-danger">
            {t("failed", { error: status.error ?? t("unknownError") })}
          </p>
        )}

        {loaded && !status && (
          <p className="mt-3 text-[13px] text-text-muted">
            {t("noScan")}
          </p>
        )}
      </div>
    </section>
  );
}
