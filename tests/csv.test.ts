import { describe, expect, it } from "vitest";

import { parseCsv, toRecords } from "@/scripts/lib/csv";

describe("parseCsv", () => {
  it("keeps a comma that sits inside a quoted field", () => {
    // Four lines in the shipped exports look like this. `split(",")` turns each
    // of them into an extra column and shifts every field after it.
    expect(parseCsv('a,"Pizzeria & Grill, Samedan",c\n')).toEqual([
      ["a", "Pizzeria & Grill, Samedan", "c"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a,"say ""hi""",c\n')).toEqual([["a", 'say "hi"', "c"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,"two\nlines",c\n')).toEqual([["a", "two\nlines", "c"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a trailing empty field", () => {
    // Every row in these exports ends with an empty `description`. Dropping it
    // would misalign the header zip for that row and nothing else, which is the
    // worst kind of bug to find later.
    expect(parseCsv("a,b,\n")).toEqual([["a", "b", ""]]);
  });

  it("reads the last record whether or not the file ends in a newline", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("toRecords", () => {
  it("zips the header onto each row, trailing empty field included", () => {
    expect(toRecords("name,amount,description\nRent,1820,\n")).toEqual([
      { name: "Rent", amount: "1820", description: "" },
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(toRecords("")).toEqual([]);
  });
});
