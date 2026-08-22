import {
  Baby,
  Bed,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Camera,
  Car,
  Cat,
  Coins,
  Dog,
  Dumbbell,
  Gamepad2,
  Gem,
  Gift,
  GraduationCap,
  Guitar,
  Hammer,
  Headphones,
  House,
  Laptop,
  Motorbike,
  Mountain,
  Palette,
  PiggyBank,
  PlaneTakeoff,
  ShieldHalf,
  Ship,
  Shirt,
  Smartphone,
  Sofa,
  Sprout,
  Stethoscope,
  Tent,
  Ticket,
  TrainFront,
  TreePalm,
  Utensils,
  Wine,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Which glyph a savings goal wears, guessed from its name.
 *
 * There is no icon picker. It would be a second thing to fill in for every
 * goal, and the name already says what the goal is — "Ferien" and "Holiday"
 * both want the same picture. The guess is deliberately generous with German,
 * because the app is Swiss and half the names people type will be.
 *
 * lucide, the same library every other icon in the app comes from. This used to
 * be Font Awesome, for one component, which meant carrying a second dependency
 * and a second drawing convention so that one glyph could look unlike every
 * other glyph in the product.
 */

/**
 * Every glyph a pot can wear.
 *
 * **One map, two jobs.** The keyword rules below pick from it, and
 * `lib/llm/suggest-goal-icon.ts` offers its keys to the model as the only
 * answers it may give. That is what makes it impossible for the model to name
 * a picture this file cannot draw — the allowlist is not a copy of the render
 * table, it *is* the render table.
 *
 * The first nineteen are what the rules use; the rest are there for the model,
 * covering the goals a keyword table never will — a pet, a season ticket, a
 * hobby. Keys are lucide's own names, which is also what is stored in
 * `savings_goals.icon`.
 */
export const GOAL_ICONS = {
  Baby,
  Bed,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Camera,
  Car,
  Cat,
  Coins,
  Dog,
  Dumbbell,
  Gamepad2,
  Gem,
  Gift,
  GraduationCap,
  Guitar,
  Hammer,
  Headphones,
  House,
  Laptop,
  Motorbike,
  Mountain,
  Palette,
  PiggyBank,
  PlaneTakeoff,
  ShieldHalf,
  Ship,
  Shirt,
  Smartphone,
  Sofa,
  Sprout,
  Stethoscope,
  Tent,
  Ticket,
  TrainFront,
  TreePalm,
  Utensils,
  Wine,
  Wrench,
} satisfies Record<string, LucideIcon>;

export type GoalIconName = keyof typeof GOAL_ICONS;

/** A stored name is only a name until it is one of ours. */
export function isGoalIconName(value: string): value is GoalIconName {
  return Object.hasOwn(GOAL_ICONS, value);
}

/**
 * Matched in order, so a more specific rule wins: "Motorrad" has to reach
 * `Motorbike` before "rad" hands it a bicycle.
 */
const RULES: [readonly string[], LucideIcon][] = [
  [
    ["holiday", "vacation", "ferien", "urlaub", "beach", "strand", "sommer", "summer"],
    GOAL_ICONS.TreePalm,
  ],
  [
    // Ahead of the travel rule: "Investment" has nothing to do with a trip,
    // but plenty of portfolio names ("ETF Sparplan") would otherwise fall
    // through to the piggy bank.
    [
      "investment", "investieren", "investition", "invest", "aktien", "stocks",
      "etf", "depot", "börse", "boerse", "fonds", "rendite", "portfolio",
      "crypto", "krypto", "bitcoin", "vorsorge", "säule", "saeule", "pension",
    ],
    GOAL_ICONS.Coins,
  ],
  [["flight", "flug", "reise", "travel", "trip", "japan", "usa"], GOAL_ICONS.PlaneTakeoff],
  [["motorrad", "motorcycle", "roller", "vespa", "scooter"], GOAL_ICONS.Motorbike],
  [["car", "auto", "wagen", "fahrzeug", "tesla", "van"], GOAL_ICONS.Car],
  [
    ["computer", "laptop", "pc", "mac", "macbook", "notebook", "rechner"],
    GOAL_ICONS.Laptop,
  ],
  [["phone", "handy", "iphone", "smartphone", "mobile"], GOAL_ICONS.Smartphone],
  [["camera", "kamera", "foto", "photo", "lens"], GOAL_ICONS.Camera],
  [["house", "haus", "home", "wohnung", "flat", "apartment", "eigenheim"], GOAL_ICONS.House],
  [["furniture", "möbel", "moebel", "sofa", "couch", "kitchen", "küche"], GOAL_ICONS.Sofa],
  [["bike", "velo", "fahrrad", "bicycle", "rad"], GOAL_ICONS.Bike],
  [["wedding", "hochzeit", "ring", "verlobung"], GOAL_ICONS.Gem],
  [["baby", "kind", "child", "kita"], GOAL_ICONS.Baby],
  [["study", "studium", "school", "schule", "uni", "course", "kurs"], GOAL_ICONS.GraduationCap],
  [["guitar", "gitarre", "piano", "klavier", "music", "musik"], GOAL_ICONS.Guitar],
  [["gift", "geschenk", "present", "weihnachten", "christmas"], GOAL_ICONS.Gift],
  [["renovation", "renovation", "umbau", "repair", "reparatur", "tools"], GOAL_ICONS.Wrench],
  [
    ["emergency", "notgroschen", "reserve", "rainy", "puffer", "buffer", "insurance"],
    GOAL_ICONS.ShieldHalf,
  ],
];

/** The fallback. A pot with no guessable name is still a pot of money. */
export const DEFAULT_GOAL_ICON = GOAL_ICONS.PiggyBank;

/**
 * Whether a name mentions a keyword.
 *
 * Long keywords match anywhere, so "Ferienkasse" still finds "ferien". Short
 * ones have to be a whole word, or two letters go hunting through unrelated
 * names — "pc" inside "Upcycling", "rad" inside "Konrad".
 */
function mentions(words: string[], name: string): boolean {
  const tokens = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((word) =>
    word.length >= 4 ? name.includes(word) : tokens.includes(word),
  );
}

/**
 * What the keyword rules alone make of a name, or `null` for a name they have
 * nothing to say about.
 *
 * Separate from `goalIcon` because "the rules missed" is the question
 * `createSavingsGoal` asks before spending a request on the model — folding the
 * fallback in here would make every goal look like a match.
 */
export function matchGoalIcon(name: string): LucideIcon | null {
  const haystack = name.toLowerCase();
  for (const [words, icon] of RULES) {
    if (mentions([...words], haystack)) return icon;
  }
  return null;
}

/**
 * The glyph a pot draws: a stored name first, then the rules, then the pot.
 *
 * `stored` is `savings_goals.icon` — what the model named for a goal the rules
 * could not place. It is checked against `GOAL_ICONS` rather than trusted,
 * exactly as `anomalyIcon` falls back rather than trusting a stored icon name:
 * a hand-edited row must not be able to take a page down.
 *
 * In practice the first two branches never disagree, because a name the rules
 * match is a name the model was never asked about.
 */
export function goalIcon(name: string, stored?: string | null): LucideIcon {
  if (stored && isGoalIconName(stored)) return GOAL_ICONS[stored];
  return matchGoalIcon(name) ?? DEFAULT_GOAL_ICON;
}
