import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { displayName } from "@/lib/user";

/* Same shape as tests/auth-actions.test.ts — see the note there. */
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

const { register, updateProfile } = await import("@/app/actions/auth");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function signIn(name: string | null = null) {
  const [user] = await db
    .insert(users)
    .values({
      email: "a@example.com",
      name,
      passwordHash: await hashPassword("correct horse"),
    })
    .returning();
  await createSession(user.id);
  return user;
}

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(users);
});

describe("displayName", () => {
  it("prefers the name someone set", () => {
    expect(displayName({ name: "Jeanine", email: "j@example.com" })).toBe(
      "Jeanine",
    );
  });

  /* The column is nullable and the field is optional at sign-up, so this is the
   * common case, not an edge one — every account that predates the column takes
   * this branch. */
  it("falls back to the email's local part, capitalised", () => {
    expect(displayName({ name: null, email: "jeanine@example.com" })).toBe(
      "Jeanine",
    );
  });

  it("treats a whitespace-only name as unset", () => {
    expect(displayName({ name: "   ", email: "jeanine@example.com" })).toBe(
      "Jeanine",
    );
  });
});

describe("register", () => {
  it("stores the name when one is given", async () => {
    await expect(
      register(undefined, form({ email: "a@example.com", password: "correct horse", name: " Jeanine " })),
    ).rejects.toThrow("REDIRECT:/en");

    const [user] = await db.select().from(users);
    expect(user.name).toBe("Jeanine");
  });

  /* The field is optional, so an empty one must not block the sign-up — and it
   * must land as NULL rather than "", or `displayName` would have two falsy
   * cases to handle instead of one. */
  it("accepts an empty name and stores NULL", async () => {
    await expect(
      register(undefined, form({ email: "a@example.com", password: "correct horse", name: "" })),
    ).rejects.toThrow("REDIRECT:/en");

    const [user] = await db.select().from(users);
    expect(user.name).toBeNull();
  });

  it("rejects a name over 80 characters", async () => {
    const result = await register(
      undefined,
      form({ email: "a@example.com", password: "correct horse", name: "x".repeat(81) }),
    );

    expect(result?.error).toBe("That name is too long.");
    await expect(db.select().from(users)).resolves.toHaveLength(0);
  });
});

describe("updateProfile", () => {
  it("sets the name and email on the signed-in account", async () => {
    const user = await signIn();

    await expect(updateProfile(undefined, form({ name: "Jeanine", email: "new@example.com" }))).resolves.toEqual({
      saved: true,
    });

    const [updated] = await db.select().from(users);
    expect(updated.id).toBe(user.id);
    expect(updated.name).toBe("Jeanine");
    expect(updated.email).toBe("new@example.com");
  });

  /* Clearing the field is a real reset, not a no-op. */
  it("clears the name back to NULL when the field is empty", async () => {
    await signIn("Jeanine");

    await expect(updateProfile(undefined, form({ name: "", email: "a@example.com" }))).resolves.toEqual({
      saved: true,
    });

    const [updated] = await db.select().from(users);
    expect(updated.name).toBeNull();
  });

  /* Every export of a "use server" module is an endpoint the browser can call
   * with arguments it chooses; this one resolves the account from the session
   * precisely so there is nothing to choose. */
  it("refuses when nobody is signed in", async () => {
    await db.insert(users).values({
      email: "a@example.com",
      name: "Jeanine",
      passwordHash: await hashPassword("correct horse"),
    });

    const result = await updateProfile(undefined, form({ name: "Someone else", email: "a@example.com" }));

    expect(result?.error).toBe("You must be signed in to do that.");
    const [untouched] = await db.select().from(users);
    expect(untouched.name).toBe("Jeanine");
  });

  it("prevents changing email to one that already exists", async () => {
    const user = await signIn();
    await db.insert(users).values({
      email: "existing@example.com",
      passwordHash: await hashPassword("correct horse"),
    });

    const result = await updateProfile(undefined, form({ name: "Jeanine", email: "existing@example.com" }));

    expect(result?.error).toBe("An account with that email already exists.");
  });
});
