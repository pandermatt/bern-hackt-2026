import { BrandTint } from "@/components/brand-tint";
import { MerchantAvatar } from "@/components/merchant-avatar";
import { Section } from "@/components/section";
import { Link } from "@/i18n/navigation";
import { formatMoney, type Slice } from "@/lib/insights";

/**
 * A ranked list where each entry *is* its bar: one 36px row per merchant, mark
 * and name sitting inside a fill whose width is the share and whose colour is
 * the mark's own.
 *
 * A plain `<div>` whose width is a percentage, not SVG: this is a bar chart
 * that reflows with the text beside it, which HTML does better than a viewBox.
 *
 * It used to serve two callers — a category breakdown and this one. The
 * category list ("Where it goes") was a second telling of the donut directly
 * above it and has been dropped, which is why there is no longer a `slots`
 * prop: colouring by rank is only defensible when the colour is decoration, and
 * for merchants it is — there is no chart up the page for it to disagree with.
 * The brand tint goes further in the same direction: a colour that *identifies*
 * the merchant cannot be read as a category, which is the confusion the rank
 * colouring was always one glance away from.
 *
 * It used to stack name-over-bar in two lines per entry. Folding them into one
 * lane took the panel from ~50px a row to 42 and removed the reading order
 * problem that came with the split — the name and the bar it belonged to were
 * different objects, and at `gap-y-3` in two columns it was not always obvious
 * which bar went with which name.
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
    <Section id={linkParam} heading={heading} panelClassName="p-3 sm:p-4">
      {slices.length === 0 ? (
        <p className="text-[13.5px] text-text-muted">{emptyLabel}</p>
      ) : (
        /* Two columns from `sm` up, each row self-contained, so the panel comes
           out roughly half as tall as the single column it replaced. `gap-x-3`
           is enough to part them now that every row carries its own filled
           box — there is no bare track left for the eye to run together. */
        <ol className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
          {slices.map((slice, index) => (
            <li key={slice.key}>
              {/* Falls back to a ramp slot for a merchant with no mark, or one
                  whose mark is monochrome. */}
              <BrandTint fallback={`var(--chart-${(index % 10) + 1})`}>
                <Link
                  href={`/?${linkParam}=${encodeURIComponent(slice.key)}`}
                  /* `bg-surface`, not `bg-surface-muted`: the panel behind this
                     is that same grey, and a track filled with its own ground
                     is no track at all. */
                  className="group relative flex h-9 items-center gap-2 overflow-hidden rounded-md bg-surface pr-2.5 pl-2 hover:ring-1 hover:ring-line-strong"
                  title={`${slice.key} · ${slice.share.toFixed(1)}% · ${slice.count}`}
                >
                  {/* The bar. Mixed into the track rather than laid over it, so
                      an arbitrary brand hue lands at a lightness `--text` can
                      be read against — on both themes, because `--surface` is
                      what moves between them. Type therefore stays the page's
                      own ink and never flips to white-on-brand, which no
                      extracted colour could guarantee. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 transition-[background-color] duration-300"
                    style={{
                      width: `${Math.max(3, (slice.amount / leader) * 100)}%`,
                      background:
                        "color-mix(in oklab, var(--tint) 40%, var(--surface))",
                    }}
                  />

                  {/* `items-center`, not `items-baseline`: a flex container's
                      baseline is its first item's, and a bare <img>'s baseline
                      is its bottom edge — the amount would drop by most of the
                      tile's height. At 13.5px against 13px the visual cost is
                      under a pixel. */}
                  <MerchantAvatar
                    name={slice.key}
                    size={20}
                    className="relative"
                  />
                  <span className="relative min-w-0 flex-1 truncate text-[13.5px] font-medium text-text group-hover:underline">
                    {slice.key}
                  </span>
                  <span className="relative shrink-0 font-mono text-[13px] tabular-nums text-text">
                    {formatMoney(slice.amount)}
                  </span>
                  <span className="relative w-[8.5ch] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-text-subtle">
                    {slice.share.toFixed(1)}% · {slice.count}
                  </span>
                </Link>
              </BrandTint>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
