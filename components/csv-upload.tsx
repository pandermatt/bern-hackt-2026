"use client";

import { Loader2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { importCsvUpload } from "@/app/actions/csv-import";
import { SettingsRow } from "@/components/settings-row";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  analyzeCsv,
  CSV_ACCEPT,
  MAX_CSV_BYTES,
  type CsvMapping,
} from "@/lib/csv-import";
import { formatMoney } from "@/lib/insights";

/** How many rows the preview shows. Enough to see the signs are right. */
const PREVIEW_ROWS = 5;

const FIELD =
  "mt-1 h-10 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[16px] text-text focus:ring-1 focus:ring-accent focus:outline-none sm:h-9 sm:text-[13px]";
const LABEL = "text-[12.5px] font-medium text-text";

/**
 * One `<select>` over the file's own headers.
 *
 * Module scope, not a closure inside `CsvUpload`: a component declared during
 * render is a new type on every render, so React unmounts and remounts it —
 * and a `<select>` that remounts on change loses focus mid-keyboard.
 */
function ColumnPicker({
  id,
  label,
  value,
  headers,
  disabled,
  noColumnLabel,
  onPick,
}: {
  id: string;
  label: string;
  value: string | null;
  headers: string[];
  disabled: boolean;
  /** Present makes the column optional, and is the empty option's text. */
  noColumnLabel?: string;
  onPick: (header: string | null) => void;
}) {
  return (
    /*
     * `min-w-0`, on this and on every other direct child of the dialog's grid:
     * a grid item defaults to `min-width: auto`, so a `<select>` — whose
     * intrinsic width is its longest option — widens its column past the
     * dialog and drags every sibling out with it. On a 390px phone that put
     * half the form off the right edge.
     */
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onPick(event.target.value || null)}
        className={FIELD}
      >
        {noColumnLabel !== undefined && <option value="">{noColumnLabel}</option>}
        {headers.map((header) => (
          <option key={header} value={header}>
            {header}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Importing a statement the reader brought themselves.
 *
 * The third row of the account page's Data group, beside the generator and the
 * shipped demo CSV — and the only one of the three that adds rather than
 * replaces.
 *
 * **The file is read in the browser.** `lib/csv-import.ts` is pure, so the
 * delimiter sniffing, the column detection and the preview all run here with
 * no round trip, and nothing leaves the device until the reader has seen what
 * we made of their statement and pressed import. The server then re-reads the
 * same file with the same module, so the preview cannot disagree with what
 * lands in the ledger.
 *
 * A `Dialog`, not an `AlertDialog`: this is a form, and abandoning a form
 * without choosing is a normal thing to want.
 */
export function CsvUpload() {
  const t = useTranslations("CsvImport");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [account, setAccount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  /*
   * Only what the reader corrected. Everything else is re-detected from the
   * file on every render of the preview, which is what makes changing the
   * delimiter or the date column redraw the amounts too.
   */
  const [override, setOverride] = useState<Partial<CsvMapping>>({});

  const analysis = useMemo(
    () => (text === "" ? null : analyzeCsv(text, override)),
    [text, override],
  );
  const mapping = analysis?.mapping ?? null;
  const paired = mapping !== null && mapping.amount === null;

  function reset() {
    setFile(null);
    setText("");
    setAccount("");
    setOverride({});
    setProblem(null);
  }

  async function pick(next: File | null) {
    setProblem(null);
    setOverride({});
    if (!next) {
      reset();
      return;
    }
    if (next.size > MAX_CSV_BYTES) {
      reset();
      setProblem(t("errorTooLarge"));
      return;
    }

    try {
      const content = await next.text();
      setFile(next);
      setText(content);
      // The file's own name is the best guess at what to call the account —
      // "ZKB Privatkonto 2026.csv" is someone telling us already.
      setAccount(next.name.replace(/\.[^.]+$/, "").slice(0, 60));
    } catch {
      reset();
      setProblem(t("errorRead"));
    }
  }

  function submit() {
    if (!file || !mapping) return;

    startTransition(async () => {
      const body = new FormData();
      body.set("file", file);
      body.set("mapping", JSON.stringify(mapping));
      body.set("account", account);

      const result = await importCsvUpload(body);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
        reset();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <SettingsRow label={t("title")} note={t("note")}>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // A closed dialog holds nobody's bank statement in memory, and
          // reopening should start from the file picker rather than from last
          // time's abandoned mapping.
          if (!next) reset();
        }}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover max-sm:w-full sm:h-9"
          >
            <Upload className="size-3.5" aria-hidden />
            {t("open")}
          </button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="min-w-0">
            <label htmlFor="csv-file" className={LABEL}>
              {t("fileLabel")}
            </label>
            <input
              id="csv-file"
              type="file"
              accept={CSV_ACCEPT}
              disabled={pending}
              onChange={(event) => pick(event.target.files?.[0] ?? null)}
              className="mt-1 block w-full cursor-pointer rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-text file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-surface-muted file:px-2 file:py-1 file:text-[12.5px] file:font-medium file:text-text"
            />
            <p className="mt-1 text-[12px] text-text-subtle">{t("fileHint")}</p>
          </div>

          {problem && <p className="text-[13px] text-danger">{problem}</p>}

          {analysis && mapping && (
            <>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <ColumnPicker
                  id="csv-date"
                  label={t("fieldDate")}
                  value={mapping.date}
                  headers={analysis.headers}
                  disabled={pending}
                  onPick={(header) => setOverride((o) => ({ ...o, date: header ?? "" }))}
                />

                {paired ? (
                  <>
                    <ColumnPicker
                      id="csv-debit"
                      label={t("fieldDebit")}
                      value={mapping.debit}
                      headers={analysis.headers}
                      disabled={pending}
                      onPick={(header) => setOverride((o) => ({ ...o, debit: header }))}
                    />
                    <ColumnPicker
                      id="csv-credit"
                      label={t("fieldCredit")}
                      value={mapping.credit}
                      headers={analysis.headers}
                      disabled={pending}
                      onPick={(header) => setOverride((o) => ({ ...o, credit: header }))}
                    />
                  </>
                ) : (
                  <ColumnPicker
                    id="csv-amount"
                    label={t("fieldAmount")}
                    value={mapping.amount}
                    headers={analysis.headers}
                    disabled={pending}
                    onPick={(header) =>
                      setOverride((o) => ({ ...o, amount: header ?? "" }))
                    }
                  />
                )}

                <ColumnPicker
                  id="csv-description"
                  label={t("fieldDescription")}
                  value={mapping.description}
                  headers={analysis.headers}
                  disabled={pending}
                  onPick={(header) =>
                    setOverride((o) => ({ ...o, description: header ?? "" }))
                  }
                />

                <ColumnPicker
                  id="csv-currency"
                  label={t("fieldCurrency")}
                  value={mapping.currency}
                  headers={analysis.headers}
                  disabled={pending}
                  noColumnLabel={t("noColumn")}
                  onPick={(header) => setOverride((o) => ({ ...o, currency: header }))}
                />

                <div className="min-w-0">
                  <label htmlFor="csv-account" className={LABEL}>
                    {t("fieldAccount")}
                  </label>
                  <input
                    id="csv-account"
                    type="text"
                    value={account}
                    disabled={pending}
                    onChange={(event) => setAccount(event.target.value.slice(0, 60))}
                    className={FIELD}
                  />
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
                {/* Two columns or one is a property of the file, not a
                    preference — but detection gets it wrong on an export that
                    labels a single signed column "Belastung", so it is here. */}
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
                  <input
                    type="checkbox"
                    checked={paired}
                    disabled={pending}
                    onChange={(event) =>
                      setOverride((o) => ({
                        ...o,
                        ...(event.target.checked
                          ? {
                              amount: null,
                              debit: o.debit ?? analysis.headers[0] ?? null,
                              credit: o.credit ?? analysis.headers[1] ?? null,
                            }
                          : {
                              amount: analysis.headers[0] ?? "",
                              debit: null,
                              credit: null,
                            }),
                      }))
                    }
                    className="size-4 accent-accent"
                  />
                  {t("splitColumns")}
                </label>

                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
                  <input
                    type="checkbox"
                    checked={mapping.invertSign}
                    disabled={pending}
                    onChange={(event) =>
                      setOverride((o) => ({ ...o, invertSign: event.target.checked }))
                    }
                    className="size-4 accent-accent"
                  />
                  {t("invertSign")}
                </label>
              </div>

              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-text">
                  {t("previewTitle", {
                    count: analysis.rows.length,
                    total: analysis.total,
                  })}
                </p>

                {/* Its own scroller: a long description must not give the
                    dialog a horizontal scrollbar. */}
                <div className="mt-1.5 overflow-x-auto rounded-md bg-surface">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="text-text-subtle">
                      <tr>
                        {/* Below `sm` the date rides under the description
                            instead of taking a column of its own — the same
                            trade the ledger makes, and what keeps the amount
                            on screen where the signs can be checked. */}
                        <th
                          scope="col"
                          className="hidden px-2.5 py-1.5 font-medium sm:table-cell"
                        >
                          {t("columnDate")}
                        </th>
                        <th scope="col" className="px-2.5 py-1.5 font-medium">
                          {t("columnDescription")}
                        </th>
                        <th scope="col" className="px-2.5 py-1.5 text-right font-medium">
                          {t("columnAmount")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-muted">
                      {analysis.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                        <tr key={`${row.bookedOn}-${index}`}>
                          <td className="hidden px-2.5 py-1.5 font-mono tabular-nums whitespace-nowrap text-text-muted sm:table-cell">
                            {row.bookedOn}
                          </td>
                          <td className="max-w-[9rem] px-2.5 py-1.5 text-text sm:max-w-[22rem]">
                            <span className="block truncate">{row.description}</span>
                            <span className="block font-mono text-[11px] tabular-nums text-text-subtle sm:hidden">
                              {row.bookedOn}
                            </span>
                          </td>
                          <td
                            className={`px-2.5 py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${
                              row.amountMinor > 0 ? "text-positive" : "text-text"
                            }`}
                          >
                            {row.amountMinor > 0 ? "+" : "−"}
                            {formatMoney(row.amountMinor, row.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Unreadable lines are counted out loud. "312 imported" over
                    a file of 400 is a silent lie about someone's money. */}
                {analysis.skipped.length > 0 && (
                  <p className="mt-1.5 text-[12px] text-text-muted">
                    {t("skippedLines", {
                      count: analysis.skipped.length,
                      // Only the first few, and the ellipsis only when there
                      // really are more — "line 7…" for a single skipped line
                      // reads as if we were hiding something.
                      lines:
                        analysis.skipped
                          .slice(0, 3)
                          .map((row) => row.line)
                          .join(", ") + (analysis.skipped.length > 3 ? "\u2026" : ""),
                    })}
                  </p>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="h-9 cursor-pointer rounded-md border border-line-strong px-3.5 text-[13.5px] font-medium text-text transition-colors hover:bg-surface-muted"
              >
                {t("cancel")}
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !analysis || analysis.rows.length === 0}
              className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13.5px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
            >
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {pending ? t("importing") : t("import")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsRow>
  );
}
