import { useTranslations } from "next-intl";

import { SavingsGoalDelete } from "@/components/savings-goal-delete";
import { SavingsGoalEdit } from "@/components/savings-goal-edit";
import { goalIcon, iconPath } from "@/lib/goal-icon";
import {
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

export function SavingsPot({ pot }: { pot: Pot }) {
  // Synchronous server component, so the hook works here — see `SavingsGoals`.
  const t = useTranslations("Savings");
  const fill = potFill(pot.savedMinor, pot.targetMinor);
  // The drawing clamps because a jar has a rim; the label does not, so a pot
  // funded past its target says 133% rather than a flat, less useful 100%.
  const percent = potPercent(pot.savedMinor, pot.targetMinor);
  const full = fill >= 1;
  // Where the liquid's surface sits. Measured between the two ellipse centres,
  // so an empty pot's surface is the base and a full one's is the mouth.
  const surface = BASE_Y - (BASE_Y - MOUTH_Y) * fill;
  const colour = `var(--chart-${pot.slot})`;
  const icon = iconPath(goalIcon(pot.name));

  // Ids have to be unique per pot or every jar clips against the first one's
  // path. The row id is already unique per account.
  const bodyClip = `pot-body-${pot.id}`;
  const dryClip = `pot-dry-${pot.id}`;
  const wetClip = `pot-wet-${pot.id}`;

  // The glyph is drawn on the pot wall at a fixed height, so the level rises
  // past it as the goal fills. That means it has to survive being underwater:
  // it is drawn twice, clipped at the surface. Above it is `--accent`, the
  // template's teal. Below it switches to `--chart-ink` — the brand teal is a
  // teal, and three of the ten fills are teals, so an accent glyph disappeared
  // into its own liquid. Ink only ever darkens whatever it lands on.
  //
  // Fitted to its own box rather than assumed square: `fa-laptop` is 640×512,
  // and forcing that into a square squashes it.
  const ICON_BOX = 34;
  const iconScale = ICON_BOX / Math.max(icon.width, icon.height);
  const iconAt =
    `translate(${CX - (icon.width * iconScale) / 2} ` +
    `${ICON_CENTRE_Y - (icon.height * iconScale) / 2}) scale(${iconScale})`;

  return (
    <div className="relative flex flex-col items-center rounded-lg border border-line bg-surface px-3 pt-3 pb-4 text-center">
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
        />
      </span>
      <span className="absolute top-1.5 right-1.5">
        <SavingsGoalDelete
          id={pot.id}
          name={pot.name}
          savedMinor={pot.savedMinor}
        />
      </span>

      <svg
        viewBox="0 0 120 128"
        className="h-[118px] w-[110px] shrink-0"
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
            <rect x="0" y="0" width="120" height={surface} />
          </clipPath>
          <clipPath id={wetClip}>
            <rect x="0" y={surface} width="120" height={128 - surface} />
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
              {/* Money, from the surface down. */}
              <rect x="0" y={surface} width="120" height={BASE_Y + RY} fill={colour} />
              {/* The surface itself, lifted with a white wash — the same trick
                  the light catches on a real liquid, and it is what turns a
                  flat block into a level. */}
              <ellipse cx={CX} cy={surface} rx={RX} ry={RY} fill={colour} />
              <ellipse
                cx={CX}
                cy={surface}
                rx={RX}
                ry={RY}
                fill="#ffffff"
                opacity="0.22"
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

        {/* The clip has to sit on an *untransformed* group: a clipPath is
            resolved in the user space of the element that references it, so
            clipping the scaled group would scale the waterline with it. */}
        <g clipPath={`url(#${dryClip})`}>
          <g transform={iconAt}>
            <path d={icon.d} fill="var(--accent)" opacity="0.9" />
          </g>
        </g>
        <g clipPath={`url(#${wetClip})`}>
          <g transform={iconAt}>
            <path d={icon.d} fill="var(--chart-ink)" opacity="0.45" />
          </g>
        </g>

        {/* Outline last, so the walls read as edges over the fill. */}
        <path d={BODY} fill="none" stroke="var(--line-strong)" strokeWidth="1.6" />

        {full ? (
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

      {/* The same number the pot draws, as a bar. A cylinder is a poor
          instrument for reading a proportion — the eye is much better at
          comparing lengths on a shared baseline than areas in a jar — so the
          pot carries the identity and this carries the precision. */}
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        aria-hidden
      >
        <div
          className="h-full rounded-full"
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
