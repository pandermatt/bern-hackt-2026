import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/site";

import { cookieJar, resetCookies } from "./cookie-jar";

/*
 * The real `redirect` throws a Next-internal control-flow error. Replacing it
 * with a throw that carries the URL lets a test assert where an action sends
 * the user without depending on that internal shape. It comes from
 * `@/i18n/navigation` now rather than `next/navigation`, because every
 * redirect in the app is locale-aware — which is what the `/en` prefix in the
 * expectations below is.
 */
vi.mock("@/i18n/navigation", async () => {
  const { redirectUrl } = await import("./stubs/i18n");
  return {
    redirect: (args: Parameters<typeof redirectUrl>[0]) => {
      throw new Error(`REDIRECT:${redirectUrl(args)}`);
    },
  };
});

/* Outside a request there is no locale to resolve and no message catalog
 * loaded, so both are supplied here — from `messages/en.json`, so the error
 * strings asserted below are the ones the app really ships. */
vi.mock("next-intl/server", async () => {
  const { translator } = await import("./stubs/i18n");
  return {
    getLocale: async () => "en",
    getTranslations: async (namespace: string) => translator(namespace),
  };
});

const { login, logout, register } = await import("@/app/actions/auth");

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

    await expect(logout()).rejects.toThrow("REDIRECT:/en?flash=signed-out");
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

/** The two actions take `(prevState, formData)` — `useActionState`'s shape. */
function form(fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return body;
}

describe("register", () => {
  it("sends a brand-new account to onboarding, not to /home", async () => {
    /*
     * The whole point of the page: an account created a moment ago holds no
     * statements, and `/home` has nothing to say to that. Signing *in* is the
     * other case, asserted below — the two must not drift back together.
     */
    await expect(
      register(undefined, form({ email: "new@example.com", password: "correct horse" })),
    ).rejects.toThrow("REDIRECT:/en/onboarding");
  });

  it("still creates the account and its session on the way there", async () => {
    await expect(
      register(undefined, form({ email: "new@example.com", password: "correct horse" })),
    ).rejects.toThrow();

    await expect(db.select().from(users)).resolves.toHaveLength(1);
    await expect(db.select().from(sessions)).resolves.toHaveLength(1);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(true);
  });

  it("does not redirect at all when the registration is rejected", async () => {
    await db.insert(users).values({
      email: "taken@example.com",
      passwordHash: await hashPassword("correct horse"),
    });

    // Resolves with an error rather than throwing: a failed registration has
    // to render the form again, not navigate.
    await expect(
      register(undefined, form({ email: "taken@example.com", password: "correct horse" })),
    ).resolves.toEqual({ error: expect.any(String) });
  });
});

describe("login", () => {
  it("still lands on /home — onboarding is for new accounts only", async () => {
    await db.insert(users).values({
      email: "a@example.com",
      passwordHash: await hashPassword("correct horse"),
    });

    await expect(
      login(undefined, form({ email: "a@example.com", password: "correct horse" })),
    ).rejects.toThrow("REDIRECT:/en/home");
  });
});
