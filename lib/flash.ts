/**
 * Notices that have to survive a redirect. A server action can't raise a
 * toast — it finishes by navigating — so it redirects with `?flash=<key>` and
 * `components/flash-toaster.tsx` shows the message on arrival, then strips the
 * parameter.
 *
 * Keys, not messages, travel in the URL: nothing user-supplied is ever
 * rendered from the query string.
 */
export const FLASH_PARAM = "flash";

export const FLASH_MESSAGES = {
  "signed-out": "Signed out.",
} as const;

export type FlashKey = keyof typeof FLASH_MESSAGES;

export function flashUrl(path: string, key: FlashKey) {
  return `${path}?${FLASH_PARAM}=${key}`;
}
