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
  type MerchantRow,
} from "@/app/actions/merchant-overrides";
import { MerchantAvatar } from "@/components/merchant-avatar";
import { formatMoney } from "@/lib/insights";
import { merchantBatches } from "@/lib/merchant-batches";
import { useCategoryLabel } from "@/lib/use-category-label";

/** How many rows a list shows before it asks to be unfolded. */
const PREVIEW = 12;

/** How long a just-filled row keeps its green after the run has finished. */
const DONE_HIGHLIGHT_MS = 2_000;

type Field = { category: string; domain: string };

/** The select and the domain field, on a `--surface-muted` panel. */
const CONTROL =
  "h-9 w-full rounded-md border border-line-strong bg-surface text-[16px] text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:text-[13px]";

/**
 * One merchant, with the two things this account can say about it.
 *
 * Module scope, not a closure inside `MerchantMapper`: a component declared
 * during render is a new type on every render, so React unmounts and remounts
 * the whole subtree — which on a list of selects means losing focus mid-choice.
 * The same reason `components/csv-upload.tsx` hoists its `Field`.
 */
function MerchantListRow({
  row,
  field,
  categories,
  unfiled,
  waiting,
  landed,
  onChange,
  t,
  categoryLabel,
}: {
  row: MerchantRow;
  field: Field;
  categories: string[];
  unfiled: string;
  /** A request is out about this row right now. */
  waiting: boolean;
  /** The auto-filing just put a category on it. */
  landed: boolean;
  onChange: (patch: Partial<Field>) => void;
  t: ReturnType<typeof useTranslations<"MerchantMapping">>;
  categoryLabel: (category: string) => string;
}) {
  return (
    <li
      /* The ledger's own row washes, for the same reason it uses them: a tint
         says which rows something is happening to without moving anything.
         Accent while a request is out about this row, then the positive green
         once it came back with a category. */
      className={`flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3 transition-colors duration-300 sm:px-5 ${
        waiting ? "bg-accent-soft" : landed ? "bg-positive-soft" : ""
      }`}
      aria-busy={waiting || undefined}
    >
      <div className="flex min-w-0 flex-1 basis-[13rem] items-center gap-2.5">
        {/* Keyed on the saved domain, and versioned by it: the mark is cached
            per account for an hour, and this is the one page where somebody has
            just changed which domain it comes from and is looking straight at
            it. */}
        <MerchantAvatar name={row.merchant} size={20} version={row.domain || undefined} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-text">{row.merchant}</p>
          <p className="text-[13px] text-text-muted">
            {t("lines", { count: row.count })}
            {" · "}
            <span className="font-mono tabular-nums">{formatMoney(row.spentMinor)}</span>
          </p>
        </div>
      </div>

      {/* Stacked below `sm`, side by side from there. Sharing one phone row
          left the select about 200px wide, which truncates the longest option —
          and the longest option is the default one every unfiled merchant is
          showing. */}
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <label className="min-w-0 sm:flex-none">
          <span className="sr-only">
            {t("categoryFieldLabel", { merchant: row.merchant })}
          </span>
          <select
            value={field.category}
            onChange={(event) => onChange({ category: event.target.value })}
            /* 16px on a phone, 13px from `sm`: anything smaller than 16px makes
               iOS zoom the page on focus. The same pair the budget editor's
               inputs use. */
            className={`${CONTROL} cursor-pointer truncate px-2 hover:bg-surface-hover sm:w-[11rem]`}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category === unfiled
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
            onChange={(event) => onChange({ domain: event.target.value })}
            /* The placeholder is what the shipped map would answer on its own,
               so an empty field reads as "this is where the logo already comes
               from" rather than as a gap. */
            placeholder={row.suggestedDomain ?? t("domainPlaceholder")}
            className={`${CONTROL} px-2.5 font-mono sm:w-[10.5rem]`}
          />
        </label>
      </div>
    </li>
  );
}

/**
 * Every merchant on the account, in two lists: the ones still wanting a
 * category, then the ones that have one.
 *
 * `scripts/lib/statement.ts` files anything its rules cannot recognise under
 * `Other`, and `lib/merchant-brands.ts` has no mark for most of them. Both are
 * code, shipped for everybody, and neither can be taught about a statement
 * somebody uploads. This is where the account holder answers both questions for
 * themselves — the category the lines should read as, and the domain the logo
 * comes from — and the answers are stored per account and applied on read (see
 * `db/schema.ts`, `merchant_overrides`).
 *
 * Three things about the split are deliberate:
 *
 * - **A merchant moves lists when it is filed; it does not vanish.** The
 *   worry the single list was built around — a row disappearing on save reads
 *   as the save having eaten it — is answered better by the decision showing up
 *   somewhere than by leaving it among the undecided.
 * - **The second list holds every merchant the account has ever had**, the ones
 *   the importer got right included. That is the whole of re-categorising:
 *   before it, a merchant the rules placed was unreachable, so "Coop is not
 *   groceries for me" had nowhere to be said.
 * - **`Other` is a real option, and choosing it clears the row.** "Leave it
 *   alone" is the absence of an opinion rather than an opinion that it belongs
 *   in `Other`, so it is stored as no row at all — and so is setting a merchant
 *   back to what the importer said, which is `base` in the payload below.
 *
 * Fields are held as typed, and parsed once in the server action — the same
 * split `components/budget-editor.tsx` makes, for the same reason: a
 * half-finished "uzh." is a legitimate intermediate state and a field that
 * rewrites itself under the cursor is a field fighting the person using it.
 *
 * **The whole thing ships folded, behind a count of what still wants a
 * decision.** It is the longest block on `/account` by a distance — one row per
 * merchant, each with two controls, and on a real statement that is hundreds —
 * and it sat open between the settings above it and the danger zone below.
 * Folded, the panel is one line that says whether opening it is worth anything.
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
  /* Plain state, not a transition. A transition commits its updates when it
     settles, so every step of the loop below would land at once, at the end —
     the same trap `useAssistantChat` documents and the reason its status line
     is plain state too. A progress bar that only draws when the work is over
     is not a progress bar. */
  const [asking, setAsking] = useState(false);
  /** Merchants asked about so far, and how many the run covers. */
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  /** The merchants a request is in flight about, right now. */
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());
  /** The merchants this run has filled in, kept until shortly after it ends. */
  const [justFiled, setJustFiled] = useState<ReadonlySet<string>>(new Set());
  const [openExpanded, setOpenExpanded] = useState(false);
  const [filedExpanded, setFiledExpanded] = useState(false);

  const everyMerchant = [...mapping.open, ...mapping.filed];

  const [fields, setFields] = useState<Record<string, Field>>(() =>
    Object.fromEntries(
      everyMerchant.map((row) => [
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
  const byName = new Map(everyMerchant.map((row) => [row.merchant, row]));

  /** What this form would send: the merchants whose two fields have moved. */
  const changes = everyMerchant.flatMap((row) => {
    const field = fields[row.merchant];
    if (field === undefined) return [];
    const category = field.category;
    const domain = field.domain.trim();
    if (category === row.category && domain === row.domain) return [];
    return [
      {
        merchant: row.merchant,
        /*
         * Back to what the importer said is the *absence* of an opinion, not an
         * opinion that happens to agree with one — and the action deletes the
         * row on a blank. Storing a copy of the rules' own answer would leave
         * the account carrying an override that does nothing until the rules
         * change, and then quietly overrules them.
         */
        category: category === row.base ? "" : category,
        domain,
      },
    ];
  });
  const dirty = changes.length > 0;

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
  async function autoFile() {
    // The same slicing the server does, so the rows lit up while a request is
    // out are the rows that request is about. What comes back names them
    // again, which is what settles it if the two lists have drifted.
    const open = mapping.open
      .filter(
        (row) =>
          (fieldsRef.current[row.merchant]?.category ?? row.category) ===
          mapping.unfiled,
      )
      .map((row) => row.merchant);
    const batches = merchantBatches(open);

    setAsking(true);
    setJustFiled(new Set());
    setProgress({ done: 0, total: open.length });

    let filed = 0;

    try {
      /*
       * One batch at a time, and a pool of three was tried and taken out
       * again: Next runs a client's server actions one after another, so the
       * three requests queued behind each other exactly as a loop would and
       * bought nothing but a second way to read the code.
       */
      for (const [index, batch] of batches.entries()) {
        setInFlight(new Set(batch));
        const result = await suggestCategoriesForUnfiled({ batch: index });

        if (!result.ok) {
          // A refusal is about the whole run — no key, no session — so there
          // is nothing to gain by asking again for the next batch.
          toast.error(result.error);
          return;
        }

        /* Read through the ref, not the closure: each round trip lands in a
           later render than the one this function was created in. Counted
           here rather than inside a functional updater, because an updater
           does not run until the re-render — the toast would read a zero. */
        const base = fieldsRef.current;
        const next = { ...base };
        const landed: string[] = [];

        for (const [merchant, category] of Object.entries(result.suggestions)) {
          const current = base[merchant]?.category ?? byName.get(merchant)?.category;
          // Only the rows nobody has answered. A merchant already filed —
          // saved, or chosen in this form a moment ago — keeps what it has.
          if (current !== mapping.unfiled) continue;
          next[merchant] = {
            category,
            // Whatever domain the row carries; this button is about categories.
            domain: base[merchant]?.domain ?? byName.get(merchant)?.domain ?? "",
          };
          landed.push(merchant);
        }

        if (landed.length > 0) {
          // The ref moves with the state, so the next batch reads what this
          // one wrote rather than the render it started from.
          fieldsRef.current = next;
          setFields(next);
          setJustFiled((previous) => new Set([...previous, ...landed]));
          filed += landed.length;
        }

        // Merchants, not batches: "10 of 24" is a sentence about the list the
        // reader is looking at, where "batch 1 of 3" is one about the wire.
        setProgress((previous) => ({
          done: Math.min(previous.total, previous.done + result.asked.length),
          total: previous.total,
        }));
      }

      toast[filed > 0 ? "success" : "info"](
        filed > 0 ? t("autoFiled", { count: filed }) : t("autoFiledNone"),
      );
    } finally {
      setAsking(false);
      setInFlight(new Set());
      // The green stays a moment after the bar has gone, so the last rows to
      // be filled are still saying so when the reader looks up.
      window.setTimeout(() => setJustFiled(new Set()), DONE_HIGHLIGHT_MS);
    }
  }

  function save() {
    startTransition(async () => {
      // Only what moved. The whole list would be hundreds of entries, most of
      // them saying "leave this exactly as the rules left it", and the action
      // takes an absent merchant to mean precisely that.
      const result = await saveMerchantOverrides(changes);
      if (result.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (everyMerchant.length === 0) {
    return (
      <p className="px-4 py-3.5 text-[13.5px] text-text-muted sm:px-5">{t("empty")}</p>
    );
  }

  /* Counted off the fields rather than off `mapping`, so the summary and the
     rows under it can never disagree: filing a merchant drops the count as the
     select changes, and the "unsaved changes" hint beside Save is what says
     that has not reached the database yet. */
  const undecided = mapping.open.filter(
    (row) => (fields[row.merchant]?.category ?? row.category) === mapping.unfiled,
  ).length;

  const openShown = openExpanded ? mapping.open : mapping.open.slice(0, PREVIEW);
  const filedShown = filedExpanded ? mapping.filed : mapping.filed.slice(0, PREVIEW);

  const rowsOf = (rows: MerchantRow[]) => (
    /* Dividers are the panel's own surface showing through, the way every
       other settings group does it — a grey border on grey is invisible. */
    <ul className="divide-y divide-surface">
      {rows.map((row) => (
        <MerchantListRow
          key={row.merchant}
          row={row}
          field={fields[row.merchant] ?? { category: row.category, domain: row.domain }}
          categories={mapping.categories}
          unfiled={mapping.unfiled}
          waiting={inFlight.has(row.merchant)}
          landed={justFiled.has(row.merchant)}
          onChange={(patch) => update(row.merchant, patch)}
          t={t}
          categoryLabel={categoryLabel}
        />
      ))}
    </ul>
  );

  /** The "show all" / "show fewer" toggle a list grows when it is long. */
  const moreButton = (
    rows: MerchantRow[],
    expanded: boolean,
    setExpanded: (value: boolean) => void,
  ) =>
    rows.length > PREVIEW && (
      <div className="border-t border-surface px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          /* `bg-surface` with a `surface-hover` hover: on a grey panel a button
             that hovers to `surface-muted` hovers to its own ground and nothing
             happens. */
          className="flex h-9 cursor-pointer items-center rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover"
        >
          {expanded ? t("showFewer") : t("showAll", { count: rows.length })}
        </button>
      </div>
    );

  return (
    <details className="group" open={defaultOpen || undefined}>
      {/* `list-none` plus the webkit rule removes the native triangle — the
          chevron on the right is the app's own affordance, and two markers on
          one row read as two controls. */}
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-[14px] font-medium text-text">
          {/* Nothing left to decide is a different sentence, not a "0" — the
              filed list is still there and still worth opening, and a zero
              would read as an empty panel. */}
          {undecided > 0
            ? t("summary", { count: undecided })
            : t("summaryAllFiled", { count: everyMerchant.length })}
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
        {/* No heading over this list: the summary the reader just opened says
            "7 merchants without a category" and this is that list. The second
            one below carries a heading precisely because it is the one that
            needs naming. */}
        {mapping.open.length > 0 ? (
          <>
            {rowsOf(openShown)}
            {moreButton(mapping.open, openExpanded, setOpenExpanded)}
          </>
        ) : (
          <p className="px-4 py-3.5 text-[13.5px] text-text-muted sm:px-5">
            {t("empty")}
          </p>
        )}

        {/* The second list, folded inside the first. Hundreds of merchants the
            rules already placed are not what somebody opened this panel for —
            but they are what re-filing one means, so they are one click away
            rather than absent. */}
        {mapping.filed.length > 0 && (
          <details className="group/filed border-t border-surface">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover sm:px-5 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 text-[13px] font-medium text-text-muted">
                {t("filedHeading", { count: mapping.filed.length })}
              </span>
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-text-subtle transition-transform group-open/filed:rotate-180"
              />
            </summary>
            <div className="border-t border-surface">
              <p className="px-4 pt-3 pb-1 text-[12.5px] text-text-muted sm:px-5">
                {t("filedNote")}
              </p>
              {rowsOf(filedShown)}
              {moreButton(mapping.filed, filedExpanded, setFiledExpanded)}
            </div>
          </details>
        )}

        {asking && progress.total > 0 && (
          <div className="border-t border-surface px-4 py-3 sm:px-5">
            {/* The track is `--surface`, not `--surface-muted`: on this grey
                panel a muted track is filled with its own ground and
                disappears. The same pair the scan's bar uses. */}
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface"
              role="progressbar"
              aria-valuenow={progress.done}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-label={t("autoProgressLabel")}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.round((progress.done / progress.total) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 font-mono text-[12px] tabular-nums text-text-muted">
              {t("autoProgress", { done: progress.done, total: progress.total })}
            </p>
          </div>
        )}

        {/* Under both lists, because Save commits both — including a category
            changed in the filed list, which is the whole point of it being
            editable. */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-surface px-4 py-3 sm:px-5">
          {dirty && (
            <span className="mr-auto text-[12.5px] text-text-muted">
              {t("unsavedCount", { count: changes.length })}
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
