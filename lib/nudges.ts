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
/**
 * How close to its limit a category has to sit before the dragon mentions it.
 *
 * Under budget and *nearly* over are different states worth telling apart: a
 * category at 94% has not broken anything, but saying "all clear" about it and
 * then breaking it three days later is how a mascot stops being believed.
 */
const TIGHT = 0.9;

/**
 * What the budget page's numbers add up to, as one word.
 *
 * Split from the mood below for the same reason `severity` and `kind` are
 * split in the anomaly engine: the picture and the sentence have to come from
 * *one* decision, or the dragon ends up celebrating in words while pulling a
 * worried face. The page reads this to pick its copy and hands the same value
 * on to `dragonForBudget`.
 */
/**
 * Whether every transaction a rule flagged has been ticked off.
 *
 * Structurally typed rather than taking `AnomalyGroup`, so this module keeps
 * its "pure, no app imports" shape — and it lives here for the same reason
 * `isOverBudget` does: the comparison was written inline in
 * `getAnomalyOverview` and needed a second caller the moment the dragon
 * started counting.
 *
 * `transactionCount > 0` is load-bearing. A group with nothing in it would
 * otherwise satisfy `0 === 0` and report itself as an achievement.
 */
export function isGroupResolved(group: {
  transactionCount: number;
  resolvedCount: number;
}): boolean {
  return group.transactionCount > 0 && group.resolvedCount === group.transactionCount;
}

export type BudgetVerdict = "unplanned" | "over" | "tight" | "clear";

export function budgetVerdict(rows: BudgetRow[]): BudgetVerdict {
  const limited = rows.filter((row) => row.limitMinor !== null);
  // Nothing set is not the same as nothing wrong — there is simply no budget
  // to be inside of yet, and that is the one case where the dragon has
  // something to *offer* rather than something to report.
  if (limited.length === 0) return "unplanned";
  if (limited.some(isOverBudget)) return "over";
  if (limited.some((row) => row.usedMinor >= (row.limitMinor as number) * TIGHT)) {
    return "tight";
  }
  return "clear";
}

export function dragonForBudget(verdict: BudgetVerdict): DragonMood {
  if (verdict === "over" || verdict === "tight") return "thinking";
  // A budget nobody has set yet is money still to be planned, which is what
  // the coin means everywhere else in the app.
  return verdict === "unplanned" ? "coin" : "celebrate";
}

/**
 * What the anomalies page's findings add up to, as one word.
 *
 * Ordered by what would be most wrong to stay quiet about. "Outdated" outranks
 * a clean result deliberately: a scan that no longer describes the statements
 * saying "nothing looks off" is the single worst thing this page can claim,
 * and it is exactly the claim a mascot makes convincing.
 */
export type AnomalyVerdict =
  | "unscanned"
  | "running"
  | "outdated"
  | "action"
  | "resolved"
  | "context"
  | "clear";

export function anomalyVerdict(input: {
  actionCount: number;
  contextCount: number;
  resolvedGroupCount: number;
  hasCompletedScan: boolean;
  running: boolean;
  outdated: boolean;
}): AnomalyVerdict {
  if (input.running) return "running";
  if (!input.hasCompletedScan) return "unscanned";
  if (input.outdated) return "outdated";
  // **Counts of outstanding work, not of rows on the page.** A rule whose
  // findings are all ticked off is still listed — that is what "show resolved"
  // means — and counting those made the dragon ask for attention that had
  // already been given. See `isGroupResolved`.
  if (input.actionCount > 0) return "action";
  // Everything found, everything ticked off — the one state here worth a
  // celebration, because it is the only one someone actually *did*.
  if (input.contextCount === 0 && input.resolvedGroupCount > 0) return "resolved";
  // Nothing to act on, but notes left to read. Distinct from `clear`, which
  // claims the scan found nothing at all — saying that over a page with three
  // unread notes on it is the same class of lie as `outdated`.
  if (input.contextCount > 0) return "context";
  return "clear";
}

export function dragonForAnomalies(verdict: AnomalyVerdict): DragonMood {
  if (verdict === "action" || verdict === "outdated") return "thinking";
  if (verdict === "resolved") return "celebrate";
  if (verdict === "context") return "happy";
  // Unscanned and running are both "there is something to do here", which is
  // the coin's job — it is the only mood that reads as an offer.
  return verdict === "clear" ? "happy" : "coin";
}

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
