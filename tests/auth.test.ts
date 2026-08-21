import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import {
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/site";

import { cookieJar, resetCookies } from "./cookie-jar";

async function createUser(email: string) {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("correct horse") })
    .returning();
  return user;
}

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(users);
  resetCookies();
});

describe("passwords", () => {
  it("round-trips a correct password", async () => {
    const stored = await hashPassword("correct horse");
    await expect(verifyPassword("correct horse", stored)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse");
    await expect(verifyPassword("wrong horse", stored)).resolves.toBe(false);
  });

  it("returns false rather than throwing on a malformed stored value", async () => {
    await expect(verifyPassword("anything", "garbage")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "bcrypt:a:b")).resolves.toBe(false);
  });

  it("salts per user, so the same password hashes differently", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt:")).toBe(true);
  });
});

describe("sessions", () => {
  it("stores only the hash of the token the cookie carries", async () => {
    const user = await createUser("a@example.com");
    await createSession(user.id);

    const token = cookieJar.get(SESSION_COOKIE);
    expect(token).toBeTruthy();

    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(createHash("sha256").update(token!).digest("hex"));
    // The raw token must never be what's persisted.
    expect(rows[0].id).not.toBe(token);
  });

  it("resolves the signed-in user from the cookie", async () => {
    const user = await createUser("a@example.com");
    await createSession(user.id);

    await expect(getCurrentUser()).resolves.toMatchObject({
      id: user.id,
      email: "a@example.com",
    });
  });

  it("returns null with no cookie", async () => {
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null for an expired session", async () => {
    const user = await createUser("a@example.com");
    await createSession(user.id);

    const token = cookieJar.get(SESSION_COOKIE)!;
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, createHash("sha256").update(token).digest("hex")));

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null when the session row is gone but the cookie remains", async () => {
    // What a redeploy onto a rebuilt database looks like from the browser: the
    // cookie is still there, the row behind it is not. `proxy.ts` can only see
    // the cookie, so this is the check that has to be authoritative — see the
    // signed-in guard in app/login/page.tsx.
    const user = await createUser("a@example.com");
    await createSession(user.id);
    await expect(getCurrentUser()).resolves.not.toBeNull();

    await db.delete(sessions);

    expect(cookieJar.has(SESSION_COOKIE)).toBe(true);
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null for a forged cookie", async () => {
    await createUser("a@example.com");
    cookieJar.set(SESSION_COOKIE, "not-a-real-token");

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("clears both the row and the cookie on sign out", async () => {
    const user = await createUser("a@example.com");
    await createSession(user.id);
    await destroySession();

    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    await expect(db.select().from(sessions)).resolves.toHaveLength(0);
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
