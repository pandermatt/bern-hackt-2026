import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { TABS } from "@/components/nav-tabs";
import { routing } from "@/i18n/routing";

/*
 * The guard on `components/nav-tabs.ts`.
 *
 * Two navs render this one list — the header on a browser, the bottom bar in
 * the installed app — and neither reaches its labels through a type. They are
 * message keys resolved at runtime, so a tab added to the array and forgotten
 * in one locale renders the raw key as its own name, and only ever on the
 * device that shows that nav. Nothing else in the suite would catch it.
 */

const messages = Object.fromEntries(
  routing.locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8")).AppHeader as
      | Record<string, string>
      | undefined,
  ]),
);

/** Every message key the two navs ask for, long form and tab form alike. */
const keys = TABS.flatMap((tab) =>
  "shortKey" in tab ? [tab.key, tab.shortKey] : [tab.key],
);

describe("the shared nav tabs", () => {
  it.each(routing.locales)("resolves every label in %s", (locale) => {
    const namespace = messages[locale];
    expect(namespace, `messages/${locale}.json has no AppHeader namespace`).toBeDefined();

    for (const key of keys) {
      expect(namespace![key], `AppHeader.${key} missing from ${locale}`).toBeTruthy();
    }
  });

  it("names the nav itself in every locale", () => {
    // Both navs label their landmark with this one.
    for (const locale of routing.locales) {
      expect(messages[locale]!.mainNav).toBeTruthy();
    }
  });

  it("keeps every tab label short enough for a quarter of a 320px screen", () => {
    /*
     * The bottom bar splits into four equal cells. On the narrowest phone
     * still in use that is about 70px per cell, and at the 10px label size
     * roughly 13 characters. This is what forced `tabAnomalies` to exist —
     * German "Auffälligkeiten" is 15 — so it is also what should fail if a
     * future tab arrives with a long name and no short form.
     */
    for (const locale of routing.locales) {
      for (const tab of TABS) {
        const key = "shortKey" in tab ? tab.shortKey : tab.key;
        const label = messages[locale]![key];
        expect(
          label.length,
          `${locale}: "${label}" is too long for a tab cell — give ${tab.key} a shortKey`,
        ).toBeLessThanOrEqual(13);
      }
    }
  });

  it("routes every tab to a locale-relative path", () => {
    // These are fed to `Link` from `@/i18n/navigation`, which prefixes them.
    // An absolute or already-prefixed href would double up.
    for (const tab of TABS) {
      expect(tab.href.startsWith("/")).toBe(true);
      expect(tab.href).not.toMatch(new RegExp(`^/(${routing.locales.join("|")})(/|$)`));
    }
  });
});
