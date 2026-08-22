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
