/**
 * A minimal RFC 4180 reader — enough for the fixed-shape bank exports in
 * `scripts/seed-data`. Handles quoted fields, embedded commas and newlines,
 * doubled quotes, and CRLF.
 *
 * Deliberately not a dependency: this runs once at seed time over 36 KB of
 * trusted input, and `split(",")` is wrong here — four lines in the shipped
 * data carry a comma inside a quoted field ("Pizzeria & Grill, Samedan",
 * "Apartment in Vesterboro, AirBnB", …).
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quoted) {
      if (ch !== '"') {
        field += ch;
        continue;
      }
      // A doubled quote inside a quoted field is one literal quote.
      if (input[i + 1] === '"') {
        field += '"';
        i++;
        continue;
      }
      quoted = false;
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }

  // A file with no trailing newline still has a last record to flush.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop the blank record a trailing newline leaves behind.
  return rows.filter((cells) => cells.length > 1 || cells[0] !== "");
}

/**
 * Zips the header row onto every following row. Every line in these exports
 * ends with an empty `description`, so the parser has to keep trailing empty
 * fields — dropping them would misalign the zip.
 */
export function toRecords(input: string): Record<string, string>[] {
  const [header, ...rest] = parseCsv(input);
  if (!header) return [];
  return rest.map((cells) =>
    Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ""])),
  );
}
