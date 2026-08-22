
import { Link } from "@/i18n/navigation";
import { SIGNET_PATH, SIGNET_VIEWBOX } from "@/lib/signet";
import { site } from "@/lib/site";

/**
 * The signet tile on its own. Exported because the footer sets the wordmark in
 * its own type and does not link it — the header's `Logo` is a link with
 * width-dependent hiding, neither of which belongs down there.
 *
 * `pathLength={1}` normalizes the signet outline to a 0–1 range so the
 * `trend-draw` keyframes (globals.css) can animate dashoffset without knowing
 * the path's real length. The stroke is only drawn while the animation runs, so
 * the resting state — a solid teal signet — is unchanged.
 */
export function LogoMark() {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-brand">
      <svg viewBox={SIGNET_VIEWBOX} className="h-4 w-auto" aria-hidden>
        <path d={SIGNET_PATH} fill="var(--accent)" />
        <path
          d={SIGNET_PATH}
          pathLength={1}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.2"
          className="group-hover:[animation:trend-draw_0.6s_ease-out]"
        />
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
 */
export function Logo({ href = "/" }: { href?: "/" | "/home" }) {
  return (
    <Link href={href} className="group flex min-h-10 items-center gap-2.5 sm:min-h-0">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-text">
        {/* The wordmark is the first thing to go on a phone: at 402px this
            header also has to carry four nav tabs and the account controls,
            and the signet on its own is a sufficient logo. The `sr-only` name
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
