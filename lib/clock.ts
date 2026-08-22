import "server-only";

/**
 * "Now", for the two pages that need to know which month is still running.
 *
 * It lives here rather than in `lib/insights.ts` because that module never
 * constructs a `Date` — see the note on `formatDay`. A month key is `YYYY-MM`
 * text like every other date in this app, so comparisons against it are plain
 * string comparisons.
 */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Whether a month is over, and so whether its figures are final.
 *
 * The savings page only offers a month's leftover money once it can no longer
 * change; a surplus computed halfway through a month is a number that shrinks
 * for the rest of it.
 */
export function monthHasEnded(month: string): boolean {
  return month < currentMonth();
}
