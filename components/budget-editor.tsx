"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveBudgets } from "@/app/actions/budget";
import { Section } from "@/components/section";
import { formatMoney, type BudgetRow } from "@/lib/insights";
import { useCategoryLabel } from "@/lib/use-category-label";

/**
 * The editable half of the budget page.
 *
 * Amounts are held as the strings the user typed, not as parsed numbers: a
 * half-finished "1 8" is a legitimate intermediate state, and re-formatting
 * under the cursor is how an input fights the person using it. Parsing happens
 * once, in the server action.
 *
 * Empty means *no limit*, which is not the same as a limit of zero — the
 * action deletes the row rather than storing 0, so the two cannot collapse.
 */

/** Minor units → the plain decimal an input should hold. */
function toField(minor: number | null): string {
  return minor === null ? "" : (minor / 100).toFixed(2);
}

/**
 * What a field means, for comparison only — the server does the authoritative
 * parse. `null` is "no limit"; `NaN` is something unparseable, which is never
 * equal to anything and so always counts as an unsaved change.
 */
function toMinor(field: string): number | null {
  const cleaned = field.trim().replace(/[’'\s]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : NaN;
}

export function BudgetEditor({ rows }: { rows: BudgetRow[] }) {
  const t = useTranslations("Budget");
  // Category names are data, stored in English; they are translated where they
  // are shown and nowhere else, so `row.category` stays the key everything
  // else — the colour slots, the saved limit — is matched on.
  const categoryLabel = useCategoryLabel();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.category, toField(row.limitMinor)])),
  );

  // Compared as amounts, not as strings: after a save the server echoes back
  // "500.00" for a field the user typed as "500", and a string compare would
  // leave "Unsaved changes" showing forever.
  //
  // There is no effect resyncing this from props. The caller keys the
  // component on the month, so switching months remounts it with fresh inputs
  // — which is what a mount is for, and what an effect doing the same thing
  // would only approximate a render later.
  const dirty = rows.some(
    (row) => toMinor(fields[row.category] ?? "") !== row.limitMinor,
  );

  function applySuggestions() {
    setFields(
      Object.fromEntries(
        rows.map((row) => [row.category, toField(row.suggestedMinor)]),
      ),
    );
  }

  function save() {
    startTransition(async () => {
      const result = await saveBudgets(
        rows.map((row) => ({
          category: row.category,
          amount: fields[row.category] ?? "",
        })),
      );
      if (result.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    /* The ledger's idiom, not a card: the heading sits on the page's own
       ground and the rows are a grey panel underneath, so the budget page
       reads as the same design as the dashboard rather than cards stacked on
       it. `Section` is a plain presentational component, so a client
       component may render it — `monthly-trend.tsx` does the same. */
    <Section id="limits" heading={t("limitsHeading")} meta={t("limitsNote")}>
      {/* Dividers are the panel's surface showing through, the way the
          ledger's month panels do it — white lines rather than grey borders. */}
      <ul className="divide-y divide-surface">
        {rows.map((row) => {
          const limit = row.limitMinor;
          const over = limit !== null && row.usedMinor > limit;
          const share = limit && limit > 0 ? (row.usedMinor / limit) * 100 : 0;

          return (
            <li
              key={row.category}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-hover sm:px-5"
            >
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{
                  background:
                    row.slot === 0
                      ? "var(--chart-other)"
                      : `var(--chart-${row.slot})`,
                }}
                aria-hidden
              />

              <div className="min-w-[9rem] flex-1">
                <p className="text-[14px] font-medium text-text">
                  {categoryLabel(row.category)}
                </p>
                <p className="mt-0.5 font-mono text-[12px] tabular-nums text-text-subtle">
                  {t("suggested", { amount: formatMoney(row.suggestedMinor) })}
                </p>
              </div>

              <div className="w-[8.5rem] shrink-0 text-right">
                <p
                  className={`font-mono text-[13px] tabular-nums ${
                    over ? "text-danger" : "text-text"
                  }`}
                >
                  {formatMoney(row.usedMinor)}
                </p>
                <p className="mt-0.5 font-mono text-[11.5px] tabular-nums text-text-subtle">
                  {limit === null
                    ? t("spent")
                    : t(over ? "shareOfLimitOver" : "shareOfLimit", {
                        share: share.toFixed(0),
                      })}
                </p>
              </div>

              <label className="shrink-0">
                <span className="sr-only">
                  {t("limitFieldLabel", {
                    category: categoryLabel(row.category),
                  })}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fields[row.category] ?? ""}
                  onChange={(event) =>
                    setFields((previous) => ({
                      ...previous,
                      [row.category]: event.target.value,
                    }))
                  }
                  placeholder={t("noLimitPlaceholder")}
                  className="h-9 w-[8.5rem] rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
              </label>
            </li>
          );
        })}
      </ul>

      {/* Both actions at the foot. "Use suggestions" was a header control back
          when this had a header bar of its own; the heading is outside the
          panel now, and a bulk fill of every field below sits better with the
          save it feeds than floating above the rows. */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={applySuggestions}
          disabled={pending}
          /* `bg-surface` with a `surface-hover` hover, not the bare border it
             wore on white: on the grey panel a button that hovers to
             `surface-muted` is hovering to its own ground and nothing
             happens. */
          className="mr-auto flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-60"
        >
          <Sparkles className="size-3.5 text-accent" aria-hidden />
          {t("useSuggestions")}
        </button>

        {dirty && (
          <span className="text-[12.5px] text-text-muted">
            {t("unsavedChanges")}
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("save")}
        </button>
      </div>
    </Section>
  );
}
