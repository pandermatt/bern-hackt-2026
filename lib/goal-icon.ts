import { faBaby } from "@fortawesome/free-solid-svg-icons/faBaby";
import { faBicycle } from "@fortawesome/free-solid-svg-icons/faBicycle";
import { faCamera } from "@fortawesome/free-solid-svg-icons/faCamera";
import { faCar } from "@fortawesome/free-solid-svg-icons/faCar";
import { faCouch } from "@fortawesome/free-solid-svg-icons/faCouch";
import { faGift } from "@fortawesome/free-solid-svg-icons/faGift";
import { faGraduationCap } from "@fortawesome/free-solid-svg-icons/faGraduationCap";
import { faGuitar } from "@fortawesome/free-solid-svg-icons/faGuitar";
import { faHouse } from "@fortawesome/free-solid-svg-icons/faHouse";
import { faLaptop } from "@fortawesome/free-solid-svg-icons/faLaptop";
import { faMobileScreen } from "@fortawesome/free-solid-svg-icons/faMobileScreen";
import { faMotorcycle } from "@fortawesome/free-solid-svg-icons/faMotorcycle";
import { faPiggyBank } from "@fortawesome/free-solid-svg-icons/faPiggyBank";
import { faPlaneDeparture } from "@fortawesome/free-solid-svg-icons/faPlaneDeparture";
import { faRing } from "@fortawesome/free-solid-svg-icons/faRing";
import { faShieldHalved } from "@fortawesome/free-solid-svg-icons/faShieldHalved";
import { faUmbrellaBeach } from "@fortawesome/free-solid-svg-icons/faUmbrellaBeach";
import { faWrench } from "@fortawesome/free-solid-svg-icons/faWrench";
import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";

/**
 * Which Font Awesome glyph a savings goal wears, guessed from its name.
 *
 * There is no icon column. A picker is a second thing to fill in for every
 * goal, and the name already says what the goal is — "Ferien" and "Holiday"
 * both want the same picture. The guess is deliberately generous with German,
 * because the app is Swiss and half the names people type will be.
 *
 * **Font Awesome Free has no palm tree** — `fa-tree-palm` is a Pro icon — so
 * holidays get `fa-umbrella-beach`, which is the free family's beach glyph and
 * the closest thing to the template's island.
 *
 * Deep imports (`.../faCar`) rather than the barrel: the barrel is ~2000 icon
 * definitions, and the same reasoning applies here as to `echarts/charts`.
 */

/**
 * Matched in order, so a more specific rule wins: "Motorrad" has to reach
 * `fa-motorcycle` before "rad" hands it a bicycle.
 */
const RULES: [readonly string[], IconDefinition][] = [
  [
    ["holiday", "vacation", "ferien", "urlaub", "beach", "strand", "sommer", "summer"],
    faUmbrellaBeach,
  ],
  [["flight", "flug", "reise", "travel", "trip", "japan", "usa"], faPlaneDeparture],
  [["motorrad", "motorcycle", "roller", "vespa", "scooter"], faMotorcycle],
  [["car", "auto", "wagen", "fahrzeug", "tesla", "van"], faCar],
  [
    ["computer", "laptop", "pc", "mac", "macbook", "notebook", "rechner"],
    faLaptop,
  ],
  [["phone", "handy", "iphone", "smartphone", "mobile"], faMobileScreen],
  [["camera", "kamera", "foto", "photo", "lens"], faCamera],
  [["house", "haus", "home", "wohnung", "flat", "apartment", "eigenheim"], faHouse],
  [["furniture", "möbel", "moebel", "sofa", "couch", "kitchen", "küche"], faCouch],
  [["bike", "velo", "fahrrad", "bicycle", "rad"], faBicycle],
  [["wedding", "hochzeit", "ring", "verlobung"], faRing],
  [["baby", "kind", "child", "kita"], faBaby],
  [["study", "studium", "school", "schule", "uni", "course", "kurs"], faGraduationCap],
  [["guitar", "gitarre", "piano", "klavier", "music", "musik"], faGuitar],
  [["gift", "geschenk", "present", "weihnachten", "christmas"], faGift],
  [["renovation", "renovation", "umbau", "repair", "reparatur", "tools"], faWrench],
  [
    ["emergency", "notgroschen", "reserve", "rainy", "puffer", "buffer", "insurance"],
    faShieldHalved,
  ],
];

/** The fallback. A pot with no guessable name is still a pot of money. */
export const DEFAULT_GOAL_ICON = faPiggyBank;

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

export function goalIcon(name: string): IconDefinition {
  const haystack = name.toLowerCase();
  for (const [words, icon] of RULES) {
    if (mentions([...words], haystack)) return icon;
  }
  return DEFAULT_GOAL_ICON;
}

/**
 * A Font Awesome definition unpacked into what an `<svg>` needs.
 *
 * `icon[4]` is either one path or several; joining them is safe because every
 * free solid glyph uses the same fill rule. The box is **not** always square —
 * `fa-laptop` is 640×512 — so a caller that assumes 512 stretches half the set.
 */
export function iconPath(icon: IconDefinition): {
  width: number;
  height: number;
  d: string;
} {
  const [width, height, , , path] = icon.icon;
  return {
    width,
    height,
    d: Array.isArray(path) ? path.join(" ") : path,
  };
}
