import type { User } from "@/db/schema";

/**
 * The name to greet someone by.
 *
 * `users.name` is nullable and optional at sign-up, so a greeting that read it
 * straight would say "Welcome, " to everyone who skipped the field and to every
 * account that predates the column. The email's local part is the next best
 * thing we already hold — `jeanine@example.com` becomes "Jeanine".
 *
 * `import type` only, so this stays usable from a client component without
 * dragging drizzle into the bundle.
 */
export function displayName(user: Pick<User, "name" | "email">): string {
  const chosen = user.name?.trim();
  if (chosen) return chosen;

  const local = user.email.split("@")[0] ?? user.email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}
