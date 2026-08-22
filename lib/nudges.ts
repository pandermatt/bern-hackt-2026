import type { BudgetRow, SavingsPot } from "@/lib/insights";

/**
 * What the entry page has to say today, ranked and capped.
 *
 * Pure, like `lib/insights.ts`: no database import, no i18n call, no `Date`.
 * The anomaly nudges arrive carrying strings that `app/actions/anomalies.ts`
 * has already translated — this module orders them, it does not word them.
 *
 * Three sources, all of which already existed and none of which had a reader
 * on the entry page:
 *
 * - **over budget** — the comparison lived inline in `budget-editor.tsx` and
 *   `budget-radar.tsx` and was exported from neither. `isOverBudget` below is
 *   that predicate, in one place.
 * - **unusual spending** — `getAnomalyOverview(true).action`. The engine already
 *   splits findings into `action` ("has a next step") and `context` ("is a
 *   fact about last month"); only the first kind earns a slot here, and the
 *   `true` drops the rules the reader has already worked through entirely.
 * - **free money** — `SavingsOverview.freeMinor`, which was computed and read
 *   by nothing.
 */

/** Warnings are things that already happened; a tip is an opportunity. */
export type NudgeTone = "warning" | "tip";

export type NudgeSpec =
  | {
      id: string;
      tone: "warning";
      kind: "over-budget";
      category: string;
      /** How far past the limit, in minor units. Always positive. */
      overMinor: number;
      /** The category's palette slot, so the row wears its dashboard colour. */
      slot: number;
    }
  | {
      id: string;
      tone: "warning";
      kind: "anomaly";
      ruleId: string;
      /** Already in the reader's language — see the note above. */
      title: string;
      description: string;
      /** A lucide name, resolved by `components/anomaly-icon.tsx`. */
      icon: string;
      count: number;
    }
  | {
      id: string;
      tone: "tip";
      kind: "free-money";
      month: string;
      amountMinor: number;
    };

/** The mascot's mood. Each maps to a file in `public/dragons`. */
export type DragonMood = "thinking" | "coin" | "celebrate" | "happy";

export const DRAGON_SRC: Record<DragonMood, string> = {
  thinking: "/dragons/05-thinking.webp",
  coin: "/dragons/22-coin.webp",
  celebrate: "/dragons/13-celebrate.webp",
  happy: "/dragons/01-happy.webp",
};

/**
 * A category has overspent only when a limit was actually set.
 *
 * `null` is "no limit", which is not the same as a limit of zero — see the
 * note on the `budgets` table. Without this guard every unbudgeted category
 * would report itself as over the moment it was used at all.
 */
export function isOverBudget(row: BudgetRow): boolean {
  return row.limitMinor !== null && row.usedMinor > row.limitMinor;
}

export type NudgeInput = {
  budget: BudgetRow[];
  anomalies: {
    ruleId: string;
    title: string;
    description: string;
    icon: string;
    transactionCount: number;
  }[];
  savings: {
    month: string | null;
    monthEnded: boolean;
    freeMinor: number;
  };
};

/**
 * Warnings before tips, worst overspend first, then a single opportunity.
 *
 * Capped, because this is an entry page and not an inbox: four rows of things
 * that are wrong is a page nobody opens twice. The full lists live on
 * `/anomalies` and `/budget`, and the nudges link there.
 */
export function rankNudges(input: NudgeInput, limit = 3): NudgeSpec[] {
  const over: NudgeSpec[] = input.budget
    .filter(isOverBudget)
    .map((row) => ({
      id: `over-budget:${row.category}`,
      tone: "warning" as const,
      kind: "over-budget" as const,
      category: row.category,
      overMinor: row.usedMinor - (row.limitMinor ?? 0),
      slot: row.slot,
    }))
    .sort((a, b) => b.overMinor - a.overMinor);

  const flagged: NudgeSpec[] = input.anomalies.map((group) => ({
    id: `anomaly:${group.ruleId}`,
    tone: "warning" as const,
    kind: "anomaly" as const,
    ruleId: group.ruleId,
    title: group.title,
    description: group.description,
    icon: group.icon,
    count: group.transactionCount,
  }));

  // A running month's surplus only shrinks, so it is not money to put away
  // yet — the same contract `monthSurplus` states and `allocateSurplus`
  // enforces on the server.
  const tips: NudgeSpec[] =
    input.savings.month && input.savings.monthEnded && input.savings.freeMinor > 0
      ? [
          {
            id: `free-money:${input.savings.month}`,
            tone: "tip",
            kind: "free-money",
            month: input.savings.month,
            amountMinor: input.savings.freeMinor,
          },
        ]
      : [];

  return [...over, ...flagged, ...tips].slice(0, limit);
}

/**
 * Which dragon greets the reader.
 *
 * Read off the nudges rather than chosen at random, so the mascot means
 * something: it is thinking when something needs attention, holding a coin
 * when there is money to put away, celebrating a finished goal, and simply
 * happy when there is nothing to report.
 */
export function dragonFor(nudges: NudgeSpec[], pots: SavingsPot[] = []): DragonMood {
  if (nudges.some((nudge) => nudge.tone === "warning")) return "thinking";
  if (nudges.some((nudge) => nudge.kind === "free-money")) return "coin";
  // Not "just filled" — nothing here knows when it filled — but "a goal is
  // complete", which is the part worth celebrating anyway.
  if (pots.some((pot) => pot.targetMinor > 0 && pot.savedMinor >= pot.targetMinor)) {
    return "celebrate";
  }
  return "happy";
}
