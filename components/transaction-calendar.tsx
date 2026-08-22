"use client";

import { useTranslations } from "next-intl";
import {
  Fragment,
  startTransition,
  useCallback,
  useState,
  type ReactNode,
} from "react";

import { loadDayRows } from "@/app/actions/calendar";
import { EmptyState } from "@/components/empty-state";
import { LEDGER_ANCHOR_ID } from "@/components/ledger-anchor";
import { MonthHeading } from "@/components/month-heading";
import type { AnomalyKind } from "@/lib/anomaly-engine";
import {
  daysInMonth,
  firstWeekdayOf,
  formatMoney,
  type CalendarDay,
  type CalendarMonth,
  type DayDot,
  type MonthTotal,
} from "@/lib/insights";

/**
 * The ledger's other face: one grid per month, a dot per transaction, and the
 * whole cell tinted on a day the anomaly scan flagged.
 *
 * A client component, and the same exception the charts already take. What
 * crosses the boundary is the **aggregate** — a count, two sums, up to five
 * palette slots and one classification per day — never a transaction. The rows
 * behind a cell arrive only when it is opened, as server-rendered output from
 * `app/actions/calendar.tsx`, and are held here as an opaque `ReactNode`.
 *
 * A real `<table>`, not a grid of divs: a month calendar *is* a table, and
 * `<th scope="col">` hands the day-of-week to a screen reader for free. It is
 * also what makes the expanded day easy — a `<tr><td colSpan={7}>` slotted in
 * straight after the week that owns the selection, so the rows appear where the
 * eye already is rather than at the foot of the month.
 */

/**
 * The tint a flagged day wears, matching the wash the same finding wears as a
 * ledger row (`KIND_ROW_CLASSES` in components/ledger-chunk.tsx).
 *
 * Kind, not severity. Severity is how far from its baseline a number sits; kind
 * is how much a person should worry, and kind is what the rows are already
 * coloured by — a day tinted on one axis above a row tinted on the other would
 * be two classifications of the same event.
 */
const KIND_GROUND: Record<AnomalyKind, string> = {
  alert: "bg-danger-soft",
  warning: "bg-brand-soft",
  info: "bg-accent-soft",
};

/**
 * The edge that makes the tint a signal rather than a smudge. `--danger-soft`
 * is `#fef3f2` against a `#f5f5f7` panel; a fill that faint needs a line round
 * it. `ring-inset` is what keeps every cell exactly the same size whether it
 * carries one or not.
 */
const KIND_RING: Record<AnomalyKind, string> = {
  alert: "ring-1 ring-inset ring-danger/50",
  warning: "ring-1 ring-inset ring-brand",
  info: "ring-1 ring-inset ring-accent/40",
};

/** Spoken in the cell's label, so the tint is never the only telling. */
const KIND_MESSAGE_KEYS: Record<AnomalyKind, string> = {
  alert: "kindAlert",
  warning: "kindWarning",
  info: "kindInfo",
};

const KINDS = ["info", "warning", "alert"] as const;

/** Monday first, the way a Swiss calendar is printed. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * One transaction's mark.
 *
 * Colour is the category's palette slot, so a dot, its wedge in the donut and
 * its band in the bars are all one colour — `slotsOf` assigns those from the
 * whole-range ranking precisely so they hold still under a filter.
 *
 * The 1px edge does for a dot what `--pistachio-edge` does for a Pistachio
 * fill: six of the ten ramp colours are under 3:1 and Soft yellow is 1.26:1, so
 * the fill alone does not make a 7px shape perceptible against the cell.
 *
 * **Money in is hollow, money out is filled.** Shape carries direction and hue
 * carries category, which keeps one mark from having to mean two things — and
 * income has no slot to colour anyway, `stackByCategory` being expenses only.
 * Reaching for `--flow-in` here would have collided outright: it is `#a5c400`,
 * byte for byte `--chart-2`.
 */
function Dot({ dot, label }: { dot: DayDot; label: string }) {
  if (dot.kind !== "expense") {
    return (
      <span
        title={label}
        className={`size-[7px] shrink-0 rounded-full border-2 ${
          dot.kind === "income" ? "border-positive" : "border-line-strong"
        }`}
      />
    );
  }

  return (
    <span
      title={label}
      className="size-[7px] shrink-0 rounded-full border border-line-strong"
      // Tailwind cannot generate a class from a runtime slot; this is the same
      // inline `var(--chart-N)` idiom the merchant bars use.
      style={{
        background:
          dot.slot === 0 ? "var(--chart-other)" : `var(--chart-${dot.slot})`,
      }}
    />
  );
}

function DayCell({
  day,
  dayNumber,
  selected,
  onSelect,
}: {
  /** Undefined on a day of the month the filter left with nothing. */
  day: CalendarDay | undefined;
  dayNumber: number;
  selected: boolean;
  onSelect: (date: string) => void;
}) {
  const t = useTranslations("Calendar");
  const tCategories = useTranslations("Categories");
  const tMonths = useTranslations("Months");

  const number = (
    <span className="font-mono text-[11.5px] leading-none tabular-nums text-text-subtle">
      {dayNumber}
    </span>
  );

  // A day with no rows is still a day: it keeps its number and its tile, so the
  // grid stays a calendar rather than a scatter of the days that happened to
  // survive the filter.
  if (!day) {
    return (
      <div className="h-full min-h-[3.75rem] rounded-md bg-surface/50 p-1.5 sm:min-h-[5rem]">
        {number}
      </div>
    );
  }

  // `YYYY-MM-DD` split, never a `Date` — the same discipline the ledger's rows
  // follow. The long month name here rather than the short one: this string is
  // only ever spoken, and "14 March 2025" reads better than "14 Mar 2025".
  const [year, month, dayOfMonth] = day.date.split("-");
  const spoken = tMonths("day", {
    day: Number(dayOfMonth),
    month: tMonths(`long${Number(month)}`),
    year,
  });

  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-expanded={selected}
      /* The figures and the finding as words. On a phone the money has no line
         to sit on and the tints are the only visual telling, so this label is
         not a courtesy — it is the relief the sub-3:1 fills are conditional on,
         the same contract every chart in this app ships its `sr-only` table
         under. */
      aria-label={t("dayLabel", {
        date: spoken,
        count: day.count,
        moneyOut: formatMoney(day.expense),
        moneyIn: formatMoney(day.income),
        finding: day.kind ? t(KIND_MESSAGE_KEYS[day.kind]) : t("kindNone"),
      })}
      /* One ring, not two: selection replaces the kind's edge rather than
         stacking on it. Two `ring-*` utilities on one element resolve by CSS
         source order, not class order, so which one won would be a coin toss. */
      className={`flex h-full min-h-[3.75rem] w-full cursor-pointer flex-col gap-1 rounded-md p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-[5rem] ${
        day.kind ? KIND_GROUND[day.kind] : "bg-surface hover:bg-surface-hover"
      } ${
        selected
          ? "ring-2 ring-accent ring-inset"
          : day.kind
            ? KIND_RING[day.kind]
            : ""
      }`}
    >
      {number}

      <span className="flex flex-wrap content-start items-center gap-1">
        {day.dots.map((dot, index) => (
          <Dot
            key={index}
            dot={dot}
            label={
              tCategories.has(dot.category)
                ? tCategories(dot.category)
                : dot.category
            }
          />
        ))}
        {day.hiddenDots > 0 && (
          <span className="font-mono text-[10px] leading-none tabular-nums text-text-subtle">
            +{day.hiddenDots}
          </span>
        )}
      </span>

      {/* The figures need a line of their own and a 48px cell on a 375px phone
          does not have one. There the dots and the spoken label carry the day;
          from `sm` the money shows. */}
      <span className="mt-auto hidden flex-col items-end font-mono text-[11px] leading-tight tabular-nums sm:flex">
        {day.expense > 0 && (
          <span className="text-text-muted">−{formatMoney(day.expense)}</span>
        )}
        {day.income > 0 && (
          <span className="text-positive">+{formatMoney(day.income)}</span>
        )}
      </span>
    </button>
  );
}

/**
 * The month's cells, padded out to whole weeks.
 *
 * `null` is a leading or trailing blank — a day belonging to a neighbouring
 * month, which this grid leaves empty rather than drawing twice. The week
 * begins on Monday, so `firstWeekdayOf` is Monday-indexed too.
 */
function weeksOf(month: string): (number | null)[][] {
  const cells: (number | null)[] = Array(firstWeekdayOf(month)).fill(null);
  for (let day = 1; day <= daysInMonth(month); day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function MonthGrid({
  month,
  totals,
  selected,
  expansion,
  onSelect,
}: {
  month: CalendarMonth;
  totals: MonthTotal | undefined;
  /** The open day's `YYYY-MM-DD`, or `null` when it is not in this month. */
  selected: string | null;
  /** The open day's rows, rendered on the server. */
  expansion: ReactNode;
  onSelect: (date: string) => void;
}) {
  const t = useTranslations("Calendar");
  const tWeekdays = useTranslations("Weekdays");
  const headingId = `calendar-month-${month.month}`;

  const byDay = new Map<number, CalendarDay>();
  for (const day of month.days) byDay.set(Number(day.date.slice(8, 10)), day);

  const weeks = weeksOf(month.month);
  const selectedDay = selected ? Number(selected.slice(8, 10)) : null;

  return (
    <>
      <MonthHeading month={month.month} totals={totals} id={headingId} />

      <div className="overflow-clip rounded-lg bg-surface-muted p-2 sm:p-3">
        <table
          className="w-full table-fixed border-separate border-spacing-1"
          aria-labelledby={headingId}
        >
          <thead>
            <tr>
              {WEEKDAYS.map((weekday) => (
                <th
                  key={weekday}
                  scope="col"
                  className="pb-1 text-[11px] font-medium text-text-subtle"
                >
                  {/* The abbreviation to read, the full name to hear. */}
                  <span aria-hidden>{tWeekdays(`short${weekday}`)}</span>
                  <span className="sr-only">{tWeekdays(`long${weekday}`)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, index) => (
              <Fragment key={index}>
                <tr>
                  {week.map((dayNumber, column) =>
                    dayNumber === null ? (
                      <td key={column} />
                    ) : (
                      /* `h-full` on the cell as well as on the tile inside it:
                         a tile is `height: 100%` of its `<td>`, and a `<td>`
                         only has a height to resolve against once it is told to
                         take the row's. Without it a week whose busiest day
                         wraps its dots onto a second line leaves every quieter
                         day in that week short. */
                      <td key={column} className="h-full align-top">
                        <DayCell
                          day={byDay.get(dayNumber)}
                          dayNumber={dayNumber}
                          selected={selectedDay === dayNumber}
                          onSelect={onSelect}
                        />
                      </td>
                    ),
                  )}
                </tr>

                {/* The open day's rows, directly under the week that holds it
                    rather than at the foot of the month — a panel eight rows
                    below the cell you clicked is a panel you have to go and
                    find. */}
                {selectedDay !== null && week.includes(selectedDay) && (
                  <tr>
                    <td colSpan={7} className="pt-1 pb-2">
                      {expansion}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* The same contract every chart here ships: the identical figures as
          text, for anyone the dots and the tints do not reach. The wrapper div
          takes `sr-only` (a table ignores its 1px width) and the name rides
          `aria-label`, not `<caption>` — a caption box escapes the clipped
          area and Safari paints it as a stray line under the chart. */}
      <div className="sr-only">
        <table aria-label={t("tableCaption")}>
          <thead>
            <tr>
              <th scope="col">{t("colDate")}</th>
              <th scope="col">{t("colCount")}</th>
              <th scope="col">{t("colIn")}</th>
              <th scope="col">{t("colOut")}</th>
              <th scope="col">{t("colFinding")}</th>
            </tr>
          </thead>
          <tbody>
            {month.days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{day.date}</th>
                <td>{day.count}</td>
                <td>{formatMoney(day.income)}</td>
                <td>{formatMoney(day.expense)}</td>
                <td>
                  {day.kind ? t(KIND_MESSAGE_KEYS[day.kind]) : t("kindNone")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Filled against hollow, and the three tints.
 *
 * Without this the encoding is a private code — the dots say *which category*
 * only to someone who has already matched them against the donut, and the tints
 * say nothing at all.
 */
function Legend() {
  const t = useTranslations("Calendar");

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-4 text-[11.5px] text-text-muted">
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-[7px] shrink-0 rounded-full border border-line-strong"
          style={{ background: "var(--chart-other)" }}
        />
        {t("legendOut")}
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-[7px] shrink-0 rounded-full border-2 border-positive"
        />
        {t("legendIn")}
      </li>
      {KINDS.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`size-3 shrink-0 rounded-sm ${KIND_GROUND[kind]} ${KIND_RING[kind]}`}
          />
          {t(KIND_MESSAGE_KEYS[kind])}
        </li>
      ))}
    </ul>
  );
}

export function TransactionCalendar({
  months,
  monthTotals,
  totalCount,
  filters,
}: {
  /** Newest month first, days ascending. Aggregates only — see the note above. */
  months: CalendarMonth[];
  /** Money in and out per `YYYY-MM` across the whole filtered set — the same
   * figures the ledger's headings carry, from the same source. */
  monthTotals: Record<string, MonthTotal>;
  totalCount: number;
  /** The raw search params, forwarded to the action verbatim. */
  filters: Record<string, string | string[] | undefined>;
}) {
  const t = useTranslations("Calendar");
  const tLedger = useTranslations("Ledger");

  const [open, setOpen] = useState<string | null>(null);
  const [content, setContent] = useState<ReactNode>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const openDay = useCallback(
    (date: string) => {
      setOpen(date);
      setContent(null);
      setFailed(false);
      setLoading(true);

      loadDayRows(date, filters)
        .then((result) => {
          /*
           * Inside a transition for the same reason the ledger's feed appends
           * that way: what comes back is a Flight element that can suspend, and
           * an un-transitioned update would flip the route's `loading.tsx`
           * boundary and throw the reader back to the top of the page.
           */
          startTransition(() => {
            setContent(result.content);
            setLoading(false);
          });
        })
        .catch(() => {
          setFailed(true);
          setLoading(false);
        });
    },
    [filters],
  );

  const select = useCallback(
    (date: string) => {
      // Clicking the open day closes it; clicking another moves it. One at a
      // time — several panels open at once and the grid stops being a calendar.
      if (date === open) {
        setOpen(null);
        setContent(null);
        setFailed(false);
        return;
      }
      openDay(date);
    },
    [open, openDay],
  );

  const expansion = (
    <>
      {loading && (
        <p
          aria-live="polite"
          className="rounded-lg bg-surface px-4 py-3 text-[13px] text-text-muted"
        >
          {tLedger("loadingMore")}
        </p>
      )}
      {failed && open && (
        <button
          type="button"
          onClick={() => openDay(open)}
          className="w-full cursor-pointer rounded-lg bg-surface px-4 py-3 text-[13px] font-medium text-danger"
        >
          {tLedger("retry")}
        </button>
      )}
      {content}
    </>
  );

  return (
    <section
      // The ledger's anchor, so a filter change scrolls to the rows in
      // whichever view is on screen.
      id={LEDGER_ANCHOR_ID}
      className="scroll-mt-20"
      aria-label={t("sectionLabel")}
    >
      {months.length === 0 ? (
        <div className="mt-6 overflow-clip rounded-lg bg-surface-muted">
          <EmptyState />
        </div>
      ) : (
        <>
          {months.map((month) => {
            const inThisMonth =
              open !== null && open.slice(0, 7) === month.month;
            return (
              <MonthGrid
                key={month.month}
                month={month}
                totals={monthTotals[month.month]}
                selected={inThisMonth ? open : null}
                expansion={inThisMonth ? expansion : null}
                onSelect={select}
              />
            );
          })}
          <Legend />
        </>
      )}

      {/* What the ledger's foot carries too: how many rows the current filter
          matched, so the two views agree on the size of the set. */}
      <p className="pt-3 text-right font-mono text-[12px] tabular-nums text-text-muted">
        {tLedger("lines", { count: totalCount })}
      </p>
    </section>
  );
}
