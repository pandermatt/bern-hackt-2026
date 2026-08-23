import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Who is allowed through the front door, in one place.
 *
 * Two independent switches, deliberately not folded into one:
 *
 *   - `LOGIN_DISABLED` closes signing *in*. It is a constant rather than an
 *     env flag because it is a decision about this branch, not about a host —
 *     flip it to `false` to hand the door back, and the login page goes back
 *     to rendering the form on the same commit.
 *   - `LOGIN_KEY` (env) gates signing *up*. Unset, registration stays open, as
 *     it has always been; set, a sign-up has to carry the same string.
 *
 * `server-only`, like `lib/auth.ts`: `LOGIN_KEY` carries no `NEXT_PUBLIC_`
 * prefix, so a client component importing this would not read the key — it
 * would read `undefined` and silently decide registration is open. Pages pass
 * the *question* (`loginKeyRequired()`) to the form as a boolean; the key
 * itself never leaves the server.
 */

/** Sign-in is switched off. Set to `false` to re-open it. */
export const LOGIN_DISABLED: boolean = true;

/**
 * The configured key, or `null` when there is none.
 *
 * Read per call rather than captured at module scope so a test can set the
 * variable around a case, and trimmed at both ends — a key pasted into a host's
 * environment editor picks up whitespace, and an empty string means "unset"
 * rather than "the key is the empty string".
 */
function loginKey(): string | null {
  const key = process.env.LOGIN_KEY?.trim();
  return key ? key : null;
}

/** Whether the sign-up form has to ask for a key at all. */
export function loginKeyRequired(): boolean {
  return loginKey() !== null;
}

/**
 * Whether a sign-up carrying `candidate` may proceed.
 *
 * `true` when no key is configured — the gate is opt-in, so a deployment that
 * never sets `LOGIN_KEY` behaves exactly as it did before this existed.
 *
 * Compared over SHA-256 digests rather than the strings themselves: the
 * digests are always 32 bytes, which is what lets `timingSafeEqual` run at all
 * (it throws on a length mismatch, and that throw is itself the leak — it
 * would tell a prober the length of the key).
 */
export function loginKeyAccepted(candidate: string): boolean {
  const expected = loginKey();
  if (expected === null) return true;

  return timingSafeEqual(digest(candidate.trim()), digest(expected));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
