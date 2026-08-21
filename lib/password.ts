/**
 * scrypt password hashing, kept in its own module because it has to be
 * reachable from two places with nothing else in common: `lib/auth.ts` (which
 * is `server-only` and talks to the database) and `scripts/seed.ts` (a plain
 * tsx script that runs outside Next entirely).
 *
 * Deliberately free of `server-only` and of any database import, for the same
 * reason `lib/site.ts` is. Duplicating the `scrypt:<salt>:<hash>` format in the
 * seed script instead would mean a change here silently breaks the demo
 * account's login rather than failing a build.
 */
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = await scrypt(password, salt, expected.length);

  // Lengths must match before timingSafeEqual, which throws otherwise.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
