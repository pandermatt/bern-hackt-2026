/**
 * Pure helpers for the chat assistant. No database, no `server-only`: the
 * server action hands a `Dashboard` in, and the client sidebar imports only
 * the types. Both imports below are type-only for the same reason
 * `lib/insights.ts` gives — a value import would drag drizzle into the client
 * bundle, and only `npm run build` would catch it.
 */
import type { Dashboard } from "@/app/actions/transactions";
import type { Slice } from "@/lib/insights";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type PieSlice = {
  label: string;
  amountMinor: number;
  /** 0–100, of the chart's own total — recomputed after folding into "Other". */
  share: number;
};

export type ChartSpec = {
  kind: "pie";
  title: string;
  totalMinor: number;
  slices: PieSlice[];
};

export type AssistantTurn = {
  reply: string;
  chart?: ChartSpec;
  error?: boolean;
};

/** Plain "1234.56" — the model reads decimals better than de-CH apostrophes. */
function chf(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * Everything the model is allowed to know, as a compact figure sheet. Apertus
 * 8B answers from what is in front of it; totals and shares are pre-computed
 * here so it never has to do arithmetic over raw rows.
 */
export function buildSystemPrompt(dashboard: Dashboard): string {
  const { facets, totals, categories, merchants, monthly } = dashboard;

  const categoryLines = categories
    .map((s) => `- ${s.key}: CHF ${chf(s.amount)} (${s.share.toFixed(1)}%)`)
    .join("\n");
  const merchantLines = merchants
    .map((s) => `- ${s.key}: CHF ${chf(s.amount)} over ${s.count} purchases`)
    .join("\n");
  const monthLines = monthly
    .map((m) => `- ${m.label}: in ${chf(m.income)}, out ${chf(m.expense)}`)
    .join("\n");

  return [
    "You are the analytics assistant of Beyond Money, a personal-finance dashboard.",
    "Answer questions about the user's finances using ONLY the figures below.",
    "Be concise: 2–3 short sentences, plain text, no markdown, no lists.",
    "All amounts are Swiss francs — write them as CHF 1234.56.",
    "When a chart is relevant the app attaches a pie chart automatically; give the takeaway, never describe chart shapes.",
    "If the figures below cannot answer the question, say so briefly.",
    "",
    `Accounts: ${facets.accounts.join(", ") || "none"}`,
    `Statement range: ${facets.first || "n/a"} to ${facets.last || "n/a"}`,
    "",
    "Totals (transfers between own accounts excluded):",
    `- Salary income: CHF ${chf(totals.salary)}`,
    `- Refunds from merchants (not earnings): CHF ${chf(totals.refunds)}`,
    `- Total money in: CHF ${chf(totals.income)}`,
    `- Total spending: CHF ${chf(totals.expense)} across ${totals.expenseCount} payments`,
    `- Net saved: CHF ${chf(totals.net)}`,
    "",
    "Spending by category:",
    categoryLines || "- none",
    "",
    "Top merchants by spending:",
    merchantLines || "- none",
    "",
    "Monthly money in / out:",
    monthLines || "- none",
  ].join("\n");
}

/** Top slices plus an "Other" catch-all, shares recomputed over the total. */
function toPie(title: string, slices: Slice[], max = 5): ChartSpec | undefined {
  const positive = slices.filter((s) => s.amount > 0);
  if (positive.length === 0) return undefined;

  const total = positive.reduce((sum, s) => sum + s.amount, 0);
  const top = positive.slice(0, max);
  const rest = positive.slice(max).reduce((sum, s) => sum + s.amount, 0);

  const pie = top.map((s) => ({
    label: s.key,
    amountMinor: s.amount,
    share: (s.amount / total) * 100,
  }));
  if (rest > 0) {
    pie.push({ label: "Other", amountMinor: rest, share: (rest / total) * 100 });
  }

  return { kind: "pie", title, totalMinor: total, slices: pie };
}

/**
 * The chart never comes from the model. An 8B model asked for JSON invents
 * numbers; keyword-matching the question and drawing from the real aggregates
 * means every figure on screen is one the user's statements actually contain.
 */
export function pickChart(
  question: string,
  dashboard: Dashboard,
): ChartSpec | undefined {
  const q = question.toLowerCase();
  const wantsChart =
    /\b(pie|chart|graph|diagram|visuali[sz]e|breakdown|distribution|split|share|proportion)\b/.test(q);

  if (/\b(merchant|shop|store|retailer|vendor)s?\b/.test(q)) {
    return toPie("Top merchants by spending", dashboard.merchants);
  }

  if (/\b(income|earn(ed|ings)?|salary|refunds?)\b/.test(q)) {
    const { salary, refunds } = dashboard.totals;
    const slices: Slice[] = [
      { key: "Salary", amount: salary, count: 0, share: 0 },
      { key: "Refunds", amount: refunds, count: 0, share: 0 },
    ];
    return toPie("Where the money came from", slices);
  }

  if (
    wantsChart ||
    /\b(categor(y|ies)|where .*(go|goes|going|spent?)|spend(ing)?|expenses?|allocat)/.test(q)
  ) {
    return toPie("Spending by category", dashboard.categories);
  }

  return undefined;
}
