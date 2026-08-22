/**
 * The one number the test notification is about.
 *
 * The delay is the point of the feature rather than an implementation detail:
 * a notification that appears while you are looking at the page that sent it
 * proves nothing. Twenty seconds is enough to close the app and lock the
 * phone, so what arrives is a real push on a sleeping device.
 *
 * Client-safe on purpose — no `server-only`, no imports. The server arms the
 * timer with it and the settings copy quotes it, and the two must not drift.
 */
export const TEST_PUSH_DELAY_MS = 20_000;

/** The same delay in seconds, for the sentence under the button. */
export const TEST_PUSH_DELAY_SECONDS = TEST_PUSH_DELAY_MS / 1000;
