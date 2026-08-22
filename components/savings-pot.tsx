import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
import { createElement, type CSSProperties } from "react";

import { SavingsGoalDelete } from "@/components/savings-goal-delete";
import { SavingsGoalEdit } from "@/components/savings-goal-edit";
import { goalIcon } from "@/lib/goal-icon";
import {
  formatDay,
  formatMoney,
  potFill,
  potPercent,
  type SavingsPot as Pot,
} from "@/lib/insights";

/**
 * One savings goal, drawn as a pot that fills.
 *
 * Inline SVG in a server component rather than a chart: this is one number
 * between 0 and 1, and reaching for the ECharts boundary to draw it would put
 * a hydration boundary and a canvas around a rectangle. The jar is a
 * `clipPath`; the money is a rect whose top edge moves, capped with an ellipse
 * so the level reads as a surface rather than a cut.
 *
 * The fill takes the goal's palette slot from `potSlot`, which is keyed on the
 * row id — so a pot keeps its colour when the one above it is deleted.
 *
 * `celebrating` and `sparks` are decided by `PotSlot` in
 * `savings-pots-grid.tsx`, which watches for the moment a pot's fill first
 * reaches 100% — this component draws the pot identically regardless, it
 * only adds the burst and a glow in the pot's own colour when told to. It
 * stays false on every ordinary render, including the one where a pot is
 * *already* full, so reloading the page never replays a celebration that
 * already happened.
 */

/* Cylinder geometry, in viewBox units. `RY` is the perspective squash: the
   same ellipse is reused for the mouth, the liquid's surface and the base, so
   the whole vessel is drawn from one viewing angle. */
const CX = 60;
const RX = 40;
const RY = 11;
const MOUTH_Y = 22;
const BASE_Y = 104;
/** The glyph's centre — the wall's midpoint, clear of both ellipses. */
const ICON_CENTRE_Y = (MOUTH_Y + BASE_Y) / 2;

/* The glyph's box. Square, because every lucide icon is 24x24 — the fitting
   maths this used to carry existed only for Font Awesome, whose boxes are not
   (`fa-laptop` is 640x512, and forcing that into a square squashed it). */
const ICON_BOX = 34;
const ICON_X = CX - ICON_BOX / 2;
const ICON_Y = ICON_CENTRE_Y - ICON_BOX / 2;

/** The pot's silhouette: two walls closed by the base ellipse. */
const BODY =
  `M ${CX - RX} ${MOUTH_Y} L ${CX - RX} ${BASE_Y} ` +
  `A ${RX} ${RY} 0 0 0 ${CX + RX} ${BASE_Y} ` +
  `L ${CX + RX} ${MOUTH_Y} Z`;

/* The lid a finished pot gets. It overhangs the mouth by `LID_LIP` — a lid
   flush with the wall reads as a plate balanced on top rather than a seal. */
const LID_LIP = 3.5;
const LID_RX = RX + LID_LIP;
const LID_Y = MOUTH_Y - 2;
const LID_SKIRT = 7;

const LID_BAND =
  `M ${CX - LID_RX} ${LID_Y} L ${CX - LID_RX} ${LID_Y + LID_SKIRT} ` +
  `A ${LID_RX} ${RY} 0 0 0 ${CX + LID_RX} ${LID_Y + LID_SKIRT} ` +
  `L ${CX + LID_RX} ${LID_Y} Z`;

/**
 * One spark in the burst a pot gets the moment it first reaches its target.
 *
 * Rolled in `PotSlot` (`savings-pots-grid.tsx`), not here: `Math.random` is
 * impure, and the only place in this component tree already doing impure work
 * in an effect — timing the celebration's own end with `setTimeout` — is
 * there. This component only ever renders whatever list it is handed.
 */
export type Spark = { angle: number; distance: number; delay: number; colour: string };

export function SavingsPot({
  pot,
  celebrating = false,
  sparks = [],
  sealed,
}: {
  pot: Pot;
  celebrating?: boolean;
  sparks?: Spark[];
  /**
   * Whether to draw the lid. Defaults to the pot's real fill — a page load
   * has nothing to sequence against, so an already-full pot is simply drawn
   * sealed. `PotSlot` overrides this while a fill is in flight: it holds the
   * lid open for `LIQUID_ANIMATION_MS` after the pot actually reaches its
   * target, so the liquid is seen rising all the way to the rim *before* the
   * lid closes over it and the celebration fires, rather than the lid
   * snapping shut over a level that is still visibly climbing underneath it.
   */
  sealed?: boolean;
}) {
  // Synchronous server component, so the hook works here — see `SavingsGoals`.
  const t = useTranslations("Savings");
  const fill = potFill(pot.savedMinor, pot.targetMinor);
  // The drawing clamps because a jar has a rim; the label does not, so a pot
  // funded past its target says 133% rather than a flat, less useful 100%.
  const percent = potPercent(pot.savedMinor, pot.targetMinor);
  const full = fill >= 1;
  const lidVisible = sealed ?? full;
  // Where the liquid's surface sits. Measured between the two ellipse centres,
  // so an empty pot's surface is the base and a full one's is the mouth.
  const surface = BASE_Y - (BASE_Y - MOUTH_Y) * fill;
  // The pots' own muted ramp, not `--chart-N`. A jar is a large block of flat
  // colour sitting next to nine others, where a chart wedge is a thin slice
  // read against a legend — the full-strength ramp made the grid shout and put
  // near-white and near-black side by side. See `--pot-N` in `globals.css`.
  const colour = `var(--pot-${pot.slot})`;
  // The name is the guess; `pot.icon` is what the model named for a goal the
  // keyword rules could not place, and it wins when it is there.
  const icon = goalIcon(pot.name, pot.icon);

  // Ids have to be unique per pot or every jar clips against the first one's
  // path. The row id is already unique per account.
  const bodyClip = `pot-body-${pot.id}`;
  const dryClip = `pot-dry-${pot.id}`;
  const wetClip = `pot-wet-${pot.id}`;

  return (
    /* `h-full` so every pot in a row is the same height. The `<li>` around
       this in `savings-pots-grid.tsx` is a grid item and already stretches to
       the tallest cell in its row, but this card is a *child* of it and sized
       itself, so a goal whose "von CHF 100'000.00 · 11%" line wrapped left the
       cards beside it visibly short. The bar below then takes `mt-auto`, which
       is what puts every card's bar on one baseline rather than leaving the
       gap under it — and comparing lengths on a shared baseline is the whole
       reason that bar exists next to the jar. */
    <div className="relative flex h-full flex-col items-center rounded-lg border border-line bg-surface px-3 pt-3 pb-4 text-center">
      {/* Always visible rather than revealed on hover: a hover affordance is
          not reachable on a touch screen. Retarget on the left, delete on the
          right — the reversible action and the irreversible one as far apart
          as the card allows. */}
      <span className="absolute top-1.5 left-1.5">
        <SavingsGoalEdit
          id={pot.id}
          name={pot.name}
          targetMinor={pot.targetMinor}
          savedMinor={pot.savedMinor}
          targetOn={pot.targetOn}
        />
      </span>
      <span className="absolute top-1.5 right-1.5">
        <SavingsGoalDelete
          id={pot.id}
          name={pot.name}
          savedMinor={pot.savedMinor}
        />
      </span>

      {celebrating && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {sparks.map((spark, index) => (
            <span
              key={index}
              className="pot-spark"
              style={
                {
                  "--spark-angle": `${spark.angle}deg`,
                  "--spark-distance": `${spark.distance}px`,
                  "--spark-delay": `${spark.delay}ms`,
                  "--spark-colour": spark.colour,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      <svg
        viewBox="0 0 120 128"
        className={`h-[118px] w-[110px] shrink-0 ${celebrating ? "pot-glow" : ""}`}
        style={celebrating ? ({ "--pot-glow-colour": colour } as CSSProperties) : undefined}
        role="img"
        aria-label={`${pot.name}: ${formatMoney(pot.savedMinor)} of ${formatMoney(
          pot.targetMinor,
        )} saved, ${percent} per cent full.`}
      >
        <defs>
          <clipPath id={bodyClip}>
            <path d={BODY} />
          </clipPath>
          <clipPath id={dryClip}>
            <rect className="pot-liquid" x="0" y="0" width="120" height={surface} />
          </clipPath>
          <clipPath id={wetClip}>
            <rect className="pot-liquid" x="0" y={surface} width="120" height={128 - surface} />
          </clipPath>
        </defs>

        {/* Contact shadow. Grounds the pot instead of letting it float. */}
        <ellipse
          cx={CX}
          cy={BASE_Y + RY + 3}
          rx={RX - 4}
          ry="4"
          fill="var(--chart-ink)"
          opacity="0.10"
        />

        {/* The empty vessel, so an unfunded pot still reads as a pot. */}
        <path d={BODY} fill="var(--surface-muted)" />

        <g clipPath={`url(#${bodyClip})`}>
          {/* An empty pot is empty: at zero the surface sits on the base
              ellipse's centre, and drawing from there down still paints a
              crescent along the floor. */}
          {fill > 0 && (
            <>
              {/* Money, from the surface down. `pot-liquid` is what makes a
                  deposit or a withdrawal read as the level actually rising or
                  falling rather than the card just redrawing — see the class
                  in globals.css for why a CSS transition is enough here with
                  no client JS. */}
              <rect
                className="pot-liquid"
                x="0"
                y={surface}
                width="120"
                height={BASE_Y + RY}
                fill={colour}
              />
              {/* The surface itself, lifted with a white wash — the same trick
                  the light catches on a real liquid, and it is what turns a
                  flat block into a level. Lighter-handed than it was: the
                  muted fills start much closer to the body than the chart ramp
                  did, so the wash that used to lift the level was washing it
                  out instead. */}
              <ellipse className="pot-liquid" cx={CX} cy={surface} rx={RX} ry={RY} fill={colour} />
              <ellipse
                className="pot-liquid"
                cx={CX}
                cy={surface}
                rx={RX}
                ry={RY}
                fill="#ffffff"
                opacity="0.14"
              />
            </>
          )}
          {/* A soft inner shadow down the left wall, so the cylinder turns. */}
          <rect
            x={CX - RX}
            y={MOUTH_Y}
            width="12"
            height={BASE_Y + RY}
            fill="var(--chart-ink)"
            opacity="0.06"
          />
        </g>

        {/* The glyph is drawn on the pot wall at a fixed height, so the level
            rises past it as the goal fills. That means it has to survive being
            underwater: it is drawn twice, clipped at the surface. Above it is
            `--accent`, the template's teal. Below it switches to `--chart-ink`
            — the brand teal is a teal, and three of the ten fills are teals, so
            an accent glyph disappeared into its own liquid. Ink only ever
            darkens whatever it lands on, and the wet copy sits heavier than the
            dry one because a stroked glyph has far less ink to lose to opacity
            than the filled silhouette this used to be.

            A lucide icon is a nested `<svg>`: it carries its own
            `viewBox="0 0 24 24"`, so `x`/`y`/`size` place and scale it in the
            pot's coordinates with no transform of our own. The clip stays on
            the group around it — a clipPath is resolved in the user space of
            the element referencing it, so putting it on the icon would scale
            the waterline with the glyph. */}
        <g clipPath={`url(#${dryClip})`}>
          {createElement(icon, {
            x: ICON_X,
            y: ICON_Y,
            size: ICON_BOX,
            color: "var(--accent)",
            opacity: 0.9,
          })}
        </g>
        <g clipPath={`url(#${wetClip})`}>
          {createElement(icon, {
            x: ICON_X,
            y: ICON_Y,
            size: ICON_BOX,
            color: "var(--chart-ink)",
            opacity: 0.6,
          })}
        </g>

        {/* Outline last, so the walls read as edges over the fill. */}
        <path d={BODY} fill="none" stroke="var(--line-strong)" strokeWidth="1.6" />

        {lidVisible ? (
          // A reached goal gets sealed. The lid is the same material as the
          // pot rather than the goal's colour: it should read as "this one is
          // closed", and a second tinted shape competes with the fill for that.
          <g>
            <path
              d={LID_BAND}
              fill="var(--surface-muted)"
              stroke="var(--line-strong)"
              strokeWidth="1.6"
            />
            <ellipse
              cx={CX}
              cy={LID_Y}
              rx={LID_RX}
              ry={RY}
              fill="var(--surface)"
              stroke="var(--line-strong)"
              strokeWidth="1.6"
            />
            {/* The knob sits above the lid's crown — anywhere lower and the
                top ellipse simply paints over it. */}
            <rect
              x={CX - 6.5}
              y={LID_Y - RY - 5}
              width="13"
              height="8"
              rx="4"
              fill="var(--surface)"
              stroke="var(--line-strong)"
              strokeWidth="1.6"
            />
          </g>
        ) : (
          // The mouth: the rim, and the inside of the far wall showing through.
          <>
            <ellipse
              cx={CX}
              cy={MOUTH_Y}
              rx={RX}
              ry={RY}
              fill="var(--surface)"
              stroke="var(--line-strong)"
              strokeWidth="1.6"
            />
            <ellipse
              cx={CX}
              cy={MOUTH_Y + 1.5}
              rx={RX - 5}
              ry={RY - 3.5}
              fill="var(--surface-muted)"
            />
          </>
        )}
      </svg>

      <p className="mt-2 line-clamp-2 text-[13.5px] leading-snug font-semibold text-text">
        {pot.name}
      </p>

      <Amount minor={pot.savedMinor} full={full} />

      <p className="mt-0.5 font-mono text-[11.5px] tabular-nums text-text-subtle">
        {t("potOfTarget", { target: formatMoney(pot.targetMinor) })} · {percent}%
      </p>

      {/* The deadline the pots are ordered by, so the order is legible rather
          than mysterious. */}
      <p className="mt-1 mb-2 flex items-center justify-center gap-1 text-[11px] text-text-subtle">
        <CalendarDays className="size-3" aria-hidden />
        {pot.targetOn ? t("potDue", { date: formatDay(pot.targetOn) }) : t("potNoDue")}
      </p>

      {/* The same number the pot draws, as a bar. A cylinder is a poor
          instrument for reading a proportion — the eye is much better at
          comparing lengths on a shared baseline than areas in a jar — so the
          pot carries the identity and this carries the precision. */}
      <div
        /* `mt-auto`, not `mt-2`: the auto margin swallows whatever slack
           `h-full` leaves a shorter card, which is what puts every bar in the
           row on one baseline. The gap above it comes from the `mb-2` on the
           line before — margins do not collapse in a flex container, so that
           one is a floor the auto margin adds to rather than replaces. */
        className="mt-auto h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        aria-hidden
      >
        <div
          className="h-full rounded-full transition-[width] duration-[650ms] ease-out"
          style={{ width: `${Math.max(fill * 100, fill > 0 ? 3 : 0)}%`, background: colour }}
        />
      </div>
    </div>
  );
}

/**
 * "CHF 1'074.00" split so the code can sit quiet beside a loud number.
 *
 * de-CH joins them with a non-breaking space, which is the seam — and the only
 * one, since `formatMoney` never emits a sign.
 */
function Amount({ minor, full }: { minor: number; full: boolean }) {
  const [code, ...rest] = formatMoney(minor).split(" ");
  return (
    <p className="mt-1 flex items-baseline justify-center gap-1">
      <span className="font-mono text-[10.5px] text-text-subtle">{code}</span>
      <span
        className={`font-mono text-[15px] font-semibold tabular-nums ${
          full ? "text-positive" : "text-accent"
        }`}
      >
        {rest.join(" ")}
      </span>
    </p>
  );
}
