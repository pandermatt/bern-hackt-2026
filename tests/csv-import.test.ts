import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { transactions, users, type User } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import {
  analyzeCsv,
  detectMapping,
  normalizeRows,
  parseAmountMinor,
  parseDate,
  sniffDelimiter,
  type CsvMapping,
} from "@/lib/csv-import";
import { importUploadedCsv } from "@/lib/csv-upload";
import { CATEGORIES, classifyFreeText } from "@/scripts/lib/statement";
import { toRecords } from "@/scripts/lib/csv";

/** A ZKB-shaped Kontoauszug: semicolons, German headers, split money columns. */
const ZKB = [
  "Datum;Buchungstext;Belastung;Gutschrift;Valuta",
  "23.01.2026;Lohnzahlung Employer AG;;5'617.70;23.01.2026",
  "23.01.2026;EINKAUF ZKB VISA DEBIT MIGROS M BERN 23.01.26;42.15;;23.01.2026",
  "24.01.2026;Miete;3'000.00;;24.01.2026",
].join("\n");

/** An English comma export with one signed amount column. */
const PLAIN = [
  "Date,Description,Amount,Currency",
  "2026-02-01,Netflix.com Amsterdam,-19.90,CHF",
  "2026-02-03,SBB CFF FSS Ticket Shop,-8.60,CHF",
  "2026-02-04,Refund Galaxus AG,54.00,CHF",
].join("\n");

describe("sniffDelimiter", () => {
  it("picks the semicolon over the commas inside German amounts", () => {
    // `1.234,50` puts a comma on every line; counting occurrences would pick
    // the comma and split every amount in half.
    const text = "Datum;Text;Betrag\n23.01.2026;Miete;1.234,50\n24.01.2026;Coop;12,80";
    expect(sniffDelimiter(text)).toBe(";");
  });

  it("picks the comma for a plain CSV and the tab for a TSV", () => {
    expect(sniffDelimiter(PLAIN)).toBe(",");
    expect(sniffDelimiter("Date\tText\tAmount\n2026-01-01\tRent\t-1820")).toBe("\t");
  });

  it("falls back to the comma when nothing splits the file consistently", () => {
    expect(sniffDelimiter("one line, no structure")).toBe(",");
  });
});

describe("parseDate", () => {
  it("reads the formats Swiss and European exports emit", () => {
    expect(parseDate("2026-01-23")).toBe("2026-01-23");
    expect(parseDate("23.01.2026")).toBe("2026-01-23");
    expect(parseDate("23/01/2026")).toBe("2026-01-23");
    expect(parseDate("2026/01/23")).toBe("2026-01-23");
    // A timestamp is still a booking *day* — the time is dropped rather than
    // turned into an instant, which would shift the date west of UTC.
    expect(parseDate("2026-01-23T10:04:00Z")).toBe("2026-01-23");
  });

  it("expands a two-digit year", () => {
    expect(parseDate("23.01.26")).toBe("2026-01-23");
    expect(parseDate("23.01.99")).toBe("1999-01-23");
  });

  it("reads an ambiguous date day-first", () => {
    expect(parseDate("01/02/2026")).toBe("2026-02-01");
  });

  it("rejects anything that is not a real calendar day", () => {
    expect(parseDate("30.02.2026")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("Buchungsdatum")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseAmountMinor", () => {
  it("reads the Swiss, German and English groupings", () => {
    expect(parseAmountMinor("1'234.50")).toBe(123450);
    expect(parseAmountMinor("1.234,50")).toBe(123450);
    expect(parseAmountMinor("1,234.50")).toBe(123450);
    expect(parseAmountMinor("12,80")).toBe(1280);
    // Three digits after a lone separator is a group, not a fraction.
    expect(parseAmountMinor("1,234")).toBe(123400);
  });

  it("reads every way an export writes a negative", () => {
    expect(parseAmountMinor("-45.00")).toBe(-4500);
    expect(parseAmountMinor("45.00-")).toBe(-4500);
    expect(parseAmountMinor("(45.00)")).toBe(-4500);
  });

  it("ignores currency codes, symbols and spaces", () => {
    expect(parseAmountMinor("CHF 45.00")).toBe(4500);
    expect(parseAmountMinor("45.00 CHF")).toBe(4500);
    expect(parseAmountMinor("1 234.50")).toBe(123450);
  });

  it("returns null rather than zero for anything that is not a number", () => {
    expect(parseAmountMinor("")).toBeNull();
    expect(parseAmountMinor("Betrag")).toBeNull();
    // Letters anywhere but a leading or trailing currency code: the column
    // sniffer must not read a description as an amount.
    expect(parseAmountMinor("Ticket 45")).toBeNull();
    // Zero is a real amount — the shipped Revolut plan fee is one.
    expect(parseAmountMinor("0.00")).toBe(0);
  });
});

describe("detectMapping", () => {
  it("finds German headers and pairs the two money columns", () => {
    const records = toRecords(ZKB, ";");
    const mapping = detectMapping(Object.keys(records[0]), records, ";");

    expect(mapping.date).toBe("Datum");
    expect(mapping.description).toBe("Buchungstext");
    expect(mapping.debit).toBe("Belastung");
    expect(mapping.credit).toBe("Gutschrift");
    // A pair means there is no single signed column to read.
    expect(mapping.amount).toBeNull();
  });

  it("prefers the booking date over the value date", () => {
    const text = "Valutadatum;Buchungsdatum;Text;Betrag\n01.02.2026;23.01.2026;Miete;-10";
    const records = toRecords(text, ";");
    expect(detectMapping(Object.keys(records[0]), records, ";").date).toBe(
      "Buchungsdatum",
    );
  });

  it("finds English headers and the single signed column", () => {
    const records = toRecords(PLAIN);
    const mapping = detectMapping(Object.keys(records[0]), records);

    expect(mapping.date).toBe("Date");
    expect(mapping.amount).toBe("Amount");
    expect(mapping.description).toBe("Description");
    expect(mapping.currency).toBe("Currency");
  });

  it("falls back to the values when no header says anything", () => {
    const text = ["a,b,c", "23.01.2026,Coop Pronto Bern,-12.40"].join("\n");
    const records = toRecords(text);
    const mapping = detectMapping(Object.keys(records[0]), records);

    expect(mapping.date).toBe("a");
    expect(mapping.amount).toBe("c");
    expect(mapping.description).toBe("b");
  });
});

describe("normalizeRows", () => {
  const mapping: CsvMapping = {
    delimiter: ";",
    date: "Datum",
    amount: null,
    debit: "Belastung",
    credit: "Gutschrift",
    description: "Buchungstext",
    currency: null,
    invertSign: false,
  };

  it("takes the sign from which of the two columns is filled", () => {
    const { rows } = normalizeRows(toRecords(ZKB, ";"), mapping);

    expect(rows.map((row) => row.amountMinor)).toEqual([561770, -4215, -300000]);
    expect(rows[0].bookedOn).toBe("2026-01-23");
    expect(rows[0].currency).toBe("CHF");
  });

  it("flips every sign when the export has them the other way round", () => {
    const { rows } = normalizeRows(toRecords(ZKB, ";"), {
      ...mapping,
      invertSign: true,
    });
    expect(rows.map((row) => row.amountMinor)).toEqual([-561770, 4215, 300000]);
  });

  it("reports an unreadable line instead of dropping it", () => {
    const text = [
      "Date,Description,Amount",
      "2026-02-01,Netflix,-19.90",
      "not a date,Broken,-1.00",
      "2026-02-03,No amount,",
    ].join("\n");

    const { rows, skipped } = normalizeRows(toRecords(text), {
      delimiter: ",",
      date: "Date",
      amount: "Amount",
      debit: null,
      credit: null,
      description: "Description",
      currency: null,
      invertSign: false,
    });

    expect(rows).toHaveLength(1);
    // Line numbers count the header, so the reader can find them in the file.
    expect(skipped).toEqual([
      { line: 3, reason: "date" },
      { line: 4, reason: "amount" },
    ]);
  });
});

describe("analyzeCsv", () => {
  it("sniffs, detects and normalizes in one call", () => {
    const analysis = analyzeCsv(ZKB);

    expect(analysis.mapping.delimiter).toBe(";");
    expect(analysis.total).toBe(3);
    expect(analysis.rows).toHaveLength(3);
    expect(analysis.skipped).toHaveLength(0);
  });

  it("re-detects everything the override leaves out", () => {
    // Only the description column is corrected; the delimiter, the date and
    // the money pair still come from detection.
    const analysis = analyzeCsv(ZKB, { description: "Valuta" });

    expect(analysis.mapping.date).toBe("Datum");
    expect(analysis.mapping.debit).toBe("Belastung");
    expect(analysis.rows[0].description).toBe("23.01.2026");
  });
});

describe("classifyFreeText", () => {
  it("finds a canonical merchant buried in a card label", () => {
    expect(classifyFreeText("EINKAUF ZKB VISA DEBIT MIGROS M BERN 23.01.26")).toEqual({
      name: "Migros",
      category: "Food & Drink",
    });
  });

  it("folds a spelling variant onto the canonical name", () => {
    expect(classifyFreeText("Zahlung SBB CFF FSS Ticket Shop").name).toBe("SBB");
  });

  it("does not let a two-letter merchant fire inside a longer word", () => {
    // "BP" is a filling station; "bpost brussel" is a post office.
    expect(classifyFreeText("bpost brussel").category).toBe("Other");
    expect(classifyFreeText("BP").name).toBe("BP");
  });

  it("falls back to the keyword rules, then to Other", () => {
    expect(classifyFreeText("netflix.com amsterdam").category).toBe("Subscriptions");
    expect(classifyFreeText("ACME WIDGETS GMBH")).toEqual({
      // An all-caps terminal label is set in the ledger's own casing.
      name: "Acme Widgets Gmbh",
      category: "Other",
    });
  });
});

async function createUser(email: string): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("pass-123456") })
    .returning();
  return user;
}

describe("importUploadedCsv", () => {
  let user1: User;
  let user2: User;

  beforeEach(async () => {
    await db.delete(transactions);
    await db.delete(users);
    user1 = await createUser("upload1@example.com");
    user2 = await createUser("upload2@example.com");
  });

  function importZkb(userId: number) {
    return importUploadedCsv(userId, {
      text: ZKB,
      mapping: analyzeCsv(ZKB).mapping,
      accountLabel: "ZKB Privatkonto",
    });
  }

  it("appends the file's rows, classified and signed", () => {
    const result = importZkb(user1.id);
    expect(result).toEqual({ imported: 3, duplicates: 0, skipped: 0, total: 3 });

    const rows = db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, user1.id))
      .all();

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.account === "ZKB Privatkonto")).toBe(true);
    expect(rows.every((row) => CATEGORIES.includes(row.category as never))).toBe(true);

    const salary = rows.find((row) => row.amountMinor > 0)!;
    expect(salary.kind).toBe("income");
    // Pay is Salary; every other credit would be a Refund.
    expect(salary.category).toBe("Salary");
    expect(salary.amountMinor).toBe(561770);

    const migros = rows.find((row) => row.merchant === "Migros")!;
    expect(migros.amountMinor).toBe(-4215);
    expect(migros.originalAmountMinor).toBe(4215);
  });

  it("imports nothing the second time and says so", () => {
    importZkb(user1.id);
    const again = importZkb(user1.id);

    expect(again).toEqual({ imported: 0, duplicates: 3, skipped: 0, total: 3 });
    expect(
      db.select().from(transactions).where(eq(transactions.userId, user1.id)).all(),
    ).toHaveLength(3);
  });

  it("does not touch another account's ledger", () => {
    importZkb(user1.id);
    importZkb(user2.id);

    // The natural key is unique *per user*, so the same statement lands in
    // both accounts rather than colliding.
    expect(
      db.select().from(transactions).where(eq(transactions.userId, user2.id)).all(),
    ).toHaveLength(3);
  });

  it("keeps two identical charges on the same day", () => {
    const text = [
      "Date,Description,Amount",
      "2026-03-02,SBB Ticket,-8.60",
      "2026-03-02,SBB Ticket,-8.60",
    ].join("\n");

    const result = importUploadedCsv(user1.id, {
      text,
      mapping: analyzeCsv(text).mapping,
      accountLabel: "Card",
    });

    // Both are real: the second gets an occurrence suffix on its key rather
    // than being eaten by the dedupe.
    expect(result.imported).toBe(2);
  });

  it("counts the lines it could not read", () => {
    const text = [
      "Date,Description,Amount",
      "2026-03-02,Coop,-8.60",
      "Total,,",
    ].join("\n");

    const result = importUploadedCsv(user1.id, {
      text,
      mapping: analyzeCsv(text).mapping,
      accountLabel: "Card",
    });

    expect(result).toEqual({ imported: 1, duplicates: 0, skipped: 1, total: 2 });
  });
});
