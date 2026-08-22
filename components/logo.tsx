
import { Link } from "@/i18n/navigation";
import { SIGNET_PATH, SIGNET_VIEWBOX } from "@/lib/signet";
import { site } from "@/lib/site";

/* `pathLength={1}` normalizes the signet outline to a 0–1 range so the
   `trend-draw` keyframes (globals.css) can animate dashoffset without knowing
   the path's real length. The stroke is only drawn while the animation runs, so
   the resting state — a solid teal signet — is unchanged. */
function Mark() {
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

export function Logo() {
  return (
    <Link href="/" className="group flex min-h-10 items-center gap-2.5 sm:min-h-0">
      <Mark />
      <span className="text-[15px] font-semibold tracking-tight text-text">
        <span aria-hidden="true" className="inline-flex items-center">
          {site.name}
        </span>
        <span className="sr-only">{site.name}</span>
      </span>
    </Link>
  );
}
