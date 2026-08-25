"use client";

import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  saveMerchantOverrides,
  suggestCategoriesForUnfiled,
  type MerchantMapping,
} from "@/app/actions/merchant-overrides";
import { MerchantAvatar } from "@/components/merchant-avatar";
import { formatMoney } from "@/lib/insights";
import { useCategoryLabel } from "@/lib/use-category-label";

/** How many rows show before the list asks to be unfolded. */
const PREVIEW = 12;

type Field = { category: string; domain: string };

/**
 * The merchants the importer could not place, and what to do with them.
 *
 * `scripts/lib/statement.ts` files anything its rules cannot recognise under
 * `Other`, and `lib/merchant-brands.ts` has no mark for most of them. Both are
 * code, shipped for everybody, and neither can be taught about a statement
 * somebody uploads. This is where the account holder answers both questions for
 * themselves — the category the lines should read as, and the domain the logo
 * comes from — and the answers are stored per account and applied on read (see
 * `db/schema.ts`, `merchant_overrides`).
 *
 * Two things about the list are deliberate:
 *
 * - **A merchant stays on it after being filed.** The list is "what the
 *   importer could not place", which is a fact about the statement and does not
 *   change when somebody makes a decision about it — and a row that vanished on
 *   save would read as the save having eaten it. The select shows the decision
 *   instead.
 * - **`Other` is a real option, and choosing it clears the row.** "Leave it
 *   alone" is the absence of an opinion rather than an opinion that it belongs
 *   in `Other`, so it is stored as no row at all.
 *
 * Fields are held as typed, and parsed once in the server action — the same
 * split `components/budget-editor.tsx` makes, for the same reason: a
 * half-finished "uzh." is a legitimate intermediate state and a field that
 * rewrites itself under the cursor is a field fighting the person using it.
 *
 * **The whole thing ships folded, behind a count of what still wants a
 * decision.** It is the longest block on `/account` by a distance — one row per
 * unrecognised merchant, each with two controls — and it sat open between the
 * settings above it and the danger zone below, so on a real statement the page
 * was mostly this. Folded, the panel is one line that says whether opening it
 * is worth anything.
 *
 * It is a native `<details>`, not React state: a disclosure that a person can
 * open is exactly what the element is, it arrives folded from the server with
 * no hydration and no flash, it still opens with JS off, and the keyboard and
 * screen-reader behaviour comes for free. Nothing animates — a `<details>`
 * hides its content with `display: none`, which does not interpolate, and the
 * JS-driven alternative (`0fr → 1fr`, as the nudge deck does it) would trade
 * that whole list working without JS for a 300ms slide.
 */
export function MerchantMapper({
  mapping,
  defaultOpen = false,
}: {
  mapping: MerchantMapping;
  /**
   * Arrives open rather than folded — what `/account?merchants=open` asks for,
   * which is how `/home`'s nudge lands the reader on the list it just offered
   * to fill in. Uncontrolled after that: React writes the attribute once, and
   * the disclosure is the reader's from then on.
   */
  defaultOpen?: boolean;
}) {
  const t = useTranslations("MerchantMapping");
  // Category names are data, stored in English; they are translated where they
  // are shown and nowhere else, so the option's *value* stays the stored key.
  const categoryLabel = useCategoryLabel();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, startAsking] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<Record<string, Field>>(() =>
    Object.fromEntries(
      mapping.merchants.map((row) => [
        row.merchant,
        { category: row.category, domain: row.domain },
      ]),
    ),
  );

  /* The fields as of the last render, for `autoFile` to read after its await.
     A ref rather than the closure, which is a snapshot of one render. */
  const fieldsRef = useRef(fields);
  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  /** The saved row behind each merchant, for a name the form has no field for
   *  yet — a merchant that arrived in the mapping after this form mounted. */
  const byName = new Map(mapping.merchants.map((row) => [row.merchant, row]));

  const dirty = mapping.merchants.some((row) => {
    const field = fields[row.merchant];
    return (
      field !== undefined &&
      (field.category !== row.category || field.domain.trim() !== row.domain)
    );
  });

  function update(merchant: string, patch: Partial<Field>) {
    setFields((previous) => ({
      ...previous,
      [merchant]: { ...previous[merchant], ...patch },
    }));
  }

  /**
   * Fills in the merchants nobody has filed yet, from the model's reading of
   * their names.
   *
   * **Into the form, not into the database.** The selects change, the "unsaved
   * changes" hint lights up and Save does what it always did — so the answers
   * are reviewed by the person whose money they re-file before they reach
   * anything. The action is deliberately argument-less; see its own note.
   *
   * A merchant that already carries a decision is left alone, whether that
   * decision is saved or still sitting in this form: the suggestion is for the
   * rows nobody has answered, and quietly overruling an answer is not what the
   * button says it does.
   */
  function autoFile() {
    startAsking(async () => {
      const result = await suggestCategoriesForUnfiled();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      /* Read through the ref, not the closure: this runs after a network round
         trip, and the `fields` this function captured is the one from the
         render it was created in. Counted here rather than inside a functional
         updater, because an updater does not run until the re-render — the
         toast would be reading a zero either way. */
      const base = fieldsRef.current;
      const next = { ...base };
      let filed = 0;

      for (const [merchant, category] of Object.entries(result.suggestions)) {
        const current = base[merchant]?.category ?? byName.get(merchant)?.category;
        // Only the rows nobody has answered. A merchant already filed — saved,
        // or chosen in this form a moment ago — keeps what it was given.
        if (current !== mapping.unfiled) continue;
        next[merchant] = {
          category,
          // Whatever domain the row carries; this button is about categories.
          domain: base[merchant]?.domain ?? byName.get(merchant)?.domain ?? "",
        };
        filed++;
      }

      if (filed > 0) setFields(next);
      toast[filed > 0 ? "success" : "info"](
        filed > 0 ? t("autoFiled", { count: filed }) : t("autoFiledNone"),
      );
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveMerchantOverrides(
        mapping.merchants.map((row) => ({
          merchant: row.merchant,
          category: fields[row.merchant]?.category ?? mapping.unfiled,
          domain: fields[row.merchant]?.domain ?? "",
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

  if (mapping.merchants.length === 0) {
    return (
      <p className="px-4 py-3.5 text-[13.5px] text-text-muted sm:px-5">
        {t("empty")}
      </p>
    );
  }

  const shown = expanded
    ? mapping.merchants
    : mapping.merchants.slice(0, PREVIEW);

  /* Counted off the fields rather than off `mapping`, so the summary and the
     rows under it can never disagree: filing a merchant drops the count as the
     select changes, and the "unsaved changes" hint beside Save is what says
     that has not reached the database yet. */
  const undecided = mapping.merchants.filter(
    (row) => (fields[row.merchant]?.category ?? row.category) === mapping.unfiled,
  ).length;

  return (
    <details className="group" open={defaultOpen || undefined}>
      {/* `list-none` plus the webkit rule removes the native triangle — the
          chevron on the right is the app's own affordance, and two markers on
          one row read as two controls. */}
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-[14px] font-medium text-text">
          {/* Nothing left to decide is a different sentence, not a "0" — the
              list is still there and still worth opening, and a zero would
              read as an empty panel. */}
          {undecided > 0
            ? t("summary", { count: undecided })
            : t("summaryAllFiled", { count: mapping.merchants.length })}
        </span>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-text-subtle transition-transform group-open:rotate-180"
        />
      </summary>

      {/* The rule only exists while the panel is open: a `<details>` hides its
          content outright, so a border on the summary itself would leave a
          line across the bottom of a folded panel. */}
      <div className="border-t border-surface">
        {/* Dividers are the panel's own surface showing through, the way every
            other settings group does it — a grey border on grey is invisible. */}
        <ul className="divide-y divide-surface">
          {shown.map((row) => {
            const field = fields[row.merchant] ?? {
              category: row.category,
              domain: row.domain,
            };

            return (
              <li
                key={row.merchant}
                className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3 sm:px-5"
              >
                <div className="flex min-w-0 flex-1 basis-[13rem] items-center gap-2.5">
                  {/* Keyed on the saved domain, and versioned by it: the mark is
                      cached per account for an hour, and this is the one page
                      where somebody has just changed which domain it comes from
                      and is looking straight at it. */}
                  <MerchantAvatar
                    name={row.merchant}
                    size={20}
                    version={row.domain || undefined}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-text">
                      {row.merchant}
                    </p>
                    <p className="text-[13px] text-text-muted">
                      {t("lines", { count: row.count })}
                      {" · "}
                      <span className="font-mono tabular-nums">
                        {formatMoney(row.spentMinor)}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Stacked below `sm`, side by side from there. Sharing one
                    phone row left the select about 200px wide, which truncates
                    the longest option — and the longest option is the default
                    one every unfiled merchant is showing. */}
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <label className="min-w-0 sm:flex-none">
                    <span className="sr-only">
                      {t("categoryFieldLabel", { merchant: row.merchant })}
                    </span>
                    <select
                      value={field.category}
                      onChange={(event) =>
                        update(row.merchant, { category: event.target.value })
                      }
                      /* 16px on a phone, 13px from `sm`: anything smaller than
                         16px makes iOS zoom the page on focus. The same pair the
                         budget editor's inputs use. */
                      className="h-9 w-full cursor-pointer truncate rounded-md border border-line-strong bg-surface px-2 text-[16px] text-text transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-[11rem] sm:text-[13px]"
                    >
                      {mapping.categories.map((category) => (
                        <option key={category} value={category}>
                          {category === mapping.unfiled
                            ? t("leaveUnfiled", { category: categoryLabel(category) })
                            : categoryLabel(category)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="min-w-0 sm:flex-none">
                    <span className="sr-only">
                      {t("domainFieldLabel", { merchant: row.merchant })}
                    </span>
                    <input
                      type="text"
                      inputMode="url"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={field.domain}
                      onChange={(event) =>
                        update(row.merchant, { domain: event.target.value })
                      }
                      /* The placeholder is what the shipped map would answer on
                         its own, so an empty field reads as "this is where the
                         logo already comes from" rather than as a gap. */
                      placeholder={row.suggestedDomain ?? t("domainPlaceholder")}
                      className="h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 font-mono text-[16px] text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-[10.5rem] sm:text-[13px]"
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface px-4 py-3 sm:px-5">
          {mapping.merchants.length > PREVIEW && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              /* `bg-surface` with a `surface-hover` hover: on a grey panel a
                 button that hovers to `surface-muted` hovers to its own ground
                 and nothing happens. */
              className="mr-auto flex h-9 cursor-pointer items-center rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover"
            >
              {expanded
                ? t("showFewer")
                : t("showAll", { count: mapping.merchants.length })}
            </button>
          )}

          {dirty && (
            <span className="text-[12.5px] text-text-muted">
              {t("unsavedChanges")}
            </span>
          )}
          {/* Beside Save rather than at the top of the list: it is one more way
              to fill the same fields, and it hands its answers to the same
              button. Secondary colours, because Save is what commits them —
              `bg-surface` on the grey panel, per the rule the "show all"
              button above follows. */}
          <button
            type="button"
            onClick={autoFile}
            disabled={pending || asking || undecided === 0}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-50"
          >
            {asking ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            {asking ? t("autoFiling") : t("autoFile")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || asking || !dirty}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-[var(--primary-foreground)] transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("save")}
          </button>
        </div>
      </div>
    </details>
  );
}
