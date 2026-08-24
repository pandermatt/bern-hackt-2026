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
  /**
   * Where a visitor writes to ask for a sign-up key. Sign-up is closed unless
   * `LOGIN_KEY` is configured (see `lib/auth-gate.ts`), so without an address
   * to ask at, the notice on /register is a dead end.
   */
  contactEmail: "hi@beyond-money.ch",
  /**
   * The event this was built at, credited on the auth pages. The href lives
   * here and the sentence around it lives in the message catalogs, like every
   * other link in the app.
   */
  hackathon: { name: "BärnHäckt 2026", url: "https://www.bernhackt.ch/" },
} as const;

export const SESSION_COOKIE = `${site.slug}_session`;
