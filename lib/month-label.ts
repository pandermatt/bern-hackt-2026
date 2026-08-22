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
