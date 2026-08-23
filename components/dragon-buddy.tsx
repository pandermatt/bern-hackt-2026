import { useTranslations } from "next-intl";

import type { DragonMood } from "@/lib/nudges";
import { DRAGON_SRC } from "@/lib/nudges";

/**
 * The dragon, saying one thing, anywhere that is not the entry page.
 *
 * `NudgeStack` is the other half of this idea and stays separate: it holds a
 * *deck* that fans out, so it owns open/closed state, the trail of nubs aimed
 * at the mascot's head, and a client boundary. This is the flat case — one
 * mood, one line — which needs none of that and so stays a server component
 * with no JavaScript at all.
 *
 * Laid out side by side rather than bubble-over-mascot, because it sits under
 * a page heading rather than at the bottom of a column: the reader is on their
 * way *down* into the page, and a tall mascot block between the title and the
 * content pushes the content off the screen.
 *
 * The bubble carries its own `bg-surface`. On `/budget` and `/anomalies` that
 * is the page's own ground, but on anything with a fill behind it the rule
 * from `/home` applies — Pistachio is 2:1 on white and a fill, never a surface
 * for type — so the ground travels with the text rather than being assumed.
 */
export function DragonBuddy({
  mood,
  line,
  note,
}: {
  mood: DragonMood;
  /** The one sentence. Kept short — this is an aside, not a paragraph. */
  line: string;
  /** An optional second line, for a figure worth naming. */
  note?: string;
}) {
  // `useTranslations`, not `getTranslations`: a *synchronous* server component,
  // so the hook works — same call shape as `SavingsGoals`.
  //
  // The alt text is read here rather than passed in, because it describes the
  // *drawing*, not the page. Three callers inventing their own wording for the
  // same four pictures is three chances to describe a coin as a celebration.
  const t = useTranslations("Home");

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      {/* A plain `<img>`, like `merchant-avatar.tsx` and the entry page's
          mascot: a small asset already at its final size on our own origin.
          `next/image` would add a `/_next/image` round trip to save nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={DRAGON_SRC[mood]}
        alt={t(`dragonAlt.${mood}`)}
        width={512}
        height={512}
        className="dragon-bob h-16 w-16 shrink-0 drop-shadow-sm sm:h-20 sm:w-20"
      />

      <div className="min-w-0 flex-1 rounded-lg bg-surface px-3.5 py-2.5 shadow-sm">
        <p className="text-[13.5px] leading-snug font-medium text-text">{line}</p>
        {note && (
          <p className="mt-0.5 font-mono text-[11.5px] tabular-nums text-text-muted">
            {note}
          </p>
        )}
        {/* Decorative only, and `aria-hidden` for it: the ten hues carry no
            meaning here, which is exactly why the ramp is safe to use as a
            sweep. Nothing reads it, so nothing depends on telling the fills
            apart — the objection that makes six of them unusable as type. */}
        <div className="rainbow-rule mt-2" aria-hidden />
      </div>
    </div>
  );
}
