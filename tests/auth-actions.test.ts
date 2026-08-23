import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { SIGNUP_DISABLED } from "@/lib/auth-gate";
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


/**
 * The key that opens sign-up in these tests.
 *
 * `loginKeyAccepted` reads `process.env` per call, so a case can set the
 * variable around itself — and every block that sets it clears it again:
 * vitest runs the files in one process, and a leaked key would silently
 * re-open registration for everything after it.
 */
const KEY = "bern-haeckt";

describe("register", () => {
  /*
   * These are about where a *successful* sign-up lands, not about who is let
   * in — so they run with a key configured, which is the one door open while
   * `SIGNUP_DISABLED` stands. They pass either way the constant is set: a
   * matching key is accepted in both.
   */
  beforeEach(() => {
    process.env.LOGIN_KEY = KEY;
  });

  afterEach(() => {
    delete process.env.LOGIN_KEY;
  });

  it("sends a brand-new account to onboarding, not to /home", async () => {
    /*
     * The whole point of the page: an account created a moment ago holds no
     * statements, and `/home` has nothing to say to that. Signing *in* is the
     * other case, asserted below — the two must not drift back together.
     */
    await expect(
      register(
        undefined,
        form({ email: "new@example.com", password: "correct horse", loginKey: KEY }),
      ),
    ).rejects.toThrow("REDIRECT:/en/onboarding");
  });

  it("still creates the account and its session on the way there", async () => {
    await expect(
      register(
        undefined,
        form({ email: "new@example.com", password: "correct horse", loginKey: KEY }),
      ),
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
      register(
        undefined,
        form({ email: "taken@example.com", password: "correct horse", loginKey: KEY }),
      ),
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

  it("is untouched by a configured sign-up key", async () => {
    // The key gates opening an account, never using one. An account that
    // exists signs in on its password and nothing else.
    process.env.LOGIN_KEY = KEY;
    await db.insert(users).values({
      email: "a@example.com",
      passwordHash: await hashPassword("correct horse"),
    });

    try {
      await expect(
        login(undefined, form({ email: "a@example.com", password: "correct horse" })),
      ).rejects.toThrow("REDIRECT:/en/home");
    } finally {
      delete process.env.LOGIN_KEY;
    }
  });
});

/*
 * `SIGNUP_DISABLED` is a constant, not an env flag, so a test cannot flip it —
 * which is why both halves are written and one of them runs. Whichever way the
 * switch in `lib/auth-gate.ts` is set, the suite pins what the app then does,
 * and re-opening sign-up brings the old expectation back with it rather than
 * leaving a deleted test behind.
 */
describe.runIf(SIGNUP_DISABLED)("sign-up, with no key configured", () => {
  it("turns the sign-up away", async () => {
    expect(process.env.LOGIN_KEY).toBeUndefined();

    // Resolves rather than throwing: a refusal renders the message, it does
    // not navigate.
    await expect(
      register(undefined, form({ email: "nobody@example.com", password: "correct horse" })),
    ).resolves.toEqual({ error: "Creating an account is currently disabled." });
  });

  it("creates no account and issues no session", async () => {
    await register(undefined, form({ email: "nobody@example.com", password: "correct horse" }));

    await expect(db.select().from(users)).resolves.toHaveLength(0);
    await expect(db.select().from(sessions)).resolves.toHaveLength(0);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuses before it says whether the email is taken", async () => {
    // Otherwise a closed sign-up form is still an oracle for which addresses
    // hold an account.
    await db.insert(users).values({
      email: "taken@example.com",
      passwordHash: await hashPassword("correct horse"),
    });

    await expect(
      register(undefined, form({ email: "taken@example.com", password: "correct horse" })),
    ).resolves.toEqual({ error: "Creating an account is currently disabled." });
  });
});

describe.skipIf(SIGNUP_DISABLED)("sign-up, with no key and the switch re-opened", () => {
  it("lets anyone in, as it always did", async () => {
    expect(process.env.LOGIN_KEY).toBeUndefined();

    await expect(
      register(undefined, form({ email: "open@example.com", password: "correct horse" })),
    ).rejects.toThrow("REDIRECT:/en/onboarding");
  });
});

describe("sign-up, with a key configured", () => {
  beforeEach(() => {
    process.env.LOGIN_KEY = KEY;
  });

  afterEach(() => {
    delete process.env.LOGIN_KEY;
  });

  it("lets a sign-up through when the key matches", async () => {
    await expect(
      register(
        undefined,
        form({ email: "invited@example.com", password: "correct horse", loginKey: KEY }),
      ),
    ).rejects.toThrow("REDIRECT:/en/onboarding");

    await expect(db.select().from(users)).resolves.toHaveLength(1);
  });

  it("tolerates whitespace around a pasted key", async () => {
    await expect(
      register(
        undefined,
        form({
          email: "invited@example.com",
          password: "correct horse",
          loginKey: `  ${KEY}\n`,
        }),
      ),
    ).rejects.toThrow("REDIRECT:/en/onboarding");
  });

  it("creates no account when the key is wrong", async () => {
    await expect(
      register(
        undefined,
        form({
          email: "gatecrash@example.com",
          password: "correct horse",
          loginKey: "bern-hacked",
        }),
      ),
    ).resolves.toEqual({ error: "That access key is not right." });

    await expect(db.select().from(users)).resolves.toHaveLength(0);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("creates no account when the field is missing entirely", async () => {
    // The form renders the input only when a key is configured, so a posted
    // body without one is exactly what a crafted request looks like.
    await expect(
      register(undefined, form({ email: "gatecrash@example.com", password: "correct horse" })),
    ).resolves.toEqual({ error: "That access key is not right." });

    await expect(db.select().from(users)).resolves.toHaveLength(0);
  });

  it("refuses a wrong key before it says whether the email is taken", async () => {
    await db.insert(users).values({
      email: "taken@example.com",
      passwordHash: await hashPassword("correct horse"),
    });

    await expect(
      register(
        undefined,
        form({
          email: "taken@example.com",
          password: "correct horse",
          loginKey: "bern-hacked",
        }),
      ),
    ).resolves.toEqual({ error: "That access key is not right." });
  });
});
