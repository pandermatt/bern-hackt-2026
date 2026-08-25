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

/**
 * Warnings are things that already happened; a chore is something the app
 * needs from the reader before it can go on telling them the truth; a tip is
 * an opportunity.
 *
 * The middle one earns its own name rather than borrowing "warning": a scan
 * that has gone stale is not a fact about somebody's money, and dressing it in
 * the same red as an overspend would make the red mean less. It wears
 * `--brand` on the card, which is what `/anomalies` already paints that exact
 * state in.
 */
export type NudgeTone = "warning" | "chore" | "tip";

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
      /**
       * How many *other* categories are also over. Only one over-budget card
       * reaches the deck (see `rankNudges`), so this is what keeps the other
       * two from being silently dropped — and it is true of whichever one
       * survives, since it counts the rest either way.
       */
      others: number;
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
    }
  | {
      id: string;
      tone: "tip";
      kind: "unfiled-merchants";
      /** How many merchants have no category on them. */
      count: number;
    }
  | {
      id: string;
      tone: "chore";
      kind: "stale-scan";
    };

/**
 * The mascot's poses, as they are named in `public/dragons`.
 *
 * All 35 of the supplied set, in file order, each entry the file name with its
 * numeric prefix stripped — `DRAGON_SRC` puts the prefix back, so the tuple
 * below reads as a vocabulary rather than as a directory listing. It is
 * deliberately the whole set and not the handful the pages use: it is also the
 * **assistant's allowlist**, and a model asked to pick a face needs faces to
 * pick between. `tests/dragon.test.ts` holds it against the directory and
 * against both message catalogs, which is the drift alarm for 35 files, 35
 * entries and 70 alt strings.
 *
 * Adding a pose means dropping the file in, adding it here in its numbered
 * position, and writing its alt line in `de` and `en`. Nothing else reads the
 * order.
 */
export const DRAGON_MOODS = [
  "happy",
  "wink",
  "laughing",
  "sad",
  "thinking",
  "surprised",
  "angry",
  "in-love",
  "heart-hug",
  "thumbs-up",
  "idea",
  "cool",
  "celebrate",
  "yes",
  "no",
  "typing",
  "support",
  "reading",
  "coffee",
  "sleeping",
  "knocked-out",
  "coin",
  "broke",
  "piggy-bank",
  "jackpot",
  "rich",
  "money-bag",
  "cash-hug",
  "zoom",
  "detective",
  "hero",
  "victory",
  "zen",
  "peeking",
  "bye",
] as const;

export type DragonMood = (typeof DRAGON_MOODS)[number];

/**
 * Where each pose lives. Built from the tuple rather than written out, so a
 * mood can never name a file that is not there — the index is the file's own
 * number, one-based and zero-padded, which is how the assets are named.
 */
export const DRAGON_SRC: Record<DragonMood, string> = Object.fromEntries(
  DRAGON_MOODS.map((mood, index) => [
    mood,
    `/dragons/${String(index + 1).padStart(2, "0")}-${mood}.webp`,
  ]),
) as Record<DragonMood, string>;

/** Whether a string the model wrote names a pose we actually have. */
export function isDragonMood(value: unknown): value is DragonMood {
  return (
    typeof value === "string" && (DRAGON_MOODS as readonly string[]).includes(value)
  );
}

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

/**
 * Whether an overspend is worth *saying something about*.
 *
 * A separate predicate rather than a condition folded into `isOverBudget`,
 * because the two are different questions and only one of them is arithmetic.
 * Rent over its limit is still over its limit — `/budget` prints that row in
 * red either way, and the radar still draws the spoke outside the ring. What
 * the switch governs is whether the dragon brings it up, and this is the
 * predicate everything that *warns* asks: the entry page's deck, the budget
 * page's own verdict.
 */
export function warnsOverBudget(row: BudgetRow): boolean {
  return isOverBudget(row) && row.warnOverspend;
}

/**
 * The least unassigned money worth a nudge: CHF 100.
 *
 * The gate is on the *pool* — everything the ended months left over that the
 * pots do not yet hold — not on the single month's surplus: CHF 500 sitting
 * unassigned is worth a prompt even if the month that just ended only added
 * CHF 12 of it. Below the floor the tip is noise (a ceremony over fifty
 * rappen) and costs one of only three slots. The money is not hidden either
 * way: the Savings page still shows and allocates any positive amount, this
 * only keeps the entry page quiet about it.
 */
export const FREE_MONEY_MIN_MINOR = 10_000;

/**
 * How many unfiled merchants it takes before the dragon mentions them.
 *
 * More than ten, because under that it is quicker to pick the categories than
 * to read a nudge about picking them — and this competes for one of only three
 * slots with things that are actually wrong. Past a dozen it is a chore nobody
 * starts unaided, which is exactly when the auto-file button on `/account` is
 * worth pointing at.
 */
export const UNFILED_MERCHANTS_FLOOR = 10;

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
    /** Pooled across every ended month, less what the pots already hold. */
    freeMinor: number;
  };
  /**
   * Merchants the importer could not place and nobody has filed since — the
   * count `/account`'s merchant panel shows on its folded summary.
   */
  unfiledMerchants: number;
  /**
   * The last scan ran over statements that have since changed — a content
   * comparison, never a timestamp one; see `fingerprintOf`. False while a scan
   * is in flight, since that is about to stop being true.
   */
  staleScan: boolean;
};

/**
 * Warnings, then chores, then tips — and **at most one of each kind**.
 *
 * Capped at three, because this is an entry page and not an inbox: four rows of
 * things that are wrong is a page nobody opens twice. But a cap alone let one
 * kind take the whole deck — three categories over budget filled all three
 * slots with the same sentence about three different categories, which reads as
 * one problem repeated rather than as three, and hid everything else the page
 * had to say. One of each kind is what makes the deck a summary of the account
 * rather than the top of one list.
 *
 * Nothing is lost by it: the full lists live on `/budget` and `/anomalies` and
 * the cards link there, and the over-budget card carries `others` so it can say
 * how many more there are.
 */
export function rankNudges(input: NudgeInput, limit = 3): NudgeSpec[] {
  const over: NudgeSpec[] = input.budget
    // The warning predicate, not the arithmetic one — and it is what `others`
    // counts too, or the card claims overspends the reader has silenced.
    .filter(warnsOverBudget)
    .map((row) => ({
      id: `over-budget:${row.category}`,
      tone: "warning" as const,
      kind: "over-budget" as const,
      category: row.category,
      overMinor: row.usedMinor - (row.limitMinor ?? 0),
      slot: row.slot,
      others: 0,
    }))
    .sort((a, b) => b.overMinor - a.overMinor)
    // Every one of them is true about the rest, so whichever survives the
    // one-per-kind filter below can say it.
    .map((nudge, _index, all) => ({ ...nudge, others: all.length - 1 }));

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
    input.savings.month &&
    input.savings.monthEnded &&
    input.savings.freeMinor >= FREE_MONEY_MIN_MINOR
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

  /*
   * After the money, before nothing. A pile of unfiled merchants is not wrong
   * the way an overspend is — it is a chore, and one the account holder cannot
   * see the cost of: an unfiled merchant sits in `Other`, where it silently
   * skews the donut and every budget it should have counted against. The floor
   * is what keeps it off the page until it is worth a slot.
   */
  if (input.unfiledMerchants > UNFILED_MERCHANTS_FLOOR) {
    tips.push({
      id: "unfiled-merchants",
      tone: "tip",
      kind: "unfiled-merchants",
      count: input.unfiledMerchants,
    });
  }

  /*
   * Above the tips and below the warnings, and it is the reason the two lists
   * above it may be short: `/home` passes no anomaly nudges at all while a
   * scan is out of date, because a stale finding describes transactions that
   * no longer exist. Without this card the deck would simply go quiet about
   * them and never say why.
   */
  const chores: NudgeSpec[] = input.staleScan
    ? [{ id: "stale-scan", tone: "chore", kind: "stale-scan" }]
    : [];

  const seen = new Set<NudgeSpec["kind"]>();
  return [...over, ...flagged, ...chores, ...tips]
    .filter((nudge) => {
      if (seen.has(nudge.kind)) return false;
      seen.add(nudge.kind);
      return true;
    })
    .slice(0, limit);
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
  // The ones worth reporting: a category whose warning is switched off is
  // over, and deliberately not news.
  if (limited.some(warnsOverBudget)) return "over";
  if (limited.some((row) => row.usedMinor >= (row.limitMinor as number) * TIGHT)) {
    return "tight";
  }
  return "clear";
}

/**
 * A face per verdict, and no two verdicts sharing one.
 *
 * Over and tight used to be the same picture, which threw away the distinction
 * `budgetVerdict` exists to draw: having broken a limit and being about to are
 * different news, and the mascot is the fastest thing on the page to read. So
 * over is sorry about it and tight is still thinking. Unplanned is the idea
 * rather than the coin it used to be: there is nothing to put away on a page
 * of limits, there is a budget to set — and the coin goes on meaning money,
 * which is what `dragonFor` still uses it for on `/home`.
 */
export function dragonForBudget(verdict: BudgetVerdict): DragonMood {
  if (verdict === "over") return "sad";
  if (verdict === "tight") return "thinking";
  return verdict === "unplanned" ? "idea" : "celebrate";
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

/**
 * One face per verdict here too, and this page is where the wider set earns
 * itself: looking for things that are off is detective work, and it has a
 * drawing. Reading a scan, running one and having found nothing were three
 * states wearing two faces before.
 *
 * `outdated` still gets a face even though the page renders no mascot for it —
 * the verdict is what tells the page to stay quiet, and a function that
 * returned nothing for one arm would push that decision into the caller.
 */
export function dragonForAnomalies(verdict: AnomalyVerdict): DragonMood {
  if (verdict === "action") return "detective";
  if (verdict === "outdated") return "thinking";
  if (verdict === "resolved") return "victory";
  if (verdict === "context") return "reading";
  if (verdict === "running") return "typing";
  // Nothing found is a quiet account, not an achievement — see the note on
  // `anomalyVerdict`. Zen rather than a celebration.
  return verdict === "clear" ? "zen" : "zoom";
}

export function dragonFor(nudges: NudgeSpec[], pots: SavingsPot[] = []): DragonMood {
  if (nudges.some((nudge) => nudge.tone === "warning")) return "thinking";
  // The same pose `/anomalies` wears for the same state, so the mascot does
  // not change its mind about an out-of-date scan between two pages.
  if (nudges.some((nudge) => nudge.kind === "stale-scan")) return "zoom";
  if (nudges.some((nudge) => nudge.kind === "free-money")) return "coin";
  // A job he can offer to do, which is what the pose is for. It outranks the
  // finished goal below for the same reason free money does: a state with a
  // next step beats a state without one.
  if (nudges.some((nudge) => nudge.kind === "unfiled-merchants")) return "idea";
  // Not "just filled" — nothing here knows when it filled — but "a goal is
  // complete", which is the part worth celebrating anyway.
  if (pots.some((pot) => pot.targetMinor > 0 && pot.savedMinor >= pot.targetMinor)) {
    return "celebrate";
  }
  return "happy";
}

/**
 * What the savings page's pots add up to, as one word.
 *
 * Same split as `budgetVerdict` and `anomalyVerdict`, for the same reason: the
 * page reads this to pick its copy and hands the identical value to
 * `dragonForSavings`, so the picture and the sentence cannot disagree.
 *
 * Ordered by what the reader can *do* about it. A pool in the red outranks
 * everything — no allocation is possible out of it, so congratulating anyone
 * on a well-funded pot above an overdrawn account would be the same class of
 * lie `outdated` guards against on `/anomalies`. Free money outranks "every
 * goal is met" for the opposite reason: it is the one state with a next step.
 */
export type SavingsVerdict =
  | "no-goals"
  | "overdrawn"
  | "free"
  | "funded"
  | "saving";

export function savingsVerdict(input: {
  pots: SavingsPot[];
  /** Every franc the ended months left over, less what the pots hold. */
  freeMinor: number;
  /** The pool itself. Negative is an account that has spent more than it made. */
  pooledMinor: number;
}): SavingsVerdict {
  if (input.pooledMinor <= 0) return "overdrawn";
  if (input.pots.length === 0) return "no-goals";
  if (input.freeMinor >= FREE_MONEY_MIN_MINOR) return "free";
  // "Every goal with a target has met it". A pot with no target is a jar
  // nobody set a lid on — it can never be full, and it must not hold the
  // whole page back from saying so either.
  const targeted = input.pots.filter((pot) => pot.targetMinor > 0);
  if (
    targeted.length > 0 &&
    targeted.every((pot) => pot.savedMinor >= pot.targetMinor)
  ) {
    return "funded";
  }
  return "saving";
}

export function dragonForSavings(verdict: SavingsVerdict): DragonMood {
  // The offered hand rather than the idea: `/budget` already wears the idea
  // for its own nothing-set-up-yet state, and the two pages sit one tab apart.
  // A reader crossing between them should not meet the same drawing twice.
  if (verdict === "no-goals") return "support";
  if (verdict === "overdrawn") return "broke";
  // The one state with a next step gets the picture that reads as an offer —
  // the same job the coin does on `/home`, one size up because this page is
  // where the money actually lands.
  if (verdict === "free") return "money-bag";
  return verdict === "funded" ? "jackpot" : "piggy-bank";
}

/**
 * What the ledger adds up to, as one word.
 *
 * Plain numbers rather than a `Dashboard`: this module has no app imports and
 * keeps none — see the note at the top. The page holds all three already.
 *
 * "Nothing matched" and "nothing imported" are deliberately separate, the same
 * distinction `Dashboard.noMatches` and `Dashboard.nothingImported` already
 * draw in the subtitle: a filter that kept nothing is a thing to undo, an
 * empty account is a thing to fill.
 */
export type LedgerVerdict =
  | "empty"
  | "no-matches"
  | "negative"
  | "positive"
  | "even";

export function ledgerVerdict(input: {
  /** Rows the filters kept. */
  count: number;
  /** Whether the account has any statements at all, filters aside. */
  hasStatements: boolean;
  /** Income less spending over the rows in view. */
  netMinor: number;
}): LedgerVerdict {
  if (!input.hasStatements) return "empty";
  if (input.count === 0) return "no-matches";
  if (input.netMinor < 0) return "negative";
  return input.netMinor > 0 ? "positive" : "even";
}

export function dragonForLedger(verdict: LedgerVerdict): DragonMood {
  if (verdict === "empty") return "reading";
  // Looking for something that is not there. The same glass the anomalies page
  // reaches for before it has scanned, and for the same reason.
  if (verdict === "no-matches") return "zoom";
  if (verdict === "negative") return "sad";
  // A month that broke exactly even is neither news nor an achievement.
  return verdict === "positive" ? "thumbs-up" : "cool";
}
