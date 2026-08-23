/**
 * Reading an arbitrary delimited bank statement.
 *
 * The two importers that predate this one (`scripts/seed.ts` and
 * `lib/demo-loader.ts`) read exactly one shape — the normalized
 * `name,type,source_id,…` export the demo files were converted to. Anything a
 * real bank hands out parses as garbage against it. This module is the
 * opposite end: sniff the delimiter, guess which column is the date, the
 * amount and the text, and hand back rows plus a list of the lines it could
 * not read.
 *
 * **Pure, and deliberately client-safe** — no `@/db`, no `server-only`, no
 * drizzle. The upload dialog runs it in the browser to draw its preview and
 * `lib/csv-upload.ts` runs it again on the server to do the real import, so
 * one implementation decides what a file means in both places. Same discipline
 * as `lib/insights.ts`, and the same reason: a value import of the data layer
 * here would pull drizzle into the client bundle.
 *
 * It never constructs a `Date`. A booking date is a calendar day, and as an
 * instant `2026-01-23` renders as 22 January for anyone west of UTC.
 */

import { isCalendarDate } from "@/lib/insights";
import { toRecords } from "@/scripts/lib/csv";

/**
 * The largest statement the uploader accepts, checked in the browser and again
 * in the action. Two megabytes is roughly 20'000 statement lines — far past
 * any year of banking — and it sits well under the Server Action body limit
 * raised for it in `next.config.ts`, so the cap someone hits is this one, with
 * a sentence attached, rather than a framework 413.
 */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

/** What the file picker offers. Plenty of banks name their export `.txt`. */
export const CSV_ACCEPT = ".csv,.txt,text/csv,text/plain";

/** The separators worth guessing between. Comma first — it wins ties. */
export const DELIMITERS = [",", ";", "\t", "|"] as const;

export type CsvMapping = {
  delimiter: string;
  /** Header of the column holding the booking date. */
  date: string;
  /** One signed amount column. Null when the file splits debit and credit. */
  amount: string | null;
  /** Money out, as an unsigned magnitude. Paired with `credit`. */
  debit: string | null;
  /** Money in, as an unsigned magnitude. Paired with `debit`. */
  credit: string | null;
  /** Header of the column holding the statement's own text. */
  description: string;
  /** Optional; anything else is booked as CHF, and no rate is invented. */
  currency: string | null;
  /** Flips every sign, for an export that lists expenses as positive. */
  invertSign: boolean;
};

export type ParsedRow = {
  /** `YYYY-MM-DD`, like `transactions.booked_on`. */
  bookedOn: string;
  /** Signed minor units. Income positive, expenses negative. */
  amountMinor: number;
  currency: string;
  /** The statement's own text, whitespace-collapsed. */
  description: string;
};

/** A line the reader could not turn into a row, and why. */
export type SkippedRow = {
  /** 1-based line number in the file, header counted. */
  line: number;
  reason: "date" | "amount";
};

export type CsvAnalysis = {
  headers: string[];
  mapping: CsvMapping;
  rows: ParsedRow[];
  skipped: SkippedRow[];
  /** Data lines in the file — `rows.length + skipped.length`. */
  total: number;
};

/* -------------------------------------------------------------------------
 * Delimiter
 * ---------------------------------------------------------------------- */

/**
 * Which separator the file uses.
 *
 * Scored on the first few records rather than on a raw character count: a
 * German export is full of commas *inside* its amounts (`1.234,50`), so
 * counting occurrences picks the comma over the semicolon that actually
 * separates the fields. What distinguishes the real delimiter is that it
 * yields the same number of columns on every line, and more than one.
 */
export function sniffDelimiter(text: string): string {
  const head = headOf(text);
  let best: string = DELIMITERS[0];
  let bestScore = 0;

  for (const delimiter of DELIMITERS) {
    const rows = parseHead(head, delimiter);
    if (rows.length === 0) continue;
    const columns = rows[0].length;
    if (columns < 2) continue;
    // A ragged file is not being split on its delimiter.
    if (!rows.every((row) => row.length === columns)) continue;
    if (columns > bestScore) {
      bestScore = columns;
      best = delimiter;
    }
  }

  return best;
}

/** The first few complete lines, so sniffing does not walk a 2 MB file. */
function headOf(text: string): string {
  const slice = text.slice(0, 8_192);
  const lines = slice.split("\n").slice(0, 6);
  return lines.join("\n");
}

/** A quote-unaware split, which is all the sniffer needs. */
function parseHead(head: string, delimiter: string): string[][] {
  return head
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line !== "")
    .map((line) => line.split(delimiter));
}

/* -------------------------------------------------------------------------
 * Dates
 * ---------------------------------------------------------------------- */

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
const ISO_SLASHED = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/;
// `\d{4}` first, and `(?!\d)` after: the alternation is ordered, so
// `\d{2}|\d{4}` reads "2026" as the year 20.
const DAY_FIRST = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4}|\d{2})(?!\d)/;

/**
 * A booking date as `YYYY-MM-DD`, or null if the value is not one.
 *
 * Accepts what Swiss and European exports actually emit: ISO days and ISO
 * timestamps (`2026-01-23T10:04:00Z` — the time is dropped, because the column
 * is a calendar day), `23.01.2026`, `23/01/2026`, `23-01-26` and `2026/01/23`.
 *
 * **Ambiguous values are read day-first.** `01/02/2026` is 1 February here,
 * not 2 January: every bank shipping into this app writes the day first, and a
 * reader has to pick one. A US export therefore needs its dates swapped before
 * upload — a limitation worth having, because silently guessing per row would
 * put half a statement in the wrong month.
 */
export function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const iso = ISO.exec(trimmed) ?? ISO_SLASHED.exec(trimmed);
  if (iso) return assemble(iso[1], iso[2], iso[3]);

  const dayFirst = DAY_FIRST.exec(trimmed);
  if (dayFirst) return assemble(expandYear(dayFirst[3]), dayFirst[2], dayFirst[1]);

  return null;
}

/** `"26"` → `"2026"`. Two-digit years below 70 are this century. */
function expandYear(year: string): string {
  if (year.length === 4) return year;
  const n = Number(year);
  return String(n < 70 ? 2000 + n : 1900 + n);
}

function assemble(year: string, month: string, day: string): string | null {
  const iso = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  // `isCalendarDate` is the one in `lib/insights.ts`: 2026-02-30 has the right
  // shape and does not exist, and this is user input.
  return isCalendarDate(iso) ? iso : null;
}

/* -------------------------------------------------------------------------
 * Amounts
 * ---------------------------------------------------------------------- */

/**
 * Signed minor units, or null if the value is not a number.
 *
 * The formats in play: `1'234.50` (Swiss), `1.234,50` (German), `1,234.50`
 * (English), `CHF 45.00`, `45.00-` (trailing sign), `(45.00)` (accounting
 * negative) and the odd non-breaking space inside a group.
 *
 * The decimal separator is the **last** `.` or `,` in the string, unless it is
 * followed by exactly three digits and nothing else — `1,234` is one thousand
 * two hundred and thirty-four, while `12,34` is twelve francs thirty-four.
 * Every other separator is a group separator and is dropped.
 *
 * Rounds once, at the boundary, exactly like `toMinor` in
 * `scripts/lib/statement.ts`.
 */
export function parseAmountMinor(value: string): number | null {
  let text = value.trim();
  if (text === "") return null;

  let negative = false;

  // Accounting parentheses, before anything else strips them.
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // A currency code or symbol on either side is noise. Letters *anywhere
  // else* mean this is not an amount at all, which is what stops the column
  // sniffer reading "Ticket 45" as forty-five francs.
  text = text
    .replace(/^(?:CHF|EUR|USD|GBP|[€$£])\s*/i, "")
    .replace(/\s*(?:CHF|EUR|USD|GBP|[€$£])$/i, "")
    .trim();

  if (text.endsWith("-")) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  if (text.startsWith("+")) text = text.slice(1);

  // Spaces — ordinary, non-breaking and narrow — are group separators.
  text = text.replace(/[\s\u00a0\u202f]/g, "").replace(/['’]/g, "");
  if (!/^[\d.,]+$/.test(text)) return null;

  const separator = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));

  let whole = text;
  let fraction = "";
  if (separator >= 0) {
    const tail = text.slice(separator + 1);
    // Exactly three digits after a lone separator is a group, not a fraction:
    // `1,234` is a thousand and `12,34` is twelve francs thirty-four.
    const grouped = tail.length === 3 && !/[.,]/.test(tail);
    if (!grouped) {
      whole = text.slice(0, separator);
      fraction = tail;
    }
  }

  whole = whole.replace(/[.,]/g, "");
  if (whole === "" && fraction === "") return null;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;

  const minor = Math.round(Number(`${whole || "0"}.${fraction || "0"}`) * 100);
  return negative ? -minor : minor;
}

/* -------------------------------------------------------------------------
 * Column detection
 * ---------------------------------------------------------------------- */

/**
 * Header aliases, best first — the index is the tie-breaker, so
 * `Buchungsdatum` beats `Valutadatum` when a statement carries both.
 * Compared against the header with diacritics and punctuation removed.
 */
const ALIASES = {
  date: [
    "buchungsdatum",
    "transactiondate",
    "bookingdate",
    "datum",
    "date",
    "valutadatum",
    "valuta",
    "dateoperation",
    "completeddate",
    "starteddate",
    "bookedon",
  ],
  amount: [
    "betragchf",
    "amountchf",
    "betrag",
    "amount",
    "montant",
    "umsatz",
    "importo",
  ],
  debit: [
    "belastung",
    "abgang",
    "auszahlung",
    "withdrawal",
    "paidout",
    "debit",
    "soll",
  ],
  credit: [
    "gutschrift",
    "eingang",
    "einzahlung",
    "deposit",
    "paidin",
    "credit",
    "haben",
  ],
  description: [
    "buchungstext",
    "verwendungszweck",
    "beschreibung",
    "description",
    "zahlungsempfaenger",
    "empfaenger",
    "mitteilung",
    "merchant",
    "payee",
    "details",
    "libelle",
    "text",
    "name",
  ],
  currency: ["waehrung", "currency", "devise", "wahrung"],
} as const;

/** Lowercased, unaccented, alphanumerics only: `"Betrag (CHF)"` → `"betragchf"`. */
function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** The header best matching one alias list, or null. Exact beats contained. */
function matchHeader(headers: string[], aliases: readonly string[]): string | null {
  let best: string | null = null;
  let bestScore = 0;

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (normalized === "") continue;

    for (let i = 0; i < aliases.length; i++) {
      const alias = aliases[i];
      let score = 0;
      if (normalized === alias) score = 100 - i;
      // A contained match only for aliases long enough not to fire by
      // accident: "date" inside "updatedate" is fine, "text" inside "context"
      // is the kind of thing that puts the wrong column on screen.
      else if (alias.length >= 5 && normalized.includes(alias)) score = 50 - i;

      if (score > bestScore) {
        bestScore = score;
        best = header;
      }
    }
  }

  return best;
}

/**
 * Which column is which, guessed from the headers and, where they say nothing
 * useful, from the values themselves.
 *
 * The guess is a starting point, not a verdict: the upload dialog shows it
 * with every field editable, because a header we have never seen is exactly
 * the case this importer exists for.
 */
export function detectMapping(
  headers: string[],
  records: Record<string, string>[],
  delimiter = ",",
): CsvMapping {
  const samples = records.slice(0, 20);

  const debit = matchHeader(headers, ALIASES.debit);
  const credit = matchHeader(headers, ALIASES.credit);
  const paired = debit !== null && credit !== null && debit !== credit;

  let date = matchHeader(headers, ALIASES.date);
  let amount = paired ? null : matchHeader(headers, ALIASES.amount);
  let description = matchHeader(headers, ALIASES.description);
  const currency = matchHeader(headers, ALIASES.currency);

  const taken = new Set<string>();
  if (date) taken.add(date);
  if (amount) taken.add(amount);
  if (paired) {
    taken.add(debit!);
    taken.add(credit!);
  }
  if (description) taken.add(description);
  if (currency) taken.add(currency);

  // Nothing matched by name: fall back to what the values look like.
  if (!date) {
    date = sniffColumn(headers, samples, taken, (value) => parseDate(value) !== null);
    if (date) taken.add(date);
  }
  if (!amount && !paired) {
    amount = sniffColumn(
      headers,
      samples,
      taken,
      (value) => parseAmountMinor(value) !== null,
    );
    if (amount) taken.add(amount);
  }
  if (!description) {
    description = sniffTextColumn(headers, samples, taken);
    if (description) taken.add(description);
  }

  return {
    delimiter,
    date: date ?? "",
    amount: paired ? null : (amount ?? ""),
    debit: paired ? debit : null,
    credit: paired ? credit : null,
    description: description ?? "",
    currency,
    invertSign: false,
  };
}

/** The unclaimed column whose values pass `test` most often (≥ 80%). */
function sniffColumn(
  headers: string[],
  samples: Record<string, string>[],
  taken: Set<string>,
  test: (value: string) => boolean,
): string | null {
  let best: string | null = null;
  let bestRate = 0.8;

  for (const header of headers) {
    if (taken.has(header) || header === "") continue;
    const values = samples
      .map((record) => (record[header] ?? "").trim())
      .filter((value) => value !== "");
    if (values.length === 0) continue;

    const rate = values.filter(test).length / values.length;
    if (rate >= bestRate) {
      bestRate = rate;
      best = header;
    }
  }

  return best;
}

/** The unclaimed column carrying the most letters — the statement's own text. */
function sniffTextColumn(
  headers: string[],
  samples: Record<string, string>[],
  taken: Set<string>,
): string | null {
  let best: string | null = null;
  let bestScore = 0;

  for (const header of headers) {
    if (taken.has(header) || header === "") continue;
    const letters = samples.reduce(
      (sum, record) => sum + (record[header] ?? "").replace(/[^a-zA-Z]/g, "").length,
      0,
    );
    if (letters > bestScore) {
      bestScore = letters;
      best = header;
    }
  }

  return best;
}

/* -------------------------------------------------------------------------
 * Normalization
 * ---------------------------------------------------------------------- */

/**
 * Statement records → rows ready for `transactions`, plus the lines that could
 * not be read.
 *
 * A bad line is **reported, never dropped**: "312 rows imported" over a file
 * of 400 is a silent lie about someone's finances, so the dialog prints the
 * count and the first few reasons and lets the reader fix the mapping.
 */
export function normalizeRows(
  records: Record<string, string>[],
  mapping: CsvMapping,
): { rows: ParsedRow[]; skipped: SkippedRow[] } {
  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];

  records.forEach((record, index) => {
    // +2: the header is line 1 and `index` is 0-based.
    const line = index + 2;

    const bookedOn = parseDate(record[mapping.date] ?? "");
    if (!bookedOn) {
      skipped.push({ line, reason: "date" });
      return;
    }

    const amountMinor = amountOf(record, mapping);
    if (amountMinor === null) {
      skipped.push({ line, reason: "amount" });
      return;
    }

    const currency = (record[mapping.currency ?? ""] ?? "").trim().toUpperCase();

    rows.push({
      bookedOn,
      amountMinor: mapping.invertSign ? -amountMinor : amountMinor,
      // Anything the file does not say is CHF. No rate is ever invented —
      // `originalAmountMinor` keeps the charged figure so a real conversion
      // can be applied later.
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "CHF",
      description: (record[mapping.description] ?? "").replace(/\s+/g, " ").trim(),
    });
  });

  return { rows, skipped };
}

/**
 * One signed amount, from either a single column or a debit/credit pair.
 *
 * A pair carries unsigned magnitudes in two columns, exactly one of which is
 * filled per line, so the sign comes from *which* column holds the value. A
 * line with neither filled is not a booking.
 */
function amountOf(record: Record<string, string>, mapping: CsvMapping): number | null {
  if (mapping.amount) {
    return parseAmountMinor(record[mapping.amount] ?? "");
  }

  const debit = mapping.debit ? parseAmountMinor(record[mapping.debit] ?? "") : null;
  const credit = mapping.credit ? parseAmountMinor(record[mapping.credit] ?? "") : null;
  if (debit === null && credit === null) return null;

  return Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
}

/* -------------------------------------------------------------------------
 * The whole read
 * ---------------------------------------------------------------------- */

/**
 * Sniff, detect, normalize — the one call both the browser preview and the
 * server import make. `override` carries whatever the reader corrected in the
 * dialog; anything it leaves out is re-detected against the file.
 */
export function analyzeCsv(text: string, override?: Partial<CsvMapping>): CsvAnalysis {
  const delimiter = override?.delimiter ?? sniffDelimiter(text);
  const records = toRecords(text, delimiter);
  const headers = records.length > 0 ? Object.keys(records[0]) : [];

  const detected = detectMapping(headers, records, delimiter);
  const mapping: CsvMapping = { ...detected, ...override, delimiter };

  const { rows, skipped } = normalizeRows(records, mapping);
  return { headers, mapping, rows, skipped, total: records.length };
}
