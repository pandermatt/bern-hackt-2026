import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  merchantOverrides,
  sessions,
  transactions,
  users,
  type Transaction,
} from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import {
  applyMerchantOverrides,
  merchantOverridesFor,
  normalizeDomain,
} from "@/lib/merchant-overrides";

/* Outside a request there is no locale and no catalog loaded, so the error
 * strings are served from `messages/en.json` — the ones the app really ships.
 * Same shape as tests/profile.test.ts. */
vi.mock("next-intl/server", async () => {
  const { translator } = await import("./stubs/i18n");
  return {
    getLocale: async () => "en",
    getTranslations: async (namespace: string) => translator(namespace),
  };
});

const { getMerchantMapping, saveMerchantOverrides } = await import(
  "@/app/actions/merchant-overrides"
);

async function signIn() {
  const [user] = await db
    .insert(users)
    .values({
      email: "mapper@example.com",
      passwordHash: await hashPassword("correct horse"),
    })
    .returning();
  await createSession(user.id);
  return user;
}

/** A row with only the columns these tests care about. */
function row(
  userId: number,
  merchant: string,
  category: string,
  amountMinor: number,
  externalId: string,
): typeof transactions.$inferInsert {
  return {
    userId,
    externalId,
    bookedOn: "2026-03-04",
    kind: "expense",
    amountMinor,
    currency: "CHF",
    originalAmountMinor: amountMinor,
    account: "Privatkonto",
    merchant,
    category,
    description: "",
  };
}

beforeEach(async () => {
  await db.delete(merchantOverrides);
  await db.delete(transactions);
  await db.delete(sessions);
  await db.delete(users);
});

describe("normalizeDomain", () => {
  it("takes what people paste and stores a bare domain", () => {
    expect(normalizeDomain("uzh.ch")).toBe("uzh.ch");
    expect(normalizeDomain("  UZH.CH ")).toBe("uzh.ch");
    expect(normalizeDomain("https://www.uzh.ch/de/index.html")).toBe("uzh.ch");
    expect(normalizeDomain("http://sunrise.ch:8080/path?a=1")).toBe(
      "sunrise.ch",
    );
    // A subdomain is a domain: some brands really do live on one.
    expect(normalizeDomain("bazg.admin.ch")).toBe("bazg.admin.ch");
  });

  it("refuses anything that is not one", () => {
    for (const input of [
      "",
      "   ",
      "uzh",
      "uzh.",
      ".ch",
      "not a domain.ch",
      "uzh..ch",
      // The value ends up as a filename in the icon cache, so this is the one
      // that would actually hurt.
      "../../etc/passwd",
      "a".repeat(300) + ".ch",
    ]) {
      expect(normalizeDomain(input), input).toBeNull();
    }
  });
});

describe("applyMerchantOverrides", () => {
  const rows = [
    { merchant: "Mensa Cafeteria UZH", category: "Other" },
    { merchant: "Sunrise", category: "Other" },
  ] as Transaction[];

  it("re-files the merchants it is given and leaves the rest", () => {
    const applied = applyMerchantOverrides(
      rows,
      new Map([
        [
          "Mensa Cafeteria UZH",
          { merchant: "Mensa Cafeteria UZH", category: "Food & Drink", domain: null },
        ],
      ]),
    );

    expect(applied[0].category).toBe("Food & Drink");
    expect(applied[1].category).toBe("Other");
    // The statement is not rewritten — the same array is handed to the facets,
    // the charts and the ledger.
    expect(rows[0].category).toBe("Other");
  });

  it("ignores a category this build no longer knows", () => {
    const applied = applyMerchantOverrides(
      rows,
      new Map([
        ["Sunrise", { merchant: "Sunrise", category: "Crypto NFTs", domain: null }],
      ]),
    );

    expect(applied[1].category).toBe("Other");
  });

  it("is a no-op with nothing to apply", () => {
    expect(applyMerchantOverrides(rows, new Map())).toBe(rows);
  });
});

describe("the merchant mapper", () => {
  it("lists what the importer could not place, biggest first", async () => {
    const user = await signIn();
    await db.insert(transactions).values([
      row(user.id, "Kiosk", "Other", -500, "a"),
      row(user.id, "Kiosk", "Other", -700, "b"),
      row(user.id, "Sunrise", "Other", -9000, "c"),
      row(user.id, "Coop", "Food & Drink", -4000, "d"),
    ]);

    const mapping = await getMerchantMapping();

    expect(mapping?.merchants.map((m) => m.merchant)).toEqual([
      "Sunrise",
      "Kiosk",
    ]);
    expect(mapping?.merchants[1]).toMatchObject({
      count: 2,
      spentMinor: 1200,
      category: "Other",
      domain: "",
    });
    // A merchant the shipped map can already answer for says so, as the
    // domain field's placeholder rather than as a value.
    expect(mapping?.merchants[0].suggestedDomain).toBe("sunrise.ch");
    expect(mapping?.categories).not.toContain("Opening balance");
    expect(mapping?.categories).toContain("Food & Drink");
  });

  it("saves a decision and applies it to every line of that merchant", async () => {
    const user = await signIn();
    await db.insert(transactions).values([
      row(user.id, "Mensa Cafeteria UZH", "Other", -1200, "a"),
      row(user.id, "Mensa Cafeteria UZH", "Other", -800, "b"),
    ]);

    const result = await saveMerchantOverrides([
      {
        merchant: "Mensa Cafeteria UZH",
        category: "Food & Drink",
        domain: "https://www.uzh.ch/de",
      },
    ]);
    expect(result).toEqual({ ok: true });

    const stored = await merchantOverridesFor(user.id);
    expect(stored.get("Mensa Cafeteria UZH")).toMatchObject({
      category: "Food & Drink",
      domain: "uzh.ch",
    });

    const rows = await db.select().from(transactions);
    expect(
      applyMerchantOverrides(rows, stored).every(
        (r) => r.category === "Food & Drink",
      ),
    ).toBe(true);
    // The statements themselves are untouched: an override is applied on read.
    expect(rows.every((r) => r.category === "Other")).toBe(true);
  });

  it("keeps a filed merchant on the list, showing what it was filed as", async () => {
    const user = await signIn();
    await db
      .insert(transactions)
      .values([row(user.id, "Sunrise", "Other", -9000, "a")]);
    await saveMerchantOverrides([
      { merchant: "Sunrise", category: "Utilities & Telecom", domain: "" },
    ]);

    const mapping = await getMerchantMapping();
    expect(mapping?.merchants[0]).toMatchObject({
      merchant: "Sunrise",
      category: "Utilities & Telecom",
    });
  });

  it("stores no row for a merchant nobody had an opinion about", async () => {
    const user = await signIn();
    await db
      .insert(transactions)
      .values([row(user.id, "Kiosk", "Other", -500, "a")]);

    await saveMerchantOverrides([
      { merchant: "Kiosk", category: "Food & Drink", domain: "kiosk.ch" },
    ]);
    expect((await merchantOverridesFor(user.id)).size).toBe(1);

    // Back to "leave it alone" — which is the absence of a row, not a row of
    // nulls, and re-saving has to actually take it away.
    await saveMerchantOverrides([
      { merchant: "Kiosk", category: "Other", domain: "" },
    ]);
    expect((await merchantOverridesFor(user.id)).size).toBe(0);
  });

  it("refuses a domain that is not one, and saves nothing", async () => {
    const user = await signIn();
    await db
      .insert(transactions)
      .values([row(user.id, "Kiosk", "Other", -500, "a")]);

    const result = await saveMerchantOverrides([
      { merchant: "Kiosk", category: "Food & Drink", domain: "not a domain" },
    ]);

    expect(result.ok).toBe(false);
    expect((await merchantOverridesFor(user.id)).size).toBe(0);
  });

  it("refuses a category the catalog does not have", async () => {
    const user = await signIn();
    const result = await saveMerchantOverrides([
      { merchant: "Kiosk", category: "Crypto NFTs", domain: "" },
    ]);

    expect(result.ok).toBe(false);
    expect((await merchantOverridesFor(user.id)).size).toBe(0);
  });

  it("never reads or writes another account's merchants", async () => {
    const mine = await signIn();
    const [theirs] = await db
      .insert(users)
      .values({
        email: "someone@example.com",
        passwordHash: await hashPassword("correct horse"),
      })
      .returning();

    await db.insert(transactions).values([
      row(mine.id, "Kiosk", "Other", -500, "a"),
      row(theirs.id, "Their Corner Shop", "Other", -900, "b"),
    ]);
    await db.insert(merchantOverrides).values({
      userId: theirs.id,
      merchant: "Kiosk",
      category: "Travel",
      domain: "elsewhere.ch",
    });

    const mapping = await getMerchantMapping();
    expect(mapping?.merchants.map((m) => m.merchant)).toEqual(["Kiosk"]);
    // Their row for the same merchant name is not mine to see, and mine is
    // written without touching theirs.
    expect(mapping?.merchants[0].category).toBe("Other");

    await saveMerchantOverrides([
      { merchant: "Kiosk", category: "Food & Drink", domain: "" },
    ]);
    expect((await merchantOverridesFor(theirs.id)).get("Kiosk")).toMatchObject({
      category: "Travel",
      domain: "elsewhere.ch",
    });
  });
});
