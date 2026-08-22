"use client";

import { useEffect, useRef, useState } from "react";

import { useHydrated } from "@/lib/use-hydrated";

/**
 * **Temporary.** A field probe for the "the ledger jumps back to the top"
 * report, which does not reproduce on a desk and cannot be reproduced in CI.
 *
 * Mounted only when the URL carries `?debug=scroll`, so it costs a signed-in
 * reader nothing. Its text is untranslated on purpose — it is instrumentation,
 * not product. Delete this file and its two lines in
 * `app/[locale]/dashboard/page.tsx` once the cause is known.
 *
 * It exists to separate three explanations that look identical to the reader
 * but need completely different fixes:
 *
 * - **The page got shorter.** `rows` collapses back towards the first chunk and
 *   `height` drops with it. The feed lost its accumulated chunks — remounted,
 *   or the route re-suspended into `loading.tsx` and unmounted it — and the
 *   browser clamped the scroll offset to the shorter document.
 * - **Something scrolled us.** `rows` and `height` are unchanged across the
 *   jump, so nothing about the document moved: a `scrollTo`/`scrollIntoView`
 *   ran. Next's own `ScrollAndFocusHandler` sets `documentElement.scrollTop = 0`
 *   when it applies a pending navigation scroll intent, which is the shape to
 *   suspect.
 * - **The tab reloaded.** `loads` is greater than one. A phone discarding a
 *   heavy tab under memory pressure comes back as a fresh load with no chunks,
 *   which reads exactly like the first case.
 */

/** Below this an upward move is just the reader scrolling back up. */
const JUMP_PX = 300;

/** Layout reads are expensive on a long ledger, so they are sampled, not per-frame. */
const SAMPLE_MS = 300;

const LOADS_KEY = "beyond-money.debug-loads";

type Jump = {
  at: string;
  from: number;
  to: number;
  heightBefore: number;
  heightAfter: number;
  rowsBefore: number;
  rowsAfter: number;
  lastEvent: string;
};

function countRows(): number {
  return document.querySelectorAll("#transactions li").length;
}

function pageHeight(): number {
  return document.documentElement.scrollHeight;
}

/** Survives a reload, which is the point — it is how a discarded tab shows up. */
function bumpLoads(): number {
  try {
    const next = Number(window.sessionStorage.getItem(LOADS_KEY) ?? "0") + 1;
    window.sessionStorage.setItem(LOADS_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

/*
 * Read once when the module is first evaluated in the browser, not from an
 * effect: a fresh module instance is *precisely* what "the tab was thrown away
 * and reloaded" means, and an effect would count React remounts as well. The
 * `window` guard is for the server render — the values are only shown once
 * `useHydrated` says there is a document, so the two passes agree.
 */
const LOADS = typeof window === "undefined" ? 0 : bumpLoads();
const NAV_TYPE =
  typeof window === "undefined"
    ? "?"
    : ((performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined)?.type ?? "?");

export function ScrollDebug() {
  const hydrated = useHydrated();
  const [jumps, setJumps] = useState<Jump[]>([]);
  const [copied, setCopied] = useState(false);
  // Written from listeners and read inside the frame loop, so a ref rather than
  // state: naming the last event must not itself cause a render.
  const lastEvent = useRef("none");

  useEffect(() => {
    // Capture phase, so a listener that stops propagation cannot hide one.
    const events = [
      "popstate",
      "hashchange",
      "pageshow",
      "pagehide",
      "visibilitychange",
      "beforeunload",
    ];
    const mark = (event: Event) => {
      lastEvent.current = `${event.type} +${Math.round(performance.now())}ms`;
    };
    for (const name of events) window.addEventListener(name, mark, true);

    let sampledHeight = pageHeight();
    let sampledRows = countRows();
    const sampler = window.setInterval(() => {
      sampledHeight = pageHeight();
      sampledRows = countRows();
    }, SAMPLE_MS);

    let previousY = window.scrollY;
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const y = window.scrollY;

      // Only a *large upward* move is interesting, and only then is it worth
      // paying for the layout reads.
      if (previousY - y > JUMP_PX) {
        const heightBefore = sampledHeight;
        const rowsBefore = sampledRows;
        const heightAfter = pageHeight();
        const rowsAfter = countRows();
        setJumps((list) =>
          [
            {
              at: new Date().toLocaleTimeString(),
              from: Math.round(previousY),
              to: Math.round(y),
              heightBefore,
              heightAfter,
              rowsBefore,
              rowsAfter,
              lastEvent: lastEvent.current,
            },
            ...list,
          ].slice(0, 8),
        );
        sampledHeight = heightAfter;
        sampledRows = rowsAfter;
      }

      previousY = y;
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(sampler);
      for (const name of events) window.removeEventListener(name, mark, true);
    };
  }, []);

  const loads = hydrated ? LOADS : 0;
  const navType = hydrated ? NAV_TYPE : "?";

  const report = [
    `loads=${loads} nav=${navType} ua=${typeof navigator === "undefined" ? "?" : navigator.userAgent}`,
    ...jumps.map(
      (jump) =>
        `${jump.at} y ${jump.from}->${jump.to} | height ${jump.heightBefore}->${jump.heightAfter} | rows ${jump.rowsBefore}->${jump.rowsAfter} | last ${jump.lastEvent}`,
    ),
  ].join("\n");

  return (
    // `bg-text text-bg` — ink and its inverse, so it stays opaque and legible
    // over the ledger in both themes without inventing a colour.
    <div className="fixed bottom-2 left-2 z-[100] max-w-[92vw] rounded-md bg-text/95 p-2 font-mono text-[10px] leading-tight text-bg shadow-lg">
      <div className="flex items-center gap-2">
        <strong>
          loads {loads} · nav {navType} · jumps {jumps.length}
        </strong>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(report);
            setCopied(true);
          }}
          className="rounded border border-bg/40 px-1.5 py-0.5"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>

      {jumps.length === 0 ? (
        <p className="mt-1 opacity-70">scroll down fast…</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {jumps.map((jump, index) => (
            <li key={index}>
              {jump.at} y {jump.from}→{jump.to} · h {jump.heightBefore}→
              {jump.heightAfter} · rows {jump.rowsBefore}→{jump.rowsAfter} ·{" "}
              {jump.lastEvent}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
