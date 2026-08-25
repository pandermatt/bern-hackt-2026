import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";

/*
 * The guard on the landing copy.
 *
 * It has the failure mode `tests/nav-tabs.test.ts` describes: the page builds
 * message keys by construction (`ask${n}Question`), so a key added in one
 * locale and forgotten in the other renders as its own raw name — and only for
 * readers in that language. Nothing else in the suite would notice.
 */

const namespaces = Object.fromEntries(
  routing.locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(resolve(`messages/${locale}.json`), "utf8")).Landing as
      | Record<string, string>
      | undefined,
  ]),
);

/** The canned exchanges in `components/landing-dragon.tsx`. */
const ASK_KEYS = ["ask1", "ask2", "ask3"];

/** The exchanges in `components/landing.tsx`'s FAQ, in its own order. */
const FAQ_KEYS = ["faqAnomaly", "faqBank", "faqData", "faqBatzi", "faqDelete"];

/** The two FAQ entries the section dropped, plus the numbered keys the whole
 *  set used to be filed under. Both halves must stay gone: the numbered ones
 *  because nothing renders them any more, and the two answers because they
 *  explained the app's internals on the page a visitor decides on. */
const RETIRED_FAQ = [
  "faq1Question",
  "faq2Question",
  "faq3Question",
  "faq4Question",
  "faq5Question",
  "faq6Question",
];

/** Everything the retired mock dashboard needed, as a sample. It was replaced
 *  by the dragon; these keys must not drift back in beside it. */
const RETIRED = [
  "mockCategory1",
  "mockTransaction1",
  "previewTabFlow",
  "previewFlowLabel",
  "previewInflow",
  "previewDemoNote",
  "findingSpike",
];

describe("the landing copy", () => {
  it("has a Landing namespace in every locale", () => {
    for (const locale of routing.locales) {
      expect(namespaces[locale], `messages/${locale}.json has no Landing namespace`)
        .toBeDefined();
    }
  });

  it("carries identical keys in every locale", () => {
    const [first, ...rest] = routing.locales;
    const reference = Object.keys(namespaces[first]!).sort();
    for (const locale of rest) {
      expect(Object.keys(namespaces[locale]!).sort(), `${locale} against ${first}`)
        .toEqual(reference);
    }
  });

  it("gives the dragon both halves of every exchange", () => {
    for (const locale of routing.locales) {
      for (const key of ASK_KEYS) {
        // An answer with no question leaves a chip with no label; a question
        // with no answer leaves the bubble empty after the typing dots.
        for (const half of [`${key}Question`, `${key}Answer`]) {
          expect(namespaces[locale]![half], `Landing.${half} missing from ${locale}`)
            .toBeTruthy();
        }
      }
    }
  });

  it("keeps the chips short enough to sit in a row", () => {
    // Three chips wrap onto at most two lines on a 360px screen at 12.5px.
    // A long German question is what would quietly turn that into four.
    for (const locale of routing.locales) {
      for (const key of ASK_KEYS) {
        expect(namespaces[locale]![`${key}Question`]!.length).toBeLessThanOrEqual(34);
      }
    }
  });

  it("names the rest of the dragon block in every locale", () => {
    for (const locale of routing.locales) {
      for (const key of [
        "askIntro",
        "askThinking",
        "askThreadLabel",
        "askChipsLabel",
        "askCta",
      ]) {
        expect(namespaces[locale]![key], `Landing.${key} missing from ${locale}`)
          .toBeTruthy();
      }
    }
  });

  it("names both halves of every FAQ exchange in every locale", () => {
    // The section renders `${key}Question` and `${key}Answer` by construction,
    // so a key spelled one way in the component and another in a catalog shows
    // up as its own raw name — and only for readers in that language.
    for (const locale of routing.locales) {
      for (const key of FAQ_KEYS) {
        for (const half of [`${key}Question`, `${key}Answer`]) {
          expect(namespaces[locale]![half], `Landing.${half} missing from ${locale}`)
            .toBeTruthy();
        }
      }
    }
  });

  it("has dropped the numbered FAQ keys the section was cut down from", () => {
    for (const locale of routing.locales) {
      for (const key of RETIRED_FAQ) {
        expect(namespaces[locale]![key], `Landing.${key} still in ${locale}`)
          .toBeUndefined();
      }
    }
  });

  it("has dropped the retired mock-dashboard keys", () => {
    for (const locale of routing.locales) {
      for (const key of RETIRED) {
        expect(namespaces[locale]![key], `Landing.${key} still in ${locale}`)
          .toBeUndefined();
      }
    }
  });
});
