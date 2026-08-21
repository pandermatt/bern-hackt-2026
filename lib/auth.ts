import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";

import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/site";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/* ── passwords ─────────────────────────────────────────────────────────── */

/* The scrypt primitives live in `lib/password.ts` so `scripts/seed.ts`, which
   runs outside Next and cannot import a `server-only` module, hashes the demo
   account's password with exactly the same code the login path verifies it
   with. Re-exported here so every existing caller is unchanged. */
export { hashPassword, verifyPassword } from "@/lib/password";

/* ── sessions ──────────────────────────────────────────────────────────── */

/** The cookie carries the raw token; only its hash is ever stored. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  // Opportunistic cleanup; sessions are small and this keeps the table tidy.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * The real authentication check. Middleware only sniffs for a cookie; this is
 * what actually decides whether a request is authenticated, so every server
 * action and page must go through it.
 *
 * Wrapped in React's `cache` because the root layout resolves it for the
 * header on every request and the page then asks again — `cache` collapses
 * that to a single query per request.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())),
    )
    .limit(1);

  return rows[0]?.user ?? null;
});
