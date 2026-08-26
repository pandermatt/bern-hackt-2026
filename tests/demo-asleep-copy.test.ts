import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";
import { site } from "@/lib/site";

/*
 * The guard on the copy the edge serves while the demo server does not exist —
 * `components/demo-asleep-notice.tsx` and the second render of
 * `app/[locale]/offline/page.tsx`. See `lib/demo-asleep.ts`.
 *
 * This copy needs a test more than most of the catalogs do, because nobody
 * reads it on the way past. It is only ever rendered into a prerendered
 * document by CI, and the document then sits on Cloudflare for a quarter at a
 * time — so a mistake in it is not a page somebody notices and fixes, it is
 * the only page the site has for three months.
 *
 * The `<mail>` tag is the sharp edge, the same one `tests/auth-copy.test.ts`
 * describes: `t.rich` **throws** on a tag with no handler, and the address is
 * the one thing on an asleep page a reader can act on. A German-only typo
 * would take the German landing page down and leave the English one standing.
 */

const catalog = (locale: string, namespace: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8"))[namespace];

/** `components/demo-asleep-notice.tsx`, in the `Landing` namespace. */
const NOTICE_KEYS = ["asleepTitle", "asleepBody", "asleepContact"];

/** `app/[locale]/offline/page.tsx`'s second render, in `Errors`. */
const OFFLINE_KEYS = ["asleepEyebrow", "asleepTitle", "asleepBody"];

describe("the demo-asleep copy", () => {
  it("names the notice in every locale", () => {
    for (const locale of routing.locales) {
      for (const key of NOTICE_KEYS) {
        expect(
          catalog(locale, "Landing")[key],
          `Landing.${key} missing from messages/${locale}.json`,
        ).toBeTruthy();
      }
    }
  });

  it("names the offline page's asleep render in every locale", () => {
    for (const locale of routing.locales) {
      for (const key of OFFLINE_KEYS) {
        expect(
          catalog(locale, "Errors")[key],
          `Errors.${key} missing from messages/${locale}.json`,
        ).toBeTruthy();
      }
    }
  });

  it("carries identical Errors keys in every locale", () => {
    // The `Landing` namespace already has this guard in
    // `tests/landing-copy.test.ts`; `Errors` had none until this page grew a
    // second render of itself.
    const [first, ...rest] = routing.locales;
    const reference = Object.keys(catalog(first, "Errors")).sort();

    for (const locale of rest) {
      expect(
        Object.keys(catalog(locale, "Errors")).sort(),
        `${locale} against ${first}`,
      ).toEqual(reference);
    }
  });

  it("takes the contact address as a value inside <mail> in every locale", () => {
    // Same contract as `Auth.signupContact`, for the same two reasons: the
    // handler in the component is what stops `t.rich` throwing, and the
    // address lives in `lib/site.ts` alone so a catalog spelling it out would
    // be a second copy to forget.
    for (const locale of routing.locales) {
      const line = catalog(locale, "Landing").asleepContact;

      expect(line, `messages/${locale}.json`).toMatch(/<mail>\{email\}<\/mail>/);
      expect(line, `messages/${locale}.json`).not.toContain(site.contactEmail);
    }
  });

  it("does not tell an asleep reader to check their connection", () => {
    // The whole reason the offline page has a second render: served because
    // the box is gone, the default copy sends the reader to debug a network
    // that is working. `tests/` is where that stays fixed.
    for (const locale of routing.locales) {
      const errors = catalog(locale, "Errors");
      expect(errors.asleepBody, `messages/${locale}.json`).not.toEqual(
        errors.offlineBody,
      );
      expect(errors.asleepTitle, `messages/${locale}.json`).not.toEqual(
        errors.offlineTitle,
      );
    }
  });
});
