
import { Link } from "@/i18n/navigation";
import { site } from "@/lib/site";

/**
 * The dragon mark, on a white tile.
 *
 * The supplied artwork (`res/logos`) is raster and has **no alpha** — it is
 * drawn for a white ground, exactly like the merchant marks in
 * `components/merchant-avatar.tsx`. So it gets the treatment that file already
 * documents: `bg-logo-tile`, which is `#ffffff` in both themes on purpose, and
 * a `ring-line` so the tile does not float on the dark page. Dropped straight
 * onto `--surface` it would be a white square on a #1c1c1c header.
 *
 * This replaced an inline SVG signet that could be filled with `var(--accent)`
 * and stroke-animated on hover. Both went with the vector: a PNG has no path
 * to draw and no fill to re-point. A gentle scale stands in for the flourish;
 * if the dragon is ever redrawn as an SVG, the old animation is worth back.
 */
function Mark() {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/icon-192.png"
      alt=""
      width={192}
      height={192}
      className="size-7 shrink-0 rounded-md bg-logo-tile object-contain ring-1 ring-line transition-transform duration-200 group-hover:scale-105"
    />
  );
}

/**
 * The wordmark, which is also the way home — and "home" is not the same address
 * for everyone. A signed-in reader wants `/home`, the entry page; "/" is the
 * marketing landing and would only bounce them onward. A signed-out visitor
 * wants exactly that landing, and sending *them* to `/home` puts a login form
 * between the logo and the page they are already reading. The header knows
 * which it is looking at, so it decides.
 */
export function Logo({ href = "/" }: { href?: "/" | "/home" }) {
  return (
    <Link href={href} className="group flex min-h-10 items-center gap-2.5 sm:min-h-0">
      <Mark />
      <span className="text-[15px] font-semibold tracking-tight text-text">
        {/* The wordmark is the first thing to go on a phone: at 402px this
            header also has to carry four nav tabs and the account controls,
            and the mark on its own is a sufficient logo. The `sr-only` name
            below is deliberately outside this, so it survives at every width. */}
        <span aria-hidden="true" className="hidden items-center sm:inline-flex">
          {site.name}
        </span>
        <span className="sr-only">{site.name}</span>
      </span>
    </Link>
  );
}
