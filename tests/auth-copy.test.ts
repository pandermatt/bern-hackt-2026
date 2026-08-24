import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";
import { site } from "@/lib/site";

/*
 * The guard on the auth copy, modelled on `tests/landing-copy.test.ts`.
 *
 * Two failure modes, neither of which anything else in the suite would notice:
 * a key present in one locale and not the other renders as its own raw name,
 * and only for readers in that language — and a *tag* in a message with no
 * handler at the call site is worse than that, because `t.rich` throws on it,
 * so a German-only typo is a 500 on `/register` in German alone.
 */

const catalog = (locale: string, namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8"))[namespace];

const NAMESPACES = ["Auth", "AuthErrors"];

describe("the auth copy", () => {
  it.each(NAMESPACES)("carries identical %s keys in every locale", (namespace) => {
    const [first, ...rest] = routing.locales;
    const reference = Object.keys(catalog(first, namespace)).sort();

    for (const locale of rest) {
      expect(
        Object.keys(catalog(locale, namespace)).sort(),
        `${locale} against ${first}`,
      ).toEqual(reference);
    }
  });

  /* `components/prototype-notice.tsx` supplies exactly one tag handler. */
  it("wraps the event name in <bernhackt> in every locale", () => {
    for (const locale of routing.locales) {
      expect(
        catalog(locale, "Auth").prototypeNotice,
        `messages/${locale}.json`,
      ).toMatch(/<bernhackt>.+<\/bernhackt>/);
    }
  });

  /* `components/signup-contact.tsx` supplies the tag *and* the value: the
     address lives in `lib/site.ts` alone, so a catalog that spells it out
     would be a second copy to forget. */
  it("takes the contact address as a value inside <mail> in every locale", () => {
    for (const locale of routing.locales) {
      const line = catalog(locale, "Auth").signupContact;

      expect(line, `messages/${locale}.json`).toMatch(/<mail>\{email\}<\/mail>/);
      expect(line, `messages/${locale}.json`).not.toContain(site.contactEmail);
    }
  });
});
