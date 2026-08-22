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
