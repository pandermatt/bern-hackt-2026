/**
 * Notices that have to survive a redirect. A server action can't raise a
 * toast — it finishes by navigating — so it redirects with `?flash=<key>` and
 * `components/flash-toaster.tsx` shows the message on arrival, then strips the
 * parameter.
 *
 * Keys, not messages, travel in the URL: nothing user-supplied is ever
 * rendered from the query string — and a key is also what makes the notice
 * translatable, since the action that sets it and the browser that shows it
 * can be in different languages only if neither of them carries the words.
 */
export const FLASH_PARAM = "flash";

/** Flash key → its key in the `AuthErrors` namespace. */
export const FLASH_MESSAGES = {
  "signed-out": "signedOut",
} as const;

export type FlashKey = keyof typeof FLASH_MESSAGES;
