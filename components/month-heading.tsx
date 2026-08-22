import { useTranslations } from "next-intl";

import { formatMoney, type MonthTotal } from "@/lib/insights";

/**
 * A month's name, year and totals, pinned under the app header.
 *
 * Shared by the ledger and the calendar rather than copied into each, and the
 * sharing is load-bearing rather than tidiness — see the note inside on why
 * every heading on the page has to be exactly as tall as every other. Two
 * copies of this markup would drift, and the drift shows up as a sliver of last
 * month peeking out from under this one.
 *
 * Its own module because the calendar is a client component and this is the
 * only piece of the ledger it needs: nothing here but translations and a
 * formatter, so it costs the client bundle almost nothing, where reaching into
 * `ledger-chunk.tsx` for it would have cost the rows and the whole icon map.
 *
 * The figures are the **whole month** under the current filter, not one page's
 * slice of it: at `PAGE_SIZE = 50` a month usually spans two chunks, and a
 * subtotal that only counted the visible rows would report a different number
 * for the same month depending on where you happened to be. The wording says
 * "in" and "out" rather than "total" for the same reason.
 */
export function MonthHeading({
  month,
  totals,
  id,
}: {
  /** `YYYY-MM`. */
  month: string;
  totals: MonthTotal | undefined;
  /** The heading's element id, so a grid can be `aria-labelledby` it. */
  id?: string;
}) {
  const t = useTranslations("Ledger");
  const tMonths = useTranslations("Months");

  return (
    /* `top-16` is the app header's own height; `z-10` keeps this under it
       rather than over it (that header is `z-50`). `bg-bg` — the page's own
       ground, not `--surface` — because there is no card behind this any more;
       it still has to be opaque or the rows would show through it as they
       scroll past.

       **Every heading in a transaction view is pinned at this same offset, all
       at once.** They are siblings of one another and of the panels — a month
       can span chunks, so no month can own a wrapper to be sticky within —
       which means their shared containing block is the whole section. Nothing
       releases August when September arrives; September simply paints over it,
       being later in the DOM, and the illusion holds only for as long as every
       one of these boxes is exactly as tall as the last.

       That is what `flex-col` below `sm` is for. Wrapping made the height
       depend on the month's *name*: "September 2025" pushed the figures onto a
       second line where "August 2025" kept them beside the heading, so the
       taller September box showed a sliver of itself below the shorter August
       one that was supposed to be covering it. Two lines always, on every
       month, and the boxes agree. From `sm` there is room for one line and they
       agree that way instead. */
    <div className="sticky top-16 z-10 flex flex-col items-start gap-y-0.5 bg-bg pt-6 pb-2.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3">
      {/* The month is what you scan for; the year only disambiguates it, so it
          rides along at the body size. `leading-none` keeps the big type
          sitting on the same baseline as the figures opposite. */}
      <h3
        id={id}
        className="text-[26px] leading-none font-semibold tracking-tight text-text sm:text-[30px]"
      >
        {tMonths(`long${Number(month.slice(5, 7))}`)}{" "}
        <span className="text-[15px] font-medium text-text-muted">
          {month.slice(0, 4)}
        </span>
      </h3>

      {/* Unconditional, where this used to be `totals &&`. `monthTotals` skips
          transfers, so a month whose only line is a credit-card payment has no
          entry at all — and a heading that quietly drops its second line is the
          height mismatch above, back again. Zero is also the honest figure:
          these two exclude transfers by definition, exactly as the trend
          chart's do. */}
      <p className="flex items-baseline gap-3 font-mono text-[12px] tabular-nums">
        <span className="text-positive">
          {/* Named for anyone who cannot see the colour or the sign. */}
          <span className="sr-only">{t("moneyIn")} </span>+{formatMoney(totals?.income ?? 0)}
        </span>
        <span className="text-text-muted">
          <span className="sr-only">{t("moneyOut")} </span>−{formatMoney(totals?.expense ?? 0)}
        </span>
      </p>
    </div>
  );
}
