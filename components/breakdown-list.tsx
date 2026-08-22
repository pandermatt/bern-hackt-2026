import { Section } from "@/components/section";
import { Link } from "@/i18n/navigation";
import { formatMoney, type Slice } from "@/lib/insights";

/**
 * A ranked list with a proportional bar per row.
 *
 * A plain `<div>` whose width is a percentage, not SVG: this is a bar chart
 * that reflows with the text beside it, which HTML does better than a viewBox.
 *
 * It used to serve two callers — a category breakdown and this one. The
 * category list ("Where it goes") was a second telling of the donut directly
 * above it and has been dropped, which is why there is no longer a `slots`
 * prop: colouring by rank is only defensible when the colour is decoration, and
 * for merchants it is — there is no chart up the page for it to disagree with.
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
  linkParam: "categories" | "merchant";
  emptyLabel: string;
}) {
  // Bars are scaled against the leader, not the total: with a long tail, a
  // share-scaled bar for rank 8 is a sliver nobody can compare.
  const leader = slices[0]?.amount ?? 1;

  return (
    <Section id={linkParam} heading={heading} panelClassName="p-4 sm:p-5">
      {slices.length === 0 ? (
        <p className="text-[13.5px] text-text-muted">{emptyLabel}</p>
      ) : (
        /* Two columns from `sm` up. Each row is self-contained — name against
           amount on one baseline, bar and share below — so it tiles without
           further change, and the panel comes out roughly half as tall as the
           single column it replaced. `gap-x-8` keeps the two columns' bars from
           reading as one continuous track. */
        <ol className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {slices.map((slice, index) => (
            <li key={slice.key}>
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/?${linkParam}=${encodeURIComponent(slice.key)}`}
                  className="-my-2 truncate py-2 text-[13.5px] font-medium text-text hover:text-accent hover:underline sm:my-0 sm:py-0"
                  title={slice.key}
                >
                  {slice.key}
                </Link>
                <span className="shrink-0 font-mono text-[13px] tabular-nums text-text">
                  {formatMoney(slice.amount)}
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-2.5">
                {/* `bg-surface`, not `bg-surface-muted`: the panel behind this
                    is now that same grey, and a track filled with its own
                    ground is no track at all. */}
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (slice.amount / leader) * 100)}%`,
                      background: `var(--chart-${(index % 10) + 1})`,
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
    </Section>
  );
}
