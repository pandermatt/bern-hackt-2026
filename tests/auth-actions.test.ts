import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/site";

import { cookieJar, resetCookies } from "./cookie-jar";

/*
 * The real `redirect` throws a Next-internal control-flow error. Replacing it
 * with a throw that carries the URL lets a test assert where an action sends
 * the user without depending on that internal shape.
 */
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { logout } = await import("@/app/actions/auth");

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(users);
  resetCookies();
});

describe("logout", () => {
  it("sends the visitor home with a signed-out notice, not to /login", async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: "a@example.com",
        passwordHash: await hashPassword("correct horse"),
      })
      .returning();
    await createSession(user.id);

    await expect(logout()).rejects.toThrow("REDIRECT:/?flash=signed-out");
  });

  it("clears the session before redirecting", async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: "a@example.com",
        passwordHash: await hashPassword("correct horse"),
      })
      .returning();
    await createSession(user.id);

    await expect(logout()).rejects.toThrow();

    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    await expect(db.select().from(sessions)).resolves.toHaveLength(0);
  });
});
