"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * How long a ticked-off finding takes to leave, in milliseconds.
 *
 * The element transitions for exactly this and `ResolveToggle` waits it out
 * before it asks the server for anything, so the two have to agree — which is
 * why the number lives here rather than in either of them.
 */
export const RESOLVE_FADE_MS = 220;

/** What a `ResolveToggle` inside a wrapper can do to it. */
type ResolveFadeControl = {
  /** Play the leaving, and resolve once it has finished playing. */
  leave: () => Promise<void>;
  /** Put it back — for the action that came back an error after all. */
  restore: () => void;
};

const FadeContext = createContext<ResolveFadeControl | null>(null);

/**
 * The wrapper a `ResolveToggle` should fade on its way out, or `null` when what
 * it ticks off is staying on the page — which is the whole of the "should I
 * animate" decision the toggle has to make.
 */
export function useResolveFade() {
  return useContext(FadeContext);
}

/**
 * Wraps something that leaves the page when it is resolved, and hands the
 * `ResolveToggle` inside it the fade to play on the way out.
 *
 * Resolved findings are hidden by default, so ticking one off used to make it
 * vanish the instant the new page landed and drop everything below it up the
 * screen — the reader loses the row they just acted on with no sense that they
 * are the reason it went. Here the row dims and closes up first, and the
 * removal lands on markup that is already invisible.
 *
 * **The context is what scopes it.** A row wraps its own `<li>` and a group
 * wraps its heading and rows together, so a toggle simply fades the nearest
 * wrapper around it: the row's circle takes the row, the heading's circle takes
 * the whole group, and the page header's "resolve all" — outside every wrapper
 * — gets `null` and does what it always did.
 *
 * `enabled` is false while the resolved rows are being shown: nothing leaves in
 * that state, and fading out something the server hands straight back is a
 * flicker rather than an animation.
 *
 * The collapse is `grid-template-rows: 1fr → 0fr`, the same trick the nudge
 * deck opens with — it interpolates natively, so a row of unknown height closes
 * with no measuring, and the inner `overflow-hidden` is what makes the content
 * clip as the row does. Opacity is set inline rather than as a class because a
 * resolved row already carries `opacity-60`, and two opacity utilities on one
 * element are settled by the order Tailwind emits them in, not by the order
 * they are written.
 */
export function ResolveFade({
  as: Tag = "div",
  enabled = true,
  className = "",
  children,
}: {
  as?: "li" | "div";
  /** False when the thing stays on the page — then there is nothing to play. */
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const control = useMemo<ResolveFadeControl>(
    () => ({
      leave: () => {
        setLeaving(true);
        // `globals.css` already collapses the transition to instant for a
        // reader who asked for no motion; without the same check here the
        // caller would still wait out the full delay with nothing left to
        // wait for.
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          return Promise.resolve();
        }
        return new Promise<void>((done) => {
          timer.current = setTimeout(done, RESOLVE_FADE_MS);
        });
      },
      restore: () => {
        clearTimeout(timer.current);
        setLeaving(false);
      },
    }),
    [],
  );

  return (
    <FadeContext.Provider value={enabled ? control : null}>
      <Tag
        // Clipped to nothing is not the same as gone: without `inert` the
        // toggle inside an invisible row keeps its place in the tab order for
        // however long the write takes.
        inert={leaving}
        className={`grid transition-[grid-template-rows,opacity] ease-out ${className}`}
        style={{
          gridTemplateRows: leaving ? "0fr" : "1fr",
          opacity: leaving ? 0 : undefined,
          transitionDuration: `${RESOLVE_FADE_MS}ms`,
        }}
      >
        <div className="overflow-hidden">{children}</div>
      </Tag>
    </FadeContext.Provider>
  );
}
