"use server";

import { eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { redirect } from "@/i18n/navigation";
import { FLASH_PARAM } from "@/lib/flash";
import {
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export type AuthState = { error?: string; saved?: boolean } | undefined;

/**
 * The schemas carry message *keys*, not messages.
 *
 * They are built once at module scope, long before a request — and therefore
 * before there is a locale to resolve against — so what a failed `safeParse`
 * hands back is a key into the `AuthErrors` namespace, which `errorFor` below
 * turns into words in the caller's language.
 */
const credentials = z.object({
  email: z.string().trim().toLowerCase().email("invalidEmail"),
  password: z.string().min(8, "passwordTooShort").max(200, "passwordTooLong"),
});

type AuthErrorKey =
  | "invalidEmail"
  | "passwordTooShort"
  | "passwordTooLong"
  | "nameTooLong"
  | "notSignedIn"
  | "invalidCredentials"
  | "emailTaken";

/** One key → one localised sentence, in the locale this request came in on. */
async function errorFor(key: AuthErrorKey | string): Promise<AuthState> {
  const t = await getTranslations("AuthErrors");
  // A key the catalog does not know would throw inside a server action and
  // surface as a 500 rather than a form error, so unknown keys fall back.
  const known: AuthErrorKey[] = [
    "invalidEmail",
    "passwordTooShort",
    "passwordTooLong",
    "nameTooLong",
    "notSignedIn",
    "invalidCredentials",
    "emailTaken",
  ];
  return {
    error: t(known.includes(key as AuthErrorKey) ? (key as AuthErrorKey) : "invalidCredentials"),
  };
}

/**
 * Optional everywhere. An empty field means "no name", stored as NULL rather
 * than `""` so `displayName` has one falsy case to handle instead of two, and
 * so clearing the field on the settings page is a real reset.
 */
const displayNameField = z
  .string()
  .trim()
  .max(80, "nameTooLong")
  .optional()
  .transform((value) => value || null);

/**
 * Registration takes a name; `credentials` deliberately does not. `login`
 * parses with `credentials`, and its whole point is that every failure comes
 * back as the same generic message — a name-shaped validation error there would
 * be a way to probe the form.
 */
const registration = credentials.extend({ name: displayNameField });

export async function register(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = registration.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name") ?? undefined,
  });
  if (!parsed.success) return errorFor(parsed.error.issues[0].message);

  const { email, password, name } = parsed.data;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) return errorFor("emailTaken");

  const [created] = await db
    .insert(users)
    .values({ email, name, passwordHash: await hashPassword(password) })
    .returning({ id: users.id });

  await createSession(created.id);
  /*
   * `/onboarding`, not `/home`, and only from here — signing *in* still lands
   * on the entry page. A brand-new account holds no statements, and `/home`
   * has nothing to say to that: the nudge deck ranks an empty account as
   * "nothing needs your attention today", which is true and useless, and
   * nothing on that page leads to getting statements in. `/onboarding` is the
   * two steps that have to happen first, and it ends by sending them on to
   * `/home` itself.
   *
   * No flag on `users` says whether it has been seen. Sign-up happens exactly
   * once, so the redirect *is* the condition — and a column on that populated
   * table is a deploy risk (`drizzle-kit push` runs without `--force`) for
   * something a page that is skippable by design does not need to remember.
   */
  return redirect({ href: "/onboarding", locale: await getLocale() });
}

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  // Don't leak which half was wrong.
  if (!parsed.success) return errorFor("invalidCredentials");

  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Verify even when the user is missing, so a wrong email and a wrong
  // password take about the same time and can't be told apart.
  const stored =
    user?.passwordHash ??
    "scrypt:0000000000000000000000000000000000000000000000000000000000000000:00";
  const ok = await verifyPassword(password, stored);

  if (!user || !ok) return errorFor("invalidCredentials");

  await createSession(user.id);
  // See the note in `register` — signing in lands on the entry page.
  return redirect({ href: "/home", locale: await getLocale() });
}

/**
 * Sets or clears the signed-in account's display name.
 *
 * The account is resolved from the session, never from an argument: every
 * export of a `"use server"` module is an endpoint the browser can call with
 * arguments it chooses, and a `userId` parameter here would let anyone rename
 * anyone.
 */
const updateProfileSchema = z.object({
  name: displayNameField,
  email: credentials.shape.email,
});

export async function updateProfile(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const user = await getCurrentUser();
  if (!user) return errorFor("notSignedIn");

  const parsed = updateProfileSchema.safeParse({
    name: formData.get("name") ?? undefined,
    email: formData.get("email"),
  });
  if (!parsed.success) return errorFor(parsed.error.issues[0].message);

  if (parsed.data.email !== user.email) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);

    if (existing.length > 0) return errorFor("emailTaken");
  }

  await db
    .update(users)
    .set({ name: parsed.data.name, email: parsed.data.email })
    .where(eq(users.id, user.id));

  // The header renders the name from the root layout and the dashboard greets
  // with it, so both have to be rebuilt — `getCurrentUser` is cached per
  // request, which is exactly why a plain `router.refresh()` is not enough.
  //
  // Every page now sits under `/[locale]`, so the literal paths this used to
  // name match nothing. Revalidating the segment's layout covers both
  // languages at once, which is what a signed-in reader switching locale
  // needs anyway.
  revalidatePath("/[locale]", "layout");

  return { saved: true };
}

export async function logout(): Promise<never> {
  const locale = await getLocale();
  await destroySession();
  // Home, not /login: "/" is public and shows the landing page when signed
  // out, so signing out lands somewhere useful instead of a form. Through the
  // locale-aware redirect, so signing out does not also switch the language.
  return redirect({
    href: { pathname: "/", query: { [FLASH_PARAM]: "signed-out" } },
    locale,
  });
}

export async function deleteAccount(): Promise<never> {
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) return redirect({ href: "/login", locale });

  // `sessions` and `todos` both reference `users` with onDelete: "cascade",
  // so this one statement also clears every session and transaction.
  await db.delete(users).where(eq(users.id, user.id));
  await destroySession();
  return redirect({ href: "/login", locale });
}
