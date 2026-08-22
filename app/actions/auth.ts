"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { flashUrl } from "@/lib/flash";
import {
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export type AuthState = { error?: string; saved?: boolean } | undefined;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(200, "That password is too long."),
});

/**
 * Optional everywhere. An empty field means "no name", stored as NULL rather
 * than `""` so `displayName` has one falsy case to handle instead of two, and
 * so clearing the field on the settings page is a real reset.
 */
const displayNameField = z
  .string()
  .trim()
  .max(80, "That name is too long.")
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
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { email, password, name } = parsed.data;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return { error: "An account with that email already exists." };
  }

  const [created] = await db
    .insert(users)
    .values({ email, name, passwordHash: await hashPassword(password) })
    .returning({ id: users.id });

  await createSession(created.id);
  redirect("/");
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
  if (!parsed.success) return { error: "Incorrect email or password." };

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

  if (!user || !ok) return { error: "Incorrect email or password." };

  await createSession(user.id);
  redirect("/");
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
  if (!user) return { error: "You must be signed in to do that." };

  const parsed = updateProfileSchema.safeParse({
    name: formData.get("name") ?? undefined,
    email: formData.get("email"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  if (parsed.data.email !== user.email) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);

    if (existing.length > 0) {
      return { error: "An account with that email already exists." };
    }
  }

  await db
    .update(users)
    .set({ name: parsed.data.name, email: parsed.data.email })
    .where(eq(users.id, user.id));

  // The header renders the name from the root layout and the dashboard greets
  // with it, so both have to be rebuilt — `getCurrentUser` is cached per
  // request, which is exactly why a plain `router.refresh()` is not enough.
  revalidatePath("/");
  revalidatePath("/account");

  return { saved: true };
}

export async function logout(): Promise<never> {
  await destroySession();
  // Home, not /login: "/" is public and shows the landing page when signed
  // out, so signing out lands somewhere useful instead of a form.
  redirect(flashUrl("/", "signed-out"));
}

export async function deleteAccount(): Promise<never> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // `sessions` and `todos` both reference `users` with onDelete: "cascade",
  // so this one statement also clears every session and transaction.
  await db.delete(users).where(eq(users.id, user.id));
  await destroySession();
  redirect("/login");
}
