import type { ReactNode } from "react";

/**
 * One row of a settings group: what the setting is on the left, the control
 * that changes it on the right.
 *
 * The account page used to be six `.card`s, each with its own header bar, and
 * each control component drew its own box — so the page read as six designs
 * rather than one list. It is now four `Section` groups (the dashboard's
 * idiom: a big heading on the page's own ground over a grey panel) filled with
 * these rows, and the control components render *rows* rather than cards.
 *
 * Two things follow from sitting on `--surface-muted`:
 *
 * - **The dividers are `divide-surface`, not `divide-line`** — white showing
 *   through the grey, the way the ledger's month panels and the budget
 *   editor's limit rows do it. A grey border on a grey ground is invisible.
 * - **Nothing inside gets its own panel.** A panel inside a panel reads as
 *   neither; a control that needs a ground of its own uses `bg-surface`.
 *
 * `children` is the control, rendered as a direct flex child so a button that
 * wants `max-sm:w-full` gets the row's width rather than the shrink-to-fit
 * width of a wrapper. `detail` is anything that has to span the row underneath
 * it — a progress bar, a status line, the generator's own inputs.
 */
export function SettingsRow({
  label,
  labelFor,
  note,
  detail,
  children,
}: {
  label: ReactNode;
  /** Renders the label as a real `<label>`, for the rows that wrap an input. */
  labelFor?: string;
  note?: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  const labelClass = "block text-[14px] font-medium text-text";

  return (
    <div className="px-4 py-3.5 sm:px-5">
      {/* `basis-[15rem]` is what makes the control drop to its own line on a
          phone instead of squeezing the label into two words per line. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1 basis-[15rem]">
          {labelFor ? (
            <label htmlFor={labelFor} className={labelClass}>
              {label}
            </label>
          ) : (
            <p className={labelClass}>{label}</p>
          )}
          {note && <p className="mt-0.5 text-[13px] text-text-muted">{note}</p>}
        </div>
        {children}
      </div>
      {detail}
    </div>
  );
}

/** The panel class every settings group wears. See the divider note above. */
export const SETTINGS_GROUP = "divide-y divide-surface";
