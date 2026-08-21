/**
 * Everything that names or describes this app, in one place. Rebranding a
 * clone of this template should mean editing this file and the icon set in
 * `app/` — nothing else.
 *
 * Deliberately free of `server-only` and of any database import: `proxy.ts`
 * runs on the edge runtime and imports SESSION_COOKIE from here, so this
 * module has to stay safe for both runtimes.
 */
export const site = {
  name: "Beyond Money",
  /** Short slug used for the session cookie and the manifest short name. */
  slug: "beyond-money",
  tagline: "See where your money actually goes.",
  description: "Private spending insights from your own statements.",
  /** Set NEXT_PUBLIC_SITE_URL on the host so OG tags resolve absolutely. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;

export const SESSION_COOKIE = `${site.slug}_session`;
