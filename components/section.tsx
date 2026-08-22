import type { ReactNode } from "react";

/**
 * One dashboard section: a big heading sitting on the page's own ground, then
 * the content as a rounded grey panel underneath.
 *
 * The idiom comes from the ledger's month groups (`components/ledger-chunk.tsx`)
 * — before this, everything above the ledger wore `.card` (white surface,
 * border, shadow, a 15px heading *inside* the box) and the page read as two
 * designs stacked. It lives here rather than as another `.card`-style CSS class
 * because the heading is part of the pattern, not just the box.
 *
 * Two deliberate differences from the month headings:
 *
 * - **Not sticky.** Those are `sticky top-16`, pinned under the app header; a
 *   second sticky layer at the same offset would collide with them.
 * - **No `bg-bg`.** That opacity is only there so rows can scroll underneath.
 *
 * The `pt-6` on the heading is what spaces sections apart, so the page stacks
 * these with no `space-y` of its own — the same rhythm the ledger already sets.
 */
export function Section({
  id,
  heading,
  meta,
  panelClassName = "",
  children,
}: {
  /** Used for the heading's id, so the section can be labelled by it. */
  id: string;
  heading: string;
  /** Right-aligned, baseline-aligned with the heading. Wraps under it when the
   * two cannot share a line. */
  meta?: ReactNode;
  /** Padding and anything else the panel needs. */
  panelClassName?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 pt-6 pb-2.5">
        <h2
          id={headingId}
          className="text-[26px] leading-none font-semibold tracking-tight text-text sm:text-[30px]"
        >
          {heading}
        </h2>
        {meta && <p className="text-[12.5px] text-text-muted">{meta}</p>}
      </div>

      {/* `overflow-clip` so the radius actually cuts whatever is inside —
          including a canvas, which does not respect an ancestor's radius on its
          own. */}
      <div className={`overflow-clip rounded-lg bg-surface-muted ${panelClassName}`}>
        {children}
      </div>
    </section>
  );
}
