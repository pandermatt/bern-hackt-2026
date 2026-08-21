import Link from "next/link";

import { formatMoney, type Slice } from "@/lib/insights";

/**
 * A ranked list with a proportional bar per row — the same shape serves the
 * category breakdown and the top-merchant list, so it is one component.
 *
 * A plain `<div>` whose width is a percentage, not SVG: this is a bar chart
 * that reflows with the text beside it, which HTML does better than a viewBox.
 */
export function BreakdownList({
  heading,
  slices,
  linkParam,
  emptyLabel,
}: {
  heading: string;
  slices: Slice[];
  /** Which filter a row links to, so the list doubles as navigation. */
  linkParam: "category" | "merchant";
  emptyLabel: string;
}) {
  const headingId = `${linkParam}-heading`;
  // Bars are scaled against the leader, not the total: with a long tail, a
  // share-scaled bar for rank 8 is a sliver nobody can compare.
  const leader = slices[0]?.amount ?? 1;

  return (
    <section className="card p-5" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-[15px] font-semibold text-text">
        {heading}
      </h2>

      {slices.length === 0 ? (
        <p className="mt-4 text-[13.5px] text-text-muted">{emptyLabel}</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {slices.map((slice, index) => (
            <li key={slice.key}>
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/?${linkParam}=${encodeURIComponent(slice.key)}`}
                  className="truncate text-[13.5px] font-medium text-text hover:text-accent hover:underline"
                  title={slice.key}
                >
                  {slice.key}
                </Link>
                <span className="shrink-0 font-mono text-[13px] tabular-nums text-text">
                  {formatMoney(slice.amount)}
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-2.5">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (slice.amount / leader) * 100)}%`,
                      background: `var(--chart-${(index % 8) + 1})`,
                    }}
                  />
                </div>
                <span className="w-[8.5ch] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-text-subtle">
                  {slice.share.toFixed(1)}% · {slice.count}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
