
import { Link } from "@/i18n/navigation";
import { site } from "@/lib/site";

/**
 * The dragon mark, in the tile that matches the theme.
 *
 * The artwork ships as a light and a dark **app icon** — the same mark on a
 * near-white or a near-black rounded tile — and that tile is the whole of the
 * difference: the bare mark is one file, byte-identical between the two sets.
 * So this is the one place the pair earns its keep, and it brings its own
 * tile: the `bg-logo-tile` + `ring-line` scaffolding the previous, alpha-less
 * artwork needed is gone.
 *
 * Drawn as a background image off `--logo-mark`, not as two `<img>`s toggled
 * with `dark:`. This project has no `@custom-variant dark`, so Tailwind's
 * `dark:` still keys off `prefers-color-scheme` while the app's own switch
 * sets a `.dark` class — a `dark:hidden` mark would follow the operating
 * system and ignore the toggle. The token also fetches one file instead of
 * two, and it is already how every other themed value here works.
 *
 * Decorative: the site name sits beside it, in an `sr-only` span.
 */
function Mark() {
  return (
    <span
      aria-hidden
      className="size-7 shrink-0 rounded-[7px] bg-contain bg-center bg-no-repeat transition-transform duration-200 group-hover:scale-105"
      style={{ backgroundImage: "var(--logo-mark)" }}
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
