/**
 * `"2025-12"` → `"Dezember 2025"`.
 *
 * A `YYYY-MM` key is what the data layer speaks — `lib/insights.ts` makes a
 * month key with `slice(0, 7)` precisely so a month stays a string comparison
 * — but it is not what a sentence says. Copy that interpolated the key
 * directly read "In 2025-12 blieb Geld übrig", which is a database row
 * addressing a person.
 *
 * The name comes from the `Months` namespace, never `Intl.DateTimeFormat`:
 * `en-GB` returns "Sept", four characters where every other month has three,
 * which is why that table is hardcoded in the first place. See the note in
 * `components/monthly-trend.tsx`.
 *
 * The translator is passed in rather than resolved here, because the same
 * formatting is wanted from both sides of the boundary — `useTranslations` in
 * a component, `getTranslations` in an async page — and only the caller knows
 * which it is. Both return something callable with a key.
 *
 * `components/month-heading.tsx` deliberately does *not* use this: it sets the
 * year in its own smaller type beside the month rather than in one string.
 */
export function monthLabel(
  /** The `Months` namespace translator: `useTranslations("Months")` or the
   * `getTranslations` equivalent. */
  t: (key: string) => string,
  /** `YYYY-MM`. */
  month: string,
): string {
  return `${t(`long${Number(month.slice(5, 7))}`)} ${month.slice(0, 4)}`;
}

/**
 * `"2026-09-30"` → `"30. Sep 2026"` in German, `"30 Sep 2026"` in English.
 *
 * The month name comes from the `Months` catalog and the *shape* around it —
 * whether the day carries a full stop, where the year sits — from the `day`
 * message, so the whole date follows the language rather than half of it.
 * `formatDay` in `lib/insights.ts` is the other, English-only formatter: it
 * exists for strings the reader never sees in their own language (the anomaly
 * engine's stored descriptions), and reaching for it in the UI is how the
 * savings pots ended up printing "24 Dec 2026" on a German page.
 *
 * `long` is for a date that is only ever *spoken* — "14 March 2025" reads
 * better than "14 Mar 2025" — and `short` for one that has to fit in a card.
 *
 * Split rather than parsed: a booking date and a deadline are calendar days,
 * and `new Date("2026-09-30")` renders as 29 September west of UTC. Same rule
 * as everywhere else in the app.
 */
export function dayLabel(
  /** The `Months` namespace translator, as above. */
  t: (key: string, values?: Record<string, string | number>) => string,
  /** `YYYY-MM-DD`. */
  date: string,
  month: "short" | "long" = "short",
): string {
  const [year, monthKey, day] = date.split("-");
  return t("day", {
    day: Number(day),
    month: t(`${month}${Number(monthKey)}`),
    year,
  });
}
