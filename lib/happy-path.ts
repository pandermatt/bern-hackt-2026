import type { AnomalyGroup, AnomalyOverview } from "@/app/actions/anomalies";
import type { SavingsOverview } from "@/app/actions/savings";
import type { Dashboard } from "@/app/actions/transactions";
import type { Transaction } from "@/db/schema";
import {
  detectSubscriptions,
  FIXED_EXPENSE_CATEGORIES,
  periodFromQuestion,
  routeTool,
} from "@/lib/assistant";
import { formatDay, formatMoney } from "@/lib/insights";

/**
 * The happy paths: a handful of questions the app answers from its own
 * aggregates, with the model doing nothing but the wording.
 *
 * The tool loop in `app/actions/chat.ts` is the general case, and it is
 * genuinely general — it can be asked anything. What it cannot be is
 * *guaranteed*: an 8B model has to name the right tool, pass a period it can
 * spell, and then not invent a figure on the way back out, and every one of
 * those steps is a coin flip that costs a round trip. For the questions the
 * app leads with — the starter chips, and "summarize my last ten spendings" —
 * that gamble buys nothing. The data behind them is already computed, already
 * scoped, already correct.
 *
 * So these questions skip the loop entirely. The action fetches the recipe's
 * data itself, this module renders it into a summary from the app's own
 * formatters, and the model is handed one job: say that in two or three
 * sentences, in the reader's language. If the model is slow, garbled, or not
 * configured at all, the rendered summary IS the answer — no tool round, no
 * period to mis-spell, no figure to invent. That is what makes them happy.
 *
 * Pure, like `lib/insights.ts` and `lib/nudges.ts`: no database import, no
 * `server-only`, no i18n call. The wording arrives through `Phrase`, which the
 * action fills from `getTranslations("Chat.happy")` — same arrangement the
 * anomaly nudges use, and what keeps every branch below unit-testable against
 * a stub.
 */

/** The `Chat.happy` translator, narrowed to what this module asks of it. */
export type Phrase = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * Everything the builders below need that is not a figure. The action fills
 * it once per turn from `getTranslations`; passing it as one bundle keeps the
 * builders' signatures about their data rather than about i18n plumbing.
 */
export type HappyContext = {
  /** `getTranslations("Chat.happy")`. */
  phrase: Phrase;
  /** Category keys are stored in English and translated at display — see
   * `lib/use-category-label.ts`. A summary is a display. */
  label: (key: string) => string;
  /** `"2026-07"` → `"Juli 2026"`, via `lib/month-label.ts`. */
  monthName: (month: string) => string;
  /**
   * The year the scoped recipes report on — the newest statement's, not the
   * wall clock's. Against a 2026 export read in 2027, a wall-clock year is an
   * empty window; `resolvePeriod` anchors the same way and for the same
   * reason.
   */
  year: string;
};

export const HAPPY_PATH_IDS = [
  "recent_spending",
  "anomalies",
  "subscriptions",
  "savings_potential",
  "spending_by_category",
] as const;

export type HappyPathId = (typeof HAPPY_PATH_IDS)[number];

/**
 * A rendered answer, before the model touches it. Split into three parts
 * rather than one blob because the parts are what the paraphrase prompt talks
 * about — lead with the headline, compress the lines — and because a test can
 * assert on a line without matching a paragraph.
 */
export type HappySummary = {
  /** One sentence of context. Always present, even when there is no data. */
  headline: string;
  /** The figures, one fact per line. Empty when the headline says it all. */
  lines: string[];
  /** A closing sentence — usually where in the app to go next. */
  note?: string;
};

/** The summary as the plain text both the model and (on failure) the reader
 * see. Bulleted, because the transcript renders `whitespace-pre-wrap`. */
export function renderSummary(summary: HappySummary): string {
  return [
    summary.headline,
    ...summary.lines.map((line) => `• ${line}`),
    ...(summary.note ? [summary.note] : []),
  ].join("\n");
}

/**
 * Time words the English `periodFromQuestion` does not know. German is the
 * default locale, so a German question naming a month would otherwise sail
 * past the guard below and be answered about the wrong window.
 *
 * No `\b` before an umlaut-initial word — JS word boundaries are ASCII-only
 * and never match in front of "ü", the same trap `routeTool` documents.
 */
const GERMAN_PERIOD =
  /\b(januar|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b|märz|letzte[nrms]?\s+(monat|jahr|woche|quartal)|diese[nrms]?\s+(monat|jahr|woche)|vorletzte|\bseit\b|\bim jahr\b/;

/**
 * Does the question name a time window?
 *
 * If it does, it is not a happy path. Every recipe here answers over a fixed
 * scope — the whole history, the year, the last completed month — and a fixed
 * recipe asked about March would quietly answer about something else, which is
 * a worse failure than the round trip it saves. Those questions go to the tool
 * loop, which resolves periods for a living.
 */
function namesAPeriod(question: string): boolean {
  const q = question.toLowerCase();
  return (
    periodFromQuestion(q) !== undefined ||
    GERMAN_PERIOD.test(q) ||
    /\b(19|20)\d{2}\b/.test(q)
  );
}

/**
 * Question → recipe. Deliberately narrow: a miss costs one trip through the
 * tool loop, which is the behaviour that already exists, while a false hit
 * answers a question nobody asked. Ordered like `routeTool`, so
 * "how many subscriptions" reads as a subscriptions question.
 */
const RECIPES: { id: HappyPathId; test: (q: string) => boolean }[] = [
  {
    id: "subscriptions",
    test: (q) =>
      /\b(subscriptions?|recurring)\b|abos?\b|abonnement|wiederkehrend/.test(q),
  },
  {
    id: "anomalies",
    test: (q) =>
      /\b(anomal\w*|suspicious|shady|fraud\w*|scam\w*|unusual)\b|auffällig|verdächtig|ungewöhnlich/.test(
        q,
      ),
  },
  {
    id: "recent_spending",
    // Both halves required: a recency word alone is "last month", a spending
    // noun alone is any of a dozen questions the loop answers better.
    test: (q) =>
      /\b(last|latest|recent|newest)\b|letzt|jüngst|neuest/.test(q) &&
      /\b(spendings?|spend|spent|expenses?|transactions?|payments?|purchases?|charges?|buchungen)\b|ausgaben|transaktionen|zahlungen|einkäufe/.test(
        q,
      ),
  },
  {
    id: "savings_potential",
    // Lifted from `routeTool`'s branch for the same tool: "save" alone is
    // "how much did I save", which is a figure, not advice.
    test: (q) =>
      (/\b(save|saving|savings)\b|spar/.test(q) &&
        /\b(more|less|cut|reduce|potential|possible|where|can|could|wo|kann|könnte|mehr|weniger)\b/.test(
          q,
        )) ||
      /sparpotenzial|sparpotential/.test(q),
  },
  {
    id: "spending_by_category",
    test: (q) =>
      /\b(categor(y|ies))\b|kategorie/.test(q) ||
      /\b(spending|expenses?)\b.*\b(breakdown|split|overview|summary)\b/.test(
        q,
      ) ||
      /ausgaben.*(übersicht|aufteilung|verteilung|zusammenfass)/.test(q),
  },
];

/**
 * The recipe this question takes, or nothing — in which case the caller runs
 * the ordinary tool loop.
 *
 * A row-level question ("which day", "how many", "the single largest") is
 * never a happy path however it is worded: `routeTool` sends those to the SQL
 * escape hatch, and no fixed recipe can answer them. Reusing that predicate
 * rather than writing a second one keeps the two from drifting apart.
 */
export function matchHappyPath(question: string): HappyPathId | undefined {
  const q = question.toLowerCase();
  if (namesAPeriod(q)) return undefined;
  if (routeTool(q) === "run_sql") return undefined;
  return RECIPES.find((recipe) => recipe.test(q))?.id;
}

/** How many rows `recent_spending` lists, when the question does not say. */
export const DEFAULT_RECENT = 10;

/**
 * "summarize my last 10 spendings" → 10. Clamped rather than rejected: the
 * list is the model's input as well as the fallback answer, and forty lines of
 * ledger is a worse prompt than ten.
 */
export function recentCount(question: string): number {
  const match =
    /\b(?:last|latest|newest|top|letzte[nrms]?|jüngste[nrms]?)\s+(\d{1,3})\b/i.exec(
      question,
    );
  if (!match) return DEFAULT_RECENT;
  return Math.min(25, Math.max(3, Number(match[1])));
}

/**
 * The newest expenses, as they appear in the ledger.
 *
 * `rows` arrives newest-first from `listTransactions` (transfers already
 * excluded, like every other figure in the app), so this only has to drop the
 * income and cut the tail.
 */
export function recentSpendingSummary(
  rows: Transaction[],
  limit: number,
  { phrase, label }: HappyContext,
): HappySummary {
  const spending = rows.filter((row) => row.kind === "expense").slice(0, limit);
  if (spending.length === 0) {
    return { headline: phrase("recentEmpty"), lines: [] };
  }
  const total = spending.reduce(
    (sum, row) => sum + Math.abs(row.amountMinor),
    0,
  );
  // Newest first, so the window runs from the LAST row to the first.
  const from = spending[spending.length - 1].bookedOn;
  const to = spending[0].bookedOn;
  const biggest = spending.reduce((worst, row) =>
    Math.abs(row.amountMinor) > Math.abs(worst.amountMinor) ? row : worst,
  );
  return {
    headline: phrase("recentHeadline", {
      count: spending.length,
      total: formatMoney(total),
      from: formatDay(from),
      to: formatDay(to),
    }),
    lines: spending.map((row) =>
      phrase("recentLine", {
        date: formatDay(row.bookedOn),
        merchant: row.merchant,
        category: label(row.category),
        amount: formatMoney(Math.abs(row.amountMinor)),
      }),
    ),
    note: phrase("recentNote", {
      merchant: biggest.merchant,
      amount: formatMoney(Math.abs(biggest.amountMinor)),
    }),
  };
}

/**
 * The stored scan, never a fresh one — a scan is minutes of CPU and belongs to
 * the Account page's button.
 *
 * The four not-ok states are spelled out separately for the same reason
 * `anomaliesToolResult` spells them out for the model: "found nothing" and
 * "never looked" are opposite answers, and only one of them is reassuring.
 */
export function anomaliesSummary(
  overview: AnomalyOverview,
  { phrase }: HappyContext,
): HappySummary {
  if (overview.running) {
    return { headline: phrase("anomaliesRunning"), lines: [] };
  }
  if (!overview.hasCompletedScan) {
    return { headline: phrase("anomaliesNever"), lines: [] };
  }
  if (overview.outdated) {
    return { headline: phrase("anomaliesOutdated"), lines: [] };
  }
  if (overview.action.length === 0 && overview.context.length === 0) {
    return { headline: phrase("anomaliesClean"), lines: [] };
  }
  // `title` and `description` arrive already translated — `getAnomalyOverview`
  // words them through `getAnomalyText()`, the same way the nudges get theirs.
  const line = (group: AnomalyGroup) =>
    phrase("anomaliesLine", {
      title: group.title,
      count: group.transactionCount,
      severity: phrase(`severity.${group.severity}`),
      description: group.description,
    });
  const groups = [
    ...overview.action.slice(0, 6),
    ...overview.context.slice(0, 3),
  ];
  const flagged = groups.reduce(
    (sum, group) => sum + group.transactionCount,
    0,
  );
  return {
    headline: phrase("anomaliesHeadline", {
      groups: groups.length,
      count: flagged,
      action: overview.action.length,
    }),
    lines: groups.map(line),
    note: phrase("anomaliesNote"),
  };
}

/** Recurring charges over the whole history — a year-to-date window would
 * demote every yearly bill, which is why the caller fetches unscoped rows. */
export function subscriptionsSummary(
  rows: Transaction[],
  { phrase }: HappyContext,
): HappySummary {
  const subscriptions = detectSubscriptions(rows);
  if (subscriptions.length === 0) {
    return { headline: phrase("subsEmpty"), lines: [] };
  }
  const yearly = subscriptions.reduce((sum, sub) => sum + sub.yearlyMinor, 0);
  return {
    headline: phrase("subsHeadline", {
      count: subscriptions.length,
      yearly: formatMoney(yearly),
    }),
    lines: subscriptions.map((sub) =>
      phrase("subsLine", {
        merchant: sub.merchant,
        typical: formatMoney(sub.typicalMinor),
        cadence: phrase(`cadence.${sub.cadence}`),
        yearly: formatMoney(sub.yearlyMinor),
      }),
    ),
    note: phrase("subsNote"),
  };
}

/**
 * Where the money could realistically go instead.
 *
 * Two halves, exactly as `savingsPotentialToolResult` assembles them for the
 * model: the month's unassigned francs — the same read the Savings page's
 * Unallocated pot uses, so the two can never quote different figures — and the
 * fixed/flexible split of the year's spending, which says where a cut is even
 * possible. Rent and premiums are not advice.
 */
export function savingsPotentialSummary(
  dashboard: Dashboard,
  overview: SavingsOverview | null,
  { phrase, label, monthName, year }: HappyContext,
): HappySummary {
  const flexible = dashboard.categories.filter(
    (slice) => !FIXED_EXPENSE_CATEGORIES.has(slice.key),
  );
  const fixedTotal = dashboard.categories
    .filter((slice) => FIXED_EXPENSE_CATEGORIES.has(slice.key))
    .reduce((sum, slice) => sum + slice.amount, 0);
  const flexibleTotal = flexible.reduce((sum, slice) => sum + slice.amount, 0);

  // A running month has no final surplus, and a negative one is a real
  // answer — the month overspent. Neither gets floored into a cheerful zero.
  const free =
    overview && overview.month !== null && overview.monthEnded
      ? phrase(overview.freeMinor < 0 ? "potentialOverspent" : "potentialFree", {
          month: monthName(overview.month),
          amount: formatMoney(Math.abs(overview.freeMinor)),
        })
      : phrase("potentialNoMonth");

  return {
    headline: `${free} ${phrase("potentialSplit", {
      year,
      fixed: formatMoney(fixedTotal),
      flexible: formatMoney(flexibleTotal),
    })}`,
    lines: flexible.slice(0, 5).map((slice) =>
      phrase("potentialLine", {
        category: label(slice.key),
        amount: formatMoney(slice.amount),
        share: slice.share.toFixed(1),
      }),
    ),
    note: phrase("potentialNote"),
  };
}

/** The year's spending, split the way the dashboard's donut splits it. */
export function categorySummary(
  dashboard: Dashboard,
  { phrase, label, year }: HappyContext,
): HappySummary {
  const { categories, totals } = dashboard;
  if (categories.length === 0) {
    return { headline: phrase("categoriesEmpty", { year }), lines: [] };
  }
  return {
    headline: phrase("categoriesHeadline", {
      year,
      total: formatMoney(totals.expense),
      count: categories.length,
      payments: totals.expenseCount,
    }),
    lines: categories.slice(0, 8).map((slice) =>
      phrase("categoriesLine", {
        category: label(slice.key),
        amount: formatMoney(slice.amount),
        share: slice.share.toFixed(1),
        payments: slice.count,
      }),
    ),
    note: phrase("categoriesNote"),
  };
}

/**
 * Every amount the summary states, normalized for comparison. Both apostrophe
 * shapes collapse: `formatMoney` groups with U+2019 (see the note on
 * `GROUP_SEPARATOR`), the model copies whichever its training leans towards,
 * and `formatSwissNumbers` rewrites to a straight one on the way out. The
 * figure is the same figure in all three.
 */
function amountsIn(text: string): string[] {
  return [...text.matchAll(/CHF\s?([\d'’.,\s]*\d)/g)].map((match) =>
    match[1].replace(/[’'\s,]/g, ""),
  );
}

/**
 * Does the paraphrase state only figures the summary gave it?
 *
 * The one thing a paraphrase can still get wrong is arithmetic it was never
 * asked to do — totalling the lines, converting a share to francs, rounding
 * "CHF 1’234.55" to "CHF 1’235". Any of those is an invented number on a
 * screen full of real ones, so a reply carrying an amount the summary does not
 * is dropped whole and the summary itself is shown instead. There is no repair
 * pass: the deterministic answer is right there, and it is already correct.
 */
export function keepsFigures(reply: string, summary: string): boolean {
  const known = new Set(amountsIn(summary));
  return amountsIn(reply).every((amount) => known.has(amount));
}

/**
 * The one thing the model is asked to do on a happy path.
 *
 * Note what is *not* here: no tool syntax, no example figure, no schema. Both
 * omissions are the same lesson `SYSTEM_PROMPT` records — a printed tool call
 * teaches the model to type calls instead of making them, and a printed
 * "CHF 1'234.55" once came back reported as the customer's real spending.
 * This prompt offers no tools at all, so the first cannot happen; the second
 * is why the format is described in words rather than shown.
 *
 * "Copy every amount exactly" is the load-bearing line, and `keepsFigures`
 * is what makes it true rather than hoped for.
 */
export const PARAPHRASE_PROMPT = [
  "You are the analytics assistant of Beyond Money, a personal-finance dashboard.",
  "Below the customer's question you are given a summary of their own figures, already computed by the app. It is correct and complete — there is nothing to fetch and nothing to check.",
  "Rewrite that summary as a direct answer to the question.",
  "Use only the figures you were given. Never add, total, convert, round or estimate anything: copy every amount exactly as it is written, apostrophe and both decimals included.",
  "Two to four short sentences of plain text. No markdown, no bullet points, no headings.",
  "Lead with the takeaway — the total, and the one or two largest items — rather than repeating every line.",
  "Never mention the summary, the data, tools, or that you were given anything. Answer as though you simply know.",
].join("\n");

/** The paraphrase prompt in the language the dashboard is being read in — the
 * same argument `systemPromptFor` makes, for the same reason. */
export function paraphrasePromptFor(language: string | undefined): string {
  if (!language) return PARAPHRASE_PROMPT;
  return `${PARAPHRASE_PROMPT}\nAnswer in ${language}. The summary is already in ${language}; keep its wording for merchant, category and finding names.`;
}
