"use client";

import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";

import type { SavedLimit } from "@/app/actions/budget";
import { BudgetEditor } from "@/components/budget-editor";
import { BudgetMonthPicker } from "@/components/budget-month-picker";
import { BudgetRadar } from "@/components/budget-radar";
import { Section } from "@/components/section";
import { formatMoney, type BudgetRow } from "@/lib/insights";

/**
 * The budget page's two halves, and the one thing they have to agree on.
 *
 * Every spoke of the radar is drawn as a share of that category's *limit*, so
 * the numbers the editor saves are the numbers the chart is made of. Saving
 * used to leave the two out of step for as long as the round trip took — the
 * inputs held the new limits while the dial above them still drew the old ones
 * — because the chart only learned of the save when the refreshed server
 * render came back. Measured against a throttled connection that was up to a
 * second of one page showing two different budgets.
 *
 * So this holds the confirmed limits and applies them the moment the action
 * returns, and `router.refresh()` in the editor still runs behind it. That is
 * the shape of it: an **overlay on the server's rows, not a replacement for
 * them**. `usedMinor` and `suggestedMinor` come out of the statements and are
 * the server's alone; `limitMinor` is the only field a save can change, and it
 * is the only one overlaid.
 *
 * Both halves live here rather than on the page because they read the same
 * figures: the meta line's totals are the same limits the radar draws and the
 * editor edits, and a heading that still says "no limits set" over a chart
 * that has them would be the original bug moved one line up.
 */
export function BudgetBoard({
  rows,
  months,
  month,
  /** Already localised — the `Months` namespace stays on the server. */
  monthName,
}: {
  rows: BudgetRow[];
  months: string[];
  month: string | null;
  monthName: string | null;
}) {
  const t = useTranslations("Budget");

  // What the last successful save wrote. `null` inside the map is a *cleared*
  // limit, which is not the same as a limit of zero — the same distinction the
  // action makes when it deletes a row rather than storing 0.
  const [saved, setSaved] = useState<Map<string, number | null> | null>(null);

  // Dropped again as soon as the server's own rows say the same thing, so the
  // overlay cannot outlive the refresh it is covering for and mask a limit that
  // changed some other way (another tab, say). Adjusted during render rather
  // than from an effect: the condition converges — once cleared, only another
  // save can set it again — and an effect would paint one frame of the stale
  // reading first, which is the very thing this component exists to avoid.
  const settled =
    saved !== null &&
    rows.every((row) => limitOf(row, saved) === row.limitMinor);
  if (settled) setSaved(null);

  const live =
    saved === null
      ? rows
      : rows.map((row) => ({ ...row, limitMinor: limitOf(row, saved) }));

  function onSaved(limits: SavedLimit[]) {
    setSaved(new Map(limits.map((limit) => [limit.category, limit.limitMinor])));
  }

  const totalUsed = live.reduce((sum, row) => sum + row.usedMinor, 0);
  const totalLimit = live.reduce((sum, row) => sum + (row.limitMinor ?? 0), 0);
  const budgeted = live.filter((row) => row.limitMinor !== null).length;

  return (
    /* No `space-y` — every Section brings its own `pt-6`, the rhythm the
       dashboard, the ledger and the anomalies page already run on. */
    <div>
      <Section
        id="radar"
        heading={t("radarHeading")}
        meta={
          /* `month` is non-null whenever there are rows — `budgetRows` returns
             [] without one — but that is not something the type carries, and
             "no month" has nothing to say about a month anyway. Tested through
             `monthName` rather than `month` so the narrowing reaches the value
             actually interpolated below; the two are null together by
             construction. */
          budgeted === 0 || !monthName
            ? t("radarNoLimits")
            : t("radarMeta", {
                spent: formatMoney(totalUsed),
                limit: formatMoney(totalLimit),
                month: monthName,
              })
        }
        panelClassName="p-4 sm:p-5"
      >
        {/* The month lives with the chart it refits, not up beside the page
            title — the radar's rim is refitted to whichever month is picked,
            and every figure in the panel follows it. */}
        {month && months.length > 1 && (
          <div className="mb-3 flex justify-end">
            <Suspense fallback={null}>
              <BudgetMonthPicker months={months} month={month} />
            </Suspense>
          </div>
        )}

        <BudgetRadar rows={live} />
      </Section>

      {/* Keyed on the month: the editor holds the typed-but-unsaved values in
          state, and switching months has to start it over. The overlay above
          deliberately does *not* reset with it — a limit belongs to a category,
          not to a month, so what was just saved is still true in the month
          being switched to. */}
      <BudgetEditor key={month} rows={live} onSaved={onSaved} />
    </div>
  );
}

/**
 * The limit a row should be drawn with: the overlay's, where the save covered
 * that category, and the server's otherwise.
 *
 * `has` rather than `??`, because a saved `null` is a real answer — "this
 * category has no limit" — and coalescing would make it indistinguishable from
 * a category the save never mentioned.
 */
function limitOf(
  row: BudgetRow,
  saved: Map<string, number | null>,
): number | null {
  return saved.has(row.category)
    ? (saved.get(row.category) ?? null)
    : row.limitMinor;
}
