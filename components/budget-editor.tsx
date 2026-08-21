"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveBudgets } from "@/app/actions/budget";
import { formatMoney, type BudgetRow } from "@/lib/insights";

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
        toast.success("Budget saved.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-muted/40 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-[14.5px] font-semibold text-text">Monthly limits</h2>
          <p className="mt-0.5 text-[12.5px] text-text-muted">
            Leave a field empty for no limit.
          </p>
        </div>
        <button
          type="button"
          onClick={applySuggestions}
          disabled={pending}
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-muted disabled:cursor-default disabled:opacity-60"
        >
          <Sparkles className="size-3.5 text-accent" aria-hidden />
          Use suggestions
        </button>
      </div>

      <ul>
        {rows.map((row) => {
          const limit = row.limitMinor;
          const over = limit !== null && row.usedMinor > limit;
          const share = limit && limit > 0 ? (row.usedMinor / limit) * 100 : 0;

          return (
            <li
              key={row.category}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5"
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
                <p className="text-[14px] font-medium text-text">{row.category}</p>
                <p className="mt-0.5 font-mono text-[12px] tabular-nums text-text-subtle">
                  Suggested {formatMoney(row.suggestedMinor)} / month
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
                    ? "spent"
                    : `${share.toFixed(0)}% of limit${over ? " · over" : ""}`}
                </p>
              </div>

              <label className="shrink-0">
                <span className="sr-only">{row.category} monthly limit in CHF</span>
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
                  placeholder="No limit"
                  className="h-9 w-[8.5rem] rounded-md border border-line-strong bg-surface px-2.5 text-right font-mono text-[13px] tabular-nums text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-end gap-3 border-t border-line px-4 py-3 sm:px-5">
        {dirty && (
          <span className="text-[12.5px] text-text-muted">Unsaved changes</span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Save budget
        </button>
      </div>
    </div>
  );
}
