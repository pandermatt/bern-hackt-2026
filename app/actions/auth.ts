"use server";

import { eq } from "drizzle-orm";
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

export type AuthState = { error?: string } | undefined;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(200, "That password is too long."),
});

export async function register(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { email, password } = parsed.data;

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
    .values({ email, passwordHash: await hashPassword(password) })
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
