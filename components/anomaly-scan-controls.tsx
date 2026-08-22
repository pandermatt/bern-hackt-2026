"use client";

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

function formatWhen(value: Date | string | null): string {
  if (!value) return "never";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function AnomalyScanControls() {
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
        toast.error(result.error);
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
          Anomaly detection
        </h2>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[62ch]">
            <p className="text-[14px] font-medium text-text">
              Scan transactions for anomalies
            </p>
            <p className="mt-0.5 text-[13px] text-text-muted">
              Runs the full rule set over your history and saves what it finds,
              so the dashboard can show it without re-analysing on every page
              view. Safe to re-run — each scan replaces the last one&apos;s
              results.
            </p>
          </div>

          <button
            type="button"
            onClick={onScan}
            disabled={running || pending}
            className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-md bg-accent px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 max-sm:w-full sm:h-9"
          >
            {running ? "Scanning…" : pending ? "Starting…" : "Run scan"}
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
              aria-label="Anomaly scan progress"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-[12px] tabular-nums text-text-muted">
              {status.phase} · {status.processed.toLocaleString("de-CH")} of{" "}
              {status.total.toLocaleString("de-CH")} transactions
              {percent > 0 && ` · ${percent}%`}
            </p>
          </div>
        )}

        {loaded && !running && status?.status === "done" && (
          <p className="mt-3 font-mono text-[12px] tabular-nums text-text-muted">
            Last scan {formatWhen(status.finishedAt)} ·{" "}
            {status.total.toLocaleString("de-CH")} transactions ·{" "}
            {status.insightCount.toLocaleString("de-CH")} findings
          </p>
        )}

        {loaded && !running && status?.status === "failed" && (
          <p className="mt-3 text-[13px] text-danger">
            Last scan failed: {status.error ?? "unknown error"}
          </p>
        )}

        {loaded && !status && (
          <p className="mt-3 text-[13px] text-text-muted">
            No scan has run yet — the dashboard will not show any anomalies
            until you run one.
          </p>
        )}
      </div>
    </section>
  );
}
