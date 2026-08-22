import {
  BookOpen,
  Briefcase,
  Dumbbell,
  House,
  Landmark,
  Laptop,
  Lightbulb,
  PawPrint,
  Plane,
  Puzzle,
  ReceiptText,
  Repeat,
  Shirt,
  ShoppingCart,
  Sofa,
  Stethoscope,
  Tag,
  TrainFront,
  Undo2,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/**
 * One icon per category, shared by the top-categories chart's axis and its
 * hide/show chips.
 *
 * Emoji, deliberately, rather than an icon component: the axis is drawn on an
 * ECharts canvas, and emoji are the one icon set a canvas renders as plain
 * text — no glyph paths to ship, and legible in both themes for free. An icon
 * is never the only naming: the chips and tooltips spell the category out,
 * and the `sr-only` tables carry the text.
 *
 * Keep the keys in step with the categories `MERCHANTS` assigns in
 * `scripts/lib/statement.ts`.
 */
export const CATEGORY_ICONS: Record<string, string> = {
  "Books & Media": "📚",
  Clothing: "👕",
  Electronics: "💻",
  "Food & Drink": "🍽️",
  "Health & Insurance": "🩺",
  "Home & Office": "🛋️",
  Housing: "🏠",
  Marketplace: "🛒",
  "Opening balance": "🏦",
  Pets: "🐾",
  Refund: "↩️",
  Salary: "💼",
  "Sports & Leisure": "🎾",
  Subscriptions: "🔁",
  "Taxes & Fees": "🧾",
  Transport: "🚆",
  Travel: "✈️",
  "Utilities & Telecom": "💡",
  Other: "🧩",
};

/** The icon for a category, or a neutral tag for one this map has never met. */
export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? "🏷️";
}

/**
 * The same nineteen categories as line-art, for the places that draw in the
 * DOM rather than onto a canvas.
 *
 * The emoji above stay the canvas's set — ECharts renders them as text and a
 * component has no way in there. In HTML a lucide glyph is the better picture:
 * it takes the category's colour (an emoji is stuck with its own), it inherits
 * the surrounding stroke weight, and it does not turn into a different drawing
 * per platform. Keep the two maps on the same keys.
 */
export const CATEGORY_LUCIDE_ICONS: Record<string, LucideIcon> = {
  "Books & Media": BookOpen,
  Clothing: Shirt,
  Electronics: Laptop,
  "Food & Drink": UtensilsCrossed,
  "Health & Insurance": Stethoscope,
  "Home & Office": Sofa,
  Housing: House,
  Marketplace: ShoppingCart,
  "Opening balance": Landmark,
  Pets: PawPrint,
  Refund: Undo2,
  Salary: Briefcase,
  "Sports & Leisure": Dumbbell,
  Subscriptions: Repeat,
  "Taxes & Fees": ReceiptText,
  Transport: TrainFront,
  Travel: Plane,
  "Utilities & Telecom": Lightbulb,
  Other: Puzzle,
};

/** The glyph for a category, or a neutral tag for one this map has never met. */
export function categoryLucideIcon(category: string): LucideIcon {
  return CATEGORY_LUCIDE_ICONS[category] ?? Tag;
}
