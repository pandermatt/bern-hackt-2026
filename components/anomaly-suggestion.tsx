"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  getAnomalyScanStatus,
  startAnomalyScan,
  type ScanStatus,
} from "@/app/actions/anomalies";

/**
 * Prompts for — and runs — the first AI analysis.
 *
 * Findings are precomputed rather than derived at render time, so a fresh
 * account shows no anomaly badges at all — which looks identical to an account
 * with nothing wrong. This is what tells those apart, and it only appears when
 * no scan has ever completed. Once one has, silence is a real answer and the
 * prompt stays gone even if the scan found nothing.
 *
 * It used to be a server component that linked to `/account`, where the scan
 * and its progress bar lived. That made the shortest path to a first result
 * "leave the dashboard, start a scan, come back, reload" — four steps to see
 * badges that belong on the very list this sits above. The control and the
 * progress now live here, and the completed run triggers a `router.refresh()`
 * so the server-rendered ledger below picks up its badges without a reload.
 * `/account` keeps its own copy for re-running a scan later, since this box is
 * gone by then.
 */

const POLL_MS = 600;

export function AnomalySuggestion({
  running: runningOnLoad,
  transactionCount,
}: {
  running: boolean;
  transactionCount: number;
}) {
  const t = useTranslations("AnomalySuggestion");
  const tScan = useTranslations("AnomalyScan");
  const tPhases = useTranslations("ScanPhases");
  const router = useRouter();

  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [pending, startTransition] = useTransition();
  // Zero means "not watching". Starts at 1 when the server already saw a run in
  // flight, and is bumped after starting one, to re-enter the effect.
  const [watch, setWatch] = useState(runningOnLoad ? 1 : 0);
  const cancelled = useRef(false);

  useEffect(() => {
    if (watch === 0) return;
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Declared inside the effect and chained with setTimeout rather than
    // setInterval: each poll waits for the previous response, so a slow server
    // cannot pile up overlapping requests.
    async function tick() {
      const next = await getAnomalyScanStatus();
      if (cancelled.current) return;
      setStatus(next);
      if (next?.status === "running") {
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      // No run row at all means the session went away underneath us. Stop
      // watching, or `busy` would stay true on the strength of a status that is
      // never going to arrive and the box would sit at "Starting…" for good.
      if (!next) {
        setWatch(0);
        return;
      }
      // The ledger below is server-rendered and its badges come from the
      // `anomalies` table, so they only appear on a re-render. Asking for one
      // here is the point of moving the control onto the dashboard.
      if (next?.status === "done") router.refresh();
    }

    void tick();

    // Stops the chain from outliving the page, and from calling setState on an
    // unmounted component when a request is already in flight.
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [watch, router]);

  function onScan() {
    startTransition(async () => {
      const result = await startAnomalyScan();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setStatus(null);
      setWatch((n) => n + 1);
    });
  }

  const running = status?.status === "running";
  const failed = status?.status === "failed";
  // A finished run still shows the bar, filled: the refresh it just asked for
  // is what removes this box, and dropping back to the idle prompt in between
  // would read as the scan having been thrown away.
  const done = status?.status === "done";
  // Between the click and the first poll there is no status row yet, and on a
  // reload mid-scan there is one but it has not arrived. Both are "working".
  const busy = pending || running || done || (watch > 0 && !status);

  // Guard against a zero total, which would make this NaN on the first tick.
  const percent = done
    ? 100
    : status && status.total > 0
      ? Math.min(100, Math.round((status.processed / status.total) * 100))
      : 0;

  return (
    // `.on-brand` re-points the text tokens for a Supernova ground, so this
    // stays legible in both themes without hardcoding a colour — see the note
    // in app/globals.css. `bg-brand` is the identity colour, not a surface.
    // Everything inside draws with `--text`, which `.on-brand` pins to #1a1a1a:
    // 11.5:1 on the yellow, where the white this used to use was 1.5:1.
    <section className="on-brand card border-brand bg-brand px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex items-start gap-2.5">
          {/* Decorative — the heading beside it carries the meaning — but it is
              still ink on the yellow rather than white on it, so it holds its
              shape without needing a thickened stroke to fake weight. */}
          <Sparkles
            aria-hidden="true"
            strokeWidth={2}
            className={`mt-0.5 size-[18px] shrink-0 text-text ${busy ? "animate-pulse" : ""}`}
          />
          <div>
            <p className="text-[14px] font-semibold text-text">
              {done ? t("doneTitle") : busy ? t("runningTitle") : t("title")}
            </p>
            <p className="mt-0.5 max-w-[64ch] text-[13px] text-text-muted">
              {done
                ? t("doneBody")
                : busy
                  ? t("runningBody")
                  : /* One message, not three fragments: German puts the verb at
                       the end, so a sentence spliced around a number in English
                       word order cannot be translated into it. */
                    t("body", { count: transactionCount.toLocaleString("de-CH") })}
            </p>
          </div>
        </div>

        {!busy && (
          <button
            type="button"
            onClick={onScan}
            className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-text px-3.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-85 max-sm:w-full sm:h-9"
          >
            <Sparkles aria-hidden="true" className="size-[15px]" />
            {failed ? t("retry") : t("cta")}
          </button>
        )}
      </div>

      {busy && (
        <div className="mt-3.5">
          {/* Track and fill are both `--text` on the pinned yellow ground —
              a `bg-surface-muted` track would be white-on-yellow and read as a
              hole in the card. */}
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-text/20"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={tScan("progressLabel")}
          >
            <div
              className="h-full rounded-full bg-text transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[12px] tabular-nums text-text-muted">
            {status && running
              ? /* The phase is written to the database by the scan in English;
                   `ScanPhases` maps those fixed strings to words. An unknown one
                   passes through rather than throwing. */
                tScan("progress", {
                  phase: tPhases.has(status.phase)
                    ? tPhases(status.phase)
                    : status.phase,
                  processed: status.processed.toLocaleString("de-CH"),
                  total: status.total.toLocaleString("de-CH"),
                })
              : status && done
                ? tScan("progress", {
                    phase: tPhases("Finished"),
                    processed: status.total.toLocaleString("de-CH"),
                    total: status.total.toLocaleString("de-CH"),
                  })
                : tScan("starting")}
            {percent > 0 && ` · ${percent}%`}
          </p>
        </div>
      )}

      {failed && status && (
        <p className="mt-3 text-[13px] font-medium text-text">
          {tScan("failed", { error: status.error ?? tScan("unknownError") })}
        </p>
      )}
    </section>
  );
}
