
import { Link } from "@/i18n/navigation";
import { SIGNET_PATHS, SIGNET_VIEWBOX, flameIndex } from "@/lib/signet";
import { site } from "@/lib/site";

/**
 * How far apart two neighbouring colours light up, in milliseconds. Ten steps
 * of this plus the 0.35s each path takes is the whole run — about 0.75s, which
 * is long enough to read as a flame travelling and short enough that letting go
 * of the logo never feels like interrupting something.
 */
const FLAME_STEP_MS = 45;

/**
 * The mark on its own. Exported because the footer sets the wordmark in its own
 * type and does not link it — the header's `Logo` is a link with
 * width-dependent hiding, neither of which belongs down there.
 *
 * **The tile is `--logo-tile`, the fixed white the merchant marks use, not the
 * theme's surface.** The dragon is artwork rather than palette: its greens and
 * its near-black teal tail are the drawing, and neither can be re-tinted for a
 * dark ground — `#025865` is 1.6:1 on `#1c1c1c`. A constant ground is what lets
 * a constant drawing stay legible, the same trade `.on-brand` makes in the
 * other direction, and `ring-line` is what keeps the tile from floating on the
 * dark page. This is also why the tile is no longer Supernova: the coil's whole
 * yellow half, head included, disappeared into it.
 *
 * **The paths are inline rather than an `<img>`** because the hover animates
 * them individually, which nothing outside the document can reach.
 *
 * The stagger runs on `flameIndex`, which orders the *colours* tail-to-head;
 * the paths themselves stay in paint order. `both` as the fill mode is what
 * makes the wait look deliberate — a path holds the dimmed first frame through
 * its delay, so the coil goes dark and re-lights around the ring instead of
 * lighting up out of nowhere.
 */
export function LogoMark() {
  return (
    <span className="grid size-8 shrink-0 place-items-center overflow-clip rounded-lg bg-logo-tile ring-1 ring-line ring-inset">
      <svg viewBox={SIGNET_VIEWBOX} className="size-7" aria-hidden>
        {SIGNET_PATHS.map((path) => (
          <path
            key={path.d}
            d={path.d}
            fill={path.fill}
            style={{ animationDelay: `${flameIndex(path.fill) * FLAME_STEP_MS}ms` }}
            /* Every path scales about the *mark's* centre, never its own —
               `transform-box: view-box` is what makes `50% 50%` mean the
               viewBox rather than each path's own bounding box, and without it
               the coil comes apart into sixty-one twitching flakes. */
            className="[transform-box:view-box] [transform-origin:50%_50%] group-hover:[animation:logo-ignite_0.35s_ease-out_both]"
          />
        ))}
      </svg>
    </span>
  );
}

/**
 * The wordmark, which is also the way home — and "home" is not the same address
 * for everyone. A signed-in reader wants `/home`, the entry page; "/" is the
 * marketing landing and would only bounce them onward. A signed-out visitor
 * wants exactly that landing, and sending *them* to `/home` puts a login form
 * between the logo and the page they are already reading. The header knows
 * which it is looking at, so it decides.
 *
 * `group` here is also what arms the mark's hover — the footer renders
 * `LogoMark` outside one, deliberately: it is not a link and has nothing to
 * respond to.
 */
export function Logo({ href = "/" }: { href?: "/" | "/home" }) {
  return (
    <Link href={href} className="group flex min-h-10 items-center gap-2.5 sm:min-h-0">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-text">
        {/* The wordmark is the first thing to go on a phone: at 402px this
            header also has to carry four nav tabs and the account controls,
            and the mark on its own is a sufficient logo. The `sr-only` name
            below is deliberately outside this, so it survives at every width.

            `app-shell:` brings it back in the installed app, where the tabs
            have moved to the bottom bar and the header has the room again —
            the crowding this hides from is the only reason it hides. */}
        <span
          aria-hidden="true"
          className="hidden items-center sm:inline-flex app-shell:inline-flex"
        >
          {site.name}
        </span>
        <span className="sr-only">{site.name}</span>
      </span>
    </Link>
  );
}
