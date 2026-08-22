/**
 * The id both transaction views carry, so a filter change scrolls back to the
 * rows whichever one is on screen.
 *
 * Its own module for one string because the calendar is a client component:
 * importing this from `transaction-list.tsx` would pull the whole ledger — the
 * rows, the lucide icon map, the merchant avatars — into the client bundle to
 * fetch a constant.
 */
export const LEDGER_ANCHOR_ID = "transactions";
