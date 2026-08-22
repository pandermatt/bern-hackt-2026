import { useLocale, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

/**
 * A finding, in the reader's language.
 *
 * The engine writes English, and it has to: its sentences are read by the
 * narrative layer, they are what a row stored before this file existed still
 * carries, and a scan has no reader to write for anyway — it runs in the
 * background, long after the request that started it returned. So a finding is
 * stored twice over: as the sentence it produced, and as the rule that produced
 * it plus the values that rule needs (`params`). This turns the second one back
 * into a sentence, in whichever language the page is in.
 *
 * The model's narratives are the exception, because prose cannot be re-read in
 * another language: those are shown only to a reader in the language they were
 * written for, and everyone else gets the rule message instead. That is what
 * `narrative_locale` is for.
 *
 * Two entry points over one resolver, because the findings surface in both
 * kinds of component: `useAnomalyText` for the ledger and its panels, which
 * render synchronously (on the server, and this file carries no `use client`
 * directive on purpose), and `getAnomalyText` for the async server actions that
 * fold findings into the anomalies overview before any component sees them.
 */

export type AnomalyText = { title: string; description: string };

/**
 * What the resolver needs of a finding.
 *
 * A structural type rather than `AnomalyInsight`, so a database row — where the
 * three optional fields are `null` rather than absent — can be passed straight
 * in without being rebuilt into an insight first.
 */
export type TranslatableFinding = {
  rule_id: string;
  title: string;
  description: string;
  params?: Record<string, string | number> | null;
  base_rule_id?: string | null;
  narrative_locale?: string | null;
};

/**
 * The shape both `useTranslations` and `getTranslations` return.
 *
 * next-intl types the two separately and neither is exported, so the resolver
 * takes this and each entry point hands its own translator over.
 */
type Catalog = ((key: string, values?: Record<string, string | number>) => string) & {
  has: (key: string) => boolean;
};

type Catalogs = {
  locale: string;
  findings: Catalog;
  categories: Catalog;
  months: Catalog;
};

/** `YYYY-MM`, the month key the engine passes for month-level findings. */
const MONTH_VALUE = /^(\d{4})-(\d{2})$/;

/** `YYYY-MM-DD`, a booking day — text, never a `Date`. See `lib/insights.ts`. */
const DAY_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Most values are already language-neutral — an amount is formatted `de-CH`
 * everywhere in this app, and a merchant name is a name. The three that are not
 * are resolved against the catalogs the rest of the UI uses, so a category
 * reads the same inside a finding as it does in the row below it.
 *
 * A month and a day are recognised by their shape rather than by their key,
 * because both only ever arrive as the keys the engine stores.
 */
function resolveValues(
  params: Record<string, string | number>,
  { findings, categories, months }: Catalogs,
): Record<string, string | number> {
  const values: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key === "weekday") {
      values[key] = findings(`weekday${value}`);
      continue;
    }
    if (typeof value !== "string") {
      values[key] = value;
      continue;
    }
    if (key === "category") {
      // Unknown categories fall through as themselves, exactly as the ledger
      // does with the value it filters on.
      values[key] = categories.has(value) ? categories(value) : value;
      continue;
    }
    const month = MONTH_VALUE.exec(value);
    if (month) {
      values[key] = `${months(`long${Number(month[2])}`)} ${month[1]}`;
      continue;
    }
    const day = DAY_VALUE.exec(value);
    if (day) {
      values[key] = months("day", {
        day: Number(day[3]),
        month: months(`short${Number(day[2])}`),
        year: day[1],
      });
      continue;
    }
    values[key] = value;
  }

  return values;
}

function resolver(catalogs: Catalogs): (finding: TranslatableFinding) => AnomalyText {
  return (finding) => {
    const stored = { title: finding.title, description: finding.description };

    // Written by the model, for a reader in this language: nothing beats it.
    if (finding.narrative_locale === catalogs.locale) return stored;

    const rule = finding.base_rule_id ?? finding.rule_id;
    if (!finding.params || !catalogs.findings.has(`${rule}.title`)) return stored;

    return {
      title: catalogs.findings(`${rule}.title`),
      description: catalogs.findings(
        `${rule}.description`,
        resolveValues(finding.params, catalogs),
      ),
    };
  };
}

/** For components that render synchronously — the ledger rows and their panels. */
export function useAnomalyText(): (finding: TranslatableFinding) => AnomalyText {
  return resolver({
    locale: useLocale(),
    findings: useTranslations("AnomalyFindings") as unknown as Catalog,
    categories: useTranslations("Categories") as unknown as Catalog,
    months: useTranslations("Months") as unknown as Catalog,
  });
}

/** For async server code — the actions that fold findings before rendering. */
export async function getAnomalyText(): Promise<
  (finding: TranslatableFinding) => AnomalyText
> {
  const [locale, findings, categories, months] = await Promise.all([
    getLocale(),
    getTranslations("AnomalyFindings"),
    getTranslations("Categories"),
    getTranslations("Months"),
  ]);

  return resolver({
    locale,
    findings: findings as unknown as Catalog,
    categories: categories as unknown as Catalog,
    months: months as unknown as Catalog,
  });
}
