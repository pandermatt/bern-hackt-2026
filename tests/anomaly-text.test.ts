import { createElement, type FunctionComponent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import de from "../messages/de.json";
import en from "../messages/en.json";
import type { AnomalyInsight } from "@/lib/anomaly-engine";
import { useAnomalyText } from "@/lib/anomaly-text";

/*
 * A finding is stored once and read in whichever language its reader is in, so
 * what is worth testing is not the catalog — `anomaly-seed-data.test.ts`
 * renders every rule in both languages already — but the choosing: which of the
 * three possible texts a row ends up showing, and whether the values that are
 * themselves language-dependent come out of the catalogs rather than raw.
 *
 * `createElement` rather than JSX because vitest only collects `.ts` here.
 */

const CATALOGS = { de, en } as const;

/*
 * The provider, typed as the plain component it is here. Its own props type
 * requires `children` to be passed as a prop, which is the one thing
 * `react/no-children-prop` forbids — this takes it back to the ordinary
 * third-argument form both are happy with.
 */
const Provider = NextIntlClientProvider as unknown as FunctionComponent<{
  locale: string;
  messages: (typeof CATALOGS)[keyof typeof CATALOGS];
}>;

/** Renders one finding through the hook, exactly as a component would. */
function render(insight: AnomalyInsight, locale: keyof typeof CATALOGS) {
  function Probe(): ReactElement {
    const anomalyText = useAnomalyText();
    const { title, description } = anomalyText(insight);
    return createElement("i", null, `${title}||${description}`);
  }

  const markup = renderToStaticMarkup(
    createElement(
      Provider,
      { locale, messages: CATALOGS[locale] },
      createElement(Probe),
    ),
  );
  // `&` in a category name comes back as `&amp;` from the HTML serializer.
  const [title, description] = markup
    .replace(/<\/?i>/g, "")
    .replace(/&amp;/g, "&")
    .split("||");
  return { title, description };
}

const base: AnomalyInsight = {
  rule_id: "REPEAT_CHARGE",
  title: "Charged the same amount more than once",
  description: "Edelweiss Air charged CHF 1’766.50 4 times on 18 Sep 2025.",
  params: {
    merchant: "Edelweiss Air",
    amount: "CHF 1’766.50",
    count: 4,
    day: "2025-09-18",
    total: "CHF 7’066.00",
  },
  base_rule_id: "REPEAT_CHARGE",
  severity: "high",
  kind: "warning",
  transaction_ids: [1, 2, 3, 4],
  supporting_metrics: {},
  icon: "lucide:copy",
  emoji: "👯",
};

describe("a deterministic finding", () => {
  it("reads in the language of the page, not of the scan", () => {
    const german = render(base, "de");
    expect(german.title).toBe("Mehrfach belastet");
    expect(german.description).toContain("Edelweiss Air");
    expect(german.description).toContain("CHF 7’066.00");

    const english = render(base, "en");
    expect(english.title).toBe("Charged more than once");
    expect(english.description).toContain("Edelweiss Air");
  });

  it("takes the day from the month catalog, not from the stored key", () => {
    // German writes the ordinal dot, English does not — the same row, two
    // shapes, neither of them `2025-09-18`.
    expect(render(base, "de").description).toContain("18. Sep 2025");
    expect(render(base, "en").description).toContain("18 Sep 2025");
  });

  it("translates a category, a month and a weekday", () => {
    const spike: AnomalyInsight = {
      ...base,
      rule_id: "CATEGORY_SPENDING_SPIKE",
      base_rule_id: "CATEGORY_SPENDING_SPIKE",
      params: {
        category: "Food & Drink",
        amount: "CHF 842.50",
        month: "2025-09",
        growth: "59",
      },
    };
    expect(render(spike, "de").description).toContain("Essen & Trinken");
    expect(render(spike, "de").description).toContain("September 2025");
    expect(render(spike, "en").description).toContain("Food & Drink");

    const unusualDay: AnomalyInsight = {
      ...base,
      rule_id: "UNUSUAL_DAY",
      base_rule_id: "UNUSUAL_DAY",
      params: { merchant: "Coop", weekday: 0, visits: 12 },
    };
    expect(render(unusualDay, "de").description).toContain("Sonntag");
    expect(render(unusualDay, "en").description).toContain("Sunday");
  });

  it("falls back to its stored words when the rule has no message", () => {
    const unknown: AnomalyInsight = {
      ...base,
      rule_id: "SOMETHING_NEW",
      base_rule_id: "SOMETHING_NEW",
    };
    expect(render(unknown, "de").title).toBe(base.title);

    // Same for a row written before findings carried their values.
    const { params, ...withoutParams } = base;
    void params;
    expect(render(withoutParams, "de").description).toBe(base.description);
  });
});

describe("a narrated finding", () => {
  const narrated: AnomalyInsight = {
    ...base,
    rule_id: "COMBINED_INSIGHT",
    title: "Vierfache Belastung bei Edelweiss Air",
    description: "Edelweiss Air hat am 18. September viermal CHF 1’766.50 belastet.",
    narrative_locale: "de",
  };

  it("keeps the model's words for the reader they were written for", () => {
    expect(render(narrated, "de").title).toBe(narrated.title);
  });

  /*
   * The point of keeping the rule and its values alongside the narrative: prose
   * cannot be re-read in another language, so an English reader gets the rule
   * message rather than a German sentence.
   */
  it("gives every other reader the rule's own message instead", () => {
    const english = render(narrated, "en");
    expect(english.title).toBe("Charged more than once");
    expect(english.description).toContain("Edelweiss Air");
    expect(english.description).not.toContain("belastet");
  });
});
