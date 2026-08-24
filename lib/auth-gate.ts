import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Who may open a new account, in one place. Signing *in* is not gated here —
 * an account that exists keeps working exactly as it always has, and
 * `app/actions/auth.ts`'s `login` is untouched.
 *
 * Three states, from two settings that answer different questions:
 *
 *   - `SIGNUP_DISABLED` is the branch's own decision — a constant rather than
 *     an env flag, so flipping it to `false` re-opens registration on the same
 *     commit rather than depending on how a host is configured.
 *   - `LOGIN_KEY` (env) is the way back in while that stands: set it, and
 *     anyone carrying that string may still create an account. It is the
 *     exception to the switch above, not a second lock in series — a
 *     deployment that wants invited sign-ups sets the key and nothing else.
 *
 * `server-only`, like `lib/auth.ts`: `LOGIN_KEY` carries no `NEXT_PUBLIC_`
 * prefix, so a client component importing this would not read the key — it
 * would read `undefined` and silently decide sign-up is closed. Pages pass the
 * *question* (`signupMode()`) to the form; the key itself never leaves the
 * server.
 */

/** Creating an account is switched off. Set to `false` to re-open it. */
export const SIGNUP_DISABLED: boolean = true;

/**
 * `"open"` — anyone may register, as it was before any of this existed.
 * `"keyed"` — the form asks for the deployment's key and checks it.
 * `"closed"` — `/register` is a notice, and the action refuses.
 */
export type SignupMode = "open" | "keyed" | "closed";

export function signupMode(): SignupMode {
  // A configured key outranks the constant: it *is* the deliberate way to let
  // people in while sign-up is otherwise off.
  if (loginKey() !== null) return "keyed";
  return SIGNUP_DISABLED ? "closed" : "open";
}

/**
 * Whether a sign-up carrying `candidate` clears the key check.
 *
 * `true` when no key is configured — this decides the `"keyed"` case only, and
 * `signupMode()` is what separates a closed door from an open one. Callers ask
 * both, in that order.
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

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
